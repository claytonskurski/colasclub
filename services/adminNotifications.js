const nodemailer = require('nodemailer');
const { format, utcToZonedTime } = require('date-fns-tz');
const Event = require('../models/events');
const User = require('../models/user');
const mongoose = require('mongoose');

// Initialize nodemailer transporter with Hostinger SMTP
const transporter = nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true, // use SSL
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Verify transporter
transporter.verify(function (error, success) {
    if (error) {
        console.error('Error verifying email configuration:', error);
        console.error('Email config used:', {
            host: 'smtp.hostinger.com',
            port: 465,
            user: process.env.EMAIL_USER,
            auth_provided: !!process.env.EMAIL_PASS
        });
    } else {
        console.log('Admin notification email server is ready');
    }
});

// Set up MongoDB change stream to watch for new user registrations
let userChangeStream = null;

const initializeUserWatcher = async () => {
    try {
        // Get the users collection
        const usersCollection = mongoose.connection.collection('users');
        
        // Create a change stream to watch for insert operations
        userChangeStream = usersCollection.watch([
            {
                $match: {
                    operationType: 'insert'
                }
            }
        ]);

        console.log('User change stream initialized successfully');

        // Listen for changes
        userChangeStream.on('change', async (change) => {
            console.log('[CHANGE STREAM] New user detected:', change.documentKey._id);
            
            try {
                // Get the full user document
                const user = await User.findById(change.documentKey._id);
                if (user) {
                    console.log('[CHANGE STREAM] Processing new user:', user.email);
                    
                    // Send admin notification
                    await sendNewUserNotification(user);
                    
                    // Send welcome email to the new user
                    const { sendWelcomeNewUserEmail } = require('./newUserEmails');
                    await sendWelcomeNewUserEmail(user);
                    
                    console.log('[CHANGE STREAM] Notifications sent successfully for user:', user.email);
                }
            } catch (error) {
                console.error('[CHANGE STREAM] Error processing new user notification:', error);
            }
        });

        userChangeStream.on('error', (error) => {
            console.error('[CHANGE STREAM] Error in user change stream:', error);
            // Attempt to reconnect after a delay
            setTimeout(() => {
                console.log('[CHANGE STREAM] Attempting to reconnect...');
                initializeUserWatcher();
            }, 5000);
        });

    } catch (error) {
        console.error('[CHANGE STREAM] Error initializing user watcher:', error);
        // Attempt to reconnect after a delay
        setTimeout(() => {
            console.log('[CHANGE STREAM] Attempting to reconnect...');
            initializeUserWatcher();
        }, 5000);
    }
};

// Function to start the user watcher
const startUserWatcher = () => {
    // Wait for MongoDB connection to be ready
    if (mongoose.connection.readyState === 1) {
        initializeUserWatcher();
    } else {
        mongoose.connection.once('connected', () => {
            initializeUserWatcher();
        });
    }
};

// Function to stop the user watcher
const stopUserWatcher = () => {
    if (userChangeStream) {
        userChangeStream.close();
        userChangeStream = null;
        console.log('[CHANGE STREAM] User watcher stopped');
    }
};

// Helper function to send admin notifications
async function sendAdminNotification(subject, text) {
    console.log('Attempting to send admin notification:', { subject, text });
    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn('Email configuration not found:', {
            EMAIL_USER: !!process.env.EMAIL_USER,
            EMAIL_PASS: !!process.env.EMAIL_PASS
        });
        return;
    }

    const mailOptions = {
        from: process.env.EMAIL_USER || 'scoadmin@sodacityoutdoors.com',
        to: 'scoadmin@sodacityoutdoors.com',
        subject: subject,
        text: text
    };

    try {
        console.log('Sending admin email with options:', {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject
        });
        await transporter.sendMail(mailOptions);
        console.log('Admin notification email sent successfully');
    } catch (emailError) {
        console.error('Error sending admin notification email:', {
            error: emailError.message,
            stack: emailError.stack,
            code: emailError.code,
            command: emailError.command
        });
    }
}

// Send new user notification
const sendNewUserNotification = async (user) => {
    console.log('[NOTIFY] Entered sendNewUserNotification for user:', user.email);
    try {
        await sendAdminNotification(
            'New User Registration',
            `A new user has registered:\nUsername: ${user.username}\nEmail: ${user.email}\nFirst Name: ${user.firstName}\nLast Name: ${user.lastName}\nRegistration Date: ${new Date().toLocaleDateString()}`
        );
        console.log('[NOTIFY] Admin notification email sent successfully for user:', user.email);
        return true;
    } catch (error) {
        console.error('[NOTIFY] Failed to send new user notification:', error);
        return false;
    }
};

// Send RSVP notification to admin
const sendRSVPNotification = async (event, rsvp, user) => {
    try {
        const subject = 'New Event RSVP';
        const text = `
New RSVP for Event:
Event: ${event.summary}
Date: ${new Date(event.dtstart).toLocaleDateString()}
Attendee: ${user.username}
Email: ${user.email}
Phone: ${rsvp.phoneNumber}
Current RSVP Count: ${event.rsvps.length}
        `;
        await sendAdminNotification(subject, text);
    } catch (error) {
        console.error('Error sending RSVP notification:', error);
    }
};

// Send rental notification to admin
const sendRentalNotification = async (reservation) => {
    try {
        const subject = 'New Rental Booking';
        const text = `
New Rental Booking:
Customer Name: ${reservation.name}
Customer Email: ${reservation.email}
Location: ${reservation.locationName}
Equipment: ${reservation.equipmentType}
Quantity: ${reservation.quantity}
Date: ${reservation.date.toISOString().split('T')[0]}
Time: ${reservation.interval === 'half-day' 
    ? `Half Day (${reservation.timeBlock === 'AM' ? '10AM - 2PM' : reservation.timeBlock === 'PM' ? '2PM - 6PM' : ''})` 
    : 'Full Day (10AM - 6PM)'}
Total Amount: $${reservation.total.toFixed(2)}
Payment Status: ${reservation.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
Payment Method: ${reservation.paymentMethod === 'stripe' ? 'Credit Card' : 'Cash'}
        `;
        await sendAdminNotification(subject, text);
    } catch (error) {
        console.error('Error sending rental notification:', error);
    }
};

module.exports = {
    sendNewUserNotification,
    sendAdminNotification,
    sendRSVPNotification,
    sendRentalNotification,
    startUserWatcher,
    stopUserWatcher
};