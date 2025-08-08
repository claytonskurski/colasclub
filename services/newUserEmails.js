const nodemailer = require('nodemailer');
const Event = require('../models/events');
const { format, parseISO } = require('date-fns');
const { utcToZonedTime } = require('date-fns-tz');

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
        console.log('New user email server is ready');
    }
});

// Function to get upcoming events within the next 7 days
const getUpcomingEvents = async () => {
    try {
        const now = new Date();
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(now.getDate() + 7);
        
        const events = await Event.find({
            dtstart: {
                $gte: now.toISOString(),
                $lte: sevenDaysFromNow.toISOString()
            },
            status: 'pending'
        })
        .sort({ dtstart: 1 })
        .limit(3)
        .select('summary dtstart');
        
        return events;
    } catch (error) {
        console.error('Error fetching upcoming events:', error);
        return [];
    }
};

// Helper to format event date and time
function formatEventDateTime(event) {
    try {
        const eventDate = parseISO(event.dtstart);
        const timezone = event.timezone || 'America/New_York';
        const zonedDate = utcToZonedTime(eventDate, timezone);
        return format(zonedDate, 'EEEE, MMMM do, yyyy', { timeZone: timezone });
    } catch (error) {
        return new Date(event.dtstart).toLocaleDateString();
    }
}

// New user welcome email template
const welcomeNewUserTemplate = async (user) => {
    const upcomingEvents = await getUpcomingEvents();
    // Event cards styled like eventEmails.js
    const eventsList = upcomingEvents.length > 0
        ? upcomingEvents.map(event => {
            const eventDateTime = formatEventDateTime(event);
            const eventUrl = `${process.env.WEBSITE_URL || 'https://sodacityoutdoors.com'}/events`;
            return `
                <div style="background-color:#f8f9fa;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #0e747c;">
                    <h3 style="color:#2c3e50;margin:0 0 15px 0;font-size:18px;">${event.summary}</h3>
                    <p style="color:#666;margin:0 0 20px 0;font-size:14px;"><strong>📅 ${eventDateTime}</strong></p>
                    <a href="${eventUrl}" style="background-color:#0e747c;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;display:inline-block;font-weight:bold;font-size:14px;">RSVP or View All Events</a>
                </div>
            `;
        }).join('')
        : `
            <div style="background-color:#f8f9fa;padding:30px;border-radius:8px;margin:20px 0;text-align:center;border-left:4px solid #0e747c;">
                <h3 style="color:#666;margin:0 0 15px 0;">No events scheduled this week</h3>
                <p style="color:#666;margin:0;line-height:1.6;">Perfect time to submit an event idea and get something on the calendar!</p>
            </div>
        `;

    return {
        subject: 'Welcome to Soda City Outdoors!',
        html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Welcome to Soda City Outdoors</title>
            </head>
            <body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8f9fa;">
            <div style="background:#fff;margin:0 auto;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.05);max-width:600px;">
                <div style="text-align:center;margin-bottom:20px;">
                    <img src='https://sodacityoutdoors.com/static/images/SCO%20Logo.png' alt='Soda City Outdoors Logo' style='max-width:200px;width:100%;height:auto;display:block;margin:0 auto;'>
                </div>
                <h1 style="color:#2c3e50;margin:0 0 20px 0;font-size:28px;">Hi ${user.firstName}, welcome to Soda City Outdoors!</h1>
                <p style="margin:0 0 15px 0;line-height:1.6;font-size:16px;color:#333;">We're thrilled to have you join our community of outdoor adventurers. As a member, you can expect roughly three events per week—completely optional, always fun, and a great way to meet new friends!</p>
                <div style="background-color:#eafaf7;padding:18px 20px;border-radius:8px;margin:20px 0 30px 0;border-left:4px solid #27ae60;">
                    <h2 style="color:#27ae60;margin:0 0 10px 0;font-size:20px;">Upcoming Events</h2>
                    ${eventsList}
                </div>
                <div style="background-color:#fff3cd;padding:18px 20px;border-radius:8px;margin:30px 0;border-left:4px solid #ffc107;">
                    <h2 style="color:#856404;margin:0 0 10px 0;font-size:20px;">🛶 Free Equipment Rentals</h2>
                    <p style="margin:0 0 15px 0;line-height:1.6;font-size:16px;color:#333;">As a member, you get <strong>free access to equipment rentals</strong>! Just go through the rental process and select the member option, or reach out to us through our <a href="https://sodacityoutdoors.com/contact" style="color:#0e747c;text-decoration:none;">Contact Us</a> page or email <a href="mailto:scoadmin@sodacityoutdoors.com" style="color:#0e747c;text-decoration:none;">scoadmin@sodacityoutdoors.com</a>.</p>
                </div>
                <div style="background-color:#f8f9fa;padding:18px 20px;border-radius:8px;margin:30px 0 20px 0;border-left:4px solid #0e747c;">
                    <h2 style="color:#0e747c;margin:0 0 10px 0;font-size:20px;">Get Involved</h2>
                    <p style="margin:0 0 10px 0;line-height:1.6;font-size:15px;color:#333;">Have an idea for an event? Want to connect with other members? Reply to this email, submit an event idea, or join us on social media!</p>
                    <div style="margin:10px 0 0 0;">
                        <a href="https://sodacityoutdoors.com/events" style="background-color:#0e747c;color:white;padding:10px 22px;text-decoration:none;border-radius:5px;display:inline-block;font-weight:bold;font-size:15px;margin-right:10px;">See All Events</a>
                        <a href="https://sodacityoutdoors.com/contact" style="background-color:#27ae60;color:white;padding:10px 22px;text-decoration:none;border-radius:5px;display:inline-block;font-weight:bold;font-size:15px;">Contact Us</a>
                    </div>
                </div>
                <div style="text-align:center;margin:30px 0 0 0;">
                    <a href="https://facebook.com/sodacityoutdoors" style="margin:0 10px;display:inline-block;"><img src="https://cdn-icons-png.flaticon.com/24/733/733547.png" alt="Facebook" style="vertical-align:middle;"></a>
                    <a href="https://instagram.com/sodacityoutdoors" style="margin:0 10px;display:inline-block;"><img src="https://cdn-icons-png.flaticon.com/24/2111/2111463.png" alt="Instagram" style="vertical-align:middle;"></a>
                    <a href="https://www.reddit.com/r/SodaCityOutdoor/" style="margin:0 10px;display:inline-block;"><img src="https://cdn-icons-png.flaticon.com/24/2111/2111463.png" alt="Reddit" style="vertical-align:middle;"></a>
                    <a href="mailto:scoadmin@sodacityoutdoors.com" style="margin:0 10px;display:inline-block;"><img src="https://cdn-icons-png.flaticon.com/24/732/732200.png" alt="Email" style="vertical-align:middle;"></a>
                </div>
                <div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee;padding-bottom:50px;">
                    <p style="color:#666;font-size:14px;margin:0;"><strong>Soda City Outdoors</strong></p>
                    <p style="color:#666;font-size:12px;margin:5px 0 0 0;">If you have any questions, reply to this email or contact us at <a href="mailto:scoadmin@sodacityoutdoors.com" style="color:#0e747c;text-decoration:none;">scoadmin@sodacityoutdoors.com</a></p>
                </div>
            </div>
            </body>
            </html>
        `
    };
};

// Function to send welcome email to new user (external)
const sendWelcomeNewUserEmail = async (user) => {
    console.log('[NEW USER EMAIL] Entered sendWelcomeNewUserEmail for user:', user.email);
    console.log('[NEW USER EMAIL] User object:', {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username
    });
    
    try {
        console.log('[NEW USER EMAIL] Generating email template...');
        const { subject, html } = await welcomeNewUserTemplate(user);
        console.log('[NEW USER EMAIL] Email template generated, subject:', subject);
        
        console.log('[NEW USER EMAIL] Email configuration:', {
            host: 'smtp.hostinger.com',
            port: 465,
            user: process.env.EMAIL_USER,
            auth_provided: !!process.env.EMAIL_PASS
        });
        
        console.log('[NEW USER EMAIL] Sending email...');
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: user.email,
            cc: 'cskurski00@gmail.com',
            subject,
            html
        });
        console.log('[NEW USER EMAIL] Welcome email sent successfully to:', user.email);
        return true;
    } catch (error) {
        console.error('[NEW USER EMAIL] Error sending welcome new user email:', error);
        console.error('[NEW USER EMAIL] Error details:', {
            message: error.message,
            code: error.code,
            command: error.command,
            response: error.response
        });
        return false;
    }
};

module.exports = {
    sendWelcomeNewUserEmail
}; 