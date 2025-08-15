const nodemailer = require('nodemailer');
const { format, utcToZonedTime } = require('date-fns-tz');
const Event = require('../models/events');
const User = require('../models/user');

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

// Send admin notification
async function sendAdminNotification(subject, content, isHtml = false) {
    console.log('[ADMIN NOTIFY] Sending admin notification:', subject);
    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn('Email configuration not found:', {
            EMAIL_USER: !!process.env.EMAIL_USER,
            EMAIL_PASS: !!process.env.EMAIL_PASS
        });
        return;
    }

    const mailOptions = {
        from: process.env.EMAIL_USER || 'admin@colasclub.com',
        to: 'admin@colasclub.com',
        subject: subject
    };

    // Add content based on type
    if (isHtml) {
        mailOptions.html = content;
        // Also provide plain text fallback
        mailOptions.text = content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    } else {
        mailOptions.text = content;
    }

    try {
        console.log('[ADMIN NOTIFY] Sending admin email with options:', {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject,
            contentType: isHtml ? 'HTML' : 'Text'
        });
        await transporter.sendMail(mailOptions);
        console.log('[ADMIN NOTIFY] Admin notification email sent successfully');
    } catch (emailError) {
        console.error('[ADMIN NOTIFY] Error sending admin notification email:', {
            error: emailError.message,
            stack: emailError.stack,
            code: emailError.code,
            command: emailError.command
        });
    }
}

// Send new user notification
const sendNewUserNotification = async (user) => {
    console.log('[ADMIN NOTIFY] Entered sendNewUserNotification for user:', user.email);
    try {
        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <h2 style="color: #2c3e50; margin-bottom: 20px; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                        🎉 New User Registration
                    </h2>
                    <div style="background-color: #ecf0f1; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
                        <p style="margin: 8px 0;"><strong>Username:</strong> ${user.username}</p>
                        <p style="margin: 8px 0;"><strong>Email:</strong> ${user.email}</p>
                        <p style="margin: 8px 0;"><strong>Name:</strong> ${user.firstName} ${user.lastName}</p>
                        <p style="margin: 8px 0;"><strong>Registration Date:</strong> ${new Date().toLocaleDateString()}</p>
                        <p style="margin: 8px 0;"><strong>Account Type:</strong> ${user.accountType || 'member'}</p>

                    </div>
                    <p style="color: #7f8c8d; font-size: 14px; margin-top: 20px;">
                        This user has successfully completed registration and is now active in the system.
                    </p>
                </div>
            </div>
        `;
        
        await sendAdminNotification(
            'New User Registration',
            htmlContent,
            true // isHtml = true
        );
        console.log('[ADMIN NOTIFY] Admin notification email sent successfully for user:', user.email);
        return true;
    } catch (error) {
        console.error('[ADMIN NOTIFY] Failed to send new user notification:', error);
        return false;
    }
};

// Send RSVP notification to admin
const sendRSVPNotification = async (event, rsvp, user) => {
    try {
        const subject = 'New Event RSVP';
        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <h2 style="color: #2c3e50; margin-bottom: 20px; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                        📅 New Event RSVP
                    </h2>
                    <div style="background-color: #ecf0f1; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
                        <h3 style="color: #e74c3c; margin-top: 0;">Event Details</h3>
                        <p style="margin: 8px 0;"><strong>Event:</strong> ${event.summary}</p>
                        <p style="margin: 8px 0;"><strong>Date:</strong> ${new Date(event.dtstart).toLocaleDateString()}</p>
                        <p style="margin: 8px 0;"><strong>Time:</strong> ${new Date(event.dtstart).toLocaleTimeString()}</p>
                        
                        <h3 style="color: #e74c3c; margin-top: 20px;">Attendee Information</h3>
                        <p style="margin: 8px 0;"><strong>Name:</strong> ${user.firstName} ${user.lastName}</p>
                        <p style="margin: 8px 0;"><strong>Username:</strong> ${user.username}</p>
                        <p style="margin: 8px 0;"><strong>Email:</strong> ${user.email}</p>
                        <p style="margin: 8px 0;"><strong>Phone:</strong> ${rsvp.phoneNumber}</p>
                        
                        <h3 style="color: #e74c3c; margin-top: 20px;">RSVP Statistics</h3>
                        <p style="margin: 8px 0;"><strong>Current RSVP Count:</strong> ${event.rsvps.length}</p>
                        <p style="margin: 8px 0;"><strong>RSVP Date:</strong> ${new Date().toLocaleDateString()}</p>
                    </div>
                    <p style="color: #7f8c8d; font-size: 14px; margin-top: 20px;">
                        This RSVP has been automatically recorded in the system.
                    </p>
                </div>
            </div>
        `;
        await sendAdminNotification(subject, htmlContent, true);
    } catch (error) {
        console.error('Error sending RSVP notification:', error);
    }
};




module.exports = {
    sendNewUserNotification,
    sendAdminNotification,
    sendRSVPNotification
};