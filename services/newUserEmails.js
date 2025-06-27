const nodemailer = require('nodemailer');
const Event = require('../models/events');

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

// New user welcome email template
const welcomeNewUserTemplate = async (user) => {
    const upcomingEvents = await getUpcomingEvents();
    const eventNames = upcomingEvents.map(event => event.summary);
    
    // Fill in event names or use placeholders if not enough events
    const event1 = eventNames[0] || 'a social event';
    const event2 = eventNames[1] || 'an outdoor activity';
    const event3 = eventNames[2] || 'a weekend excursion';
    
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
            <div style="background:#fff;margin:0 auto;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div style="text-align:center;margin-bottom:20px;">
                    <img src='https://sodacityoutdoors.com/static/images/SCO%20Logo.png' alt='Soda City Outdoors Logo' style='max-width:200px;width:100%;height:auto;display:block;margin:0 auto;'>
                </div>
                <h1 style="color:#2c3e50;margin:0 0 20px 0;">Hi ${user.firstName},</h1>
                <p style="margin:0 0 15px 0;line-height:1.6;">Welcome to Soda City Outdoors!</p>
                <p style="margin:0 0 15px 0;line-height:1.6;">As a member, you can expect roughly three events per week that are completely optional to attend. We'll have a couple of socials or outdoor activities within Columbia during the week and some fun, outdoor excursions on the weekends! Of course, since this is community based, please feel free to pitch any ideas of things you may want to do in the future.</p>
                <p style="margin:0 0 15px 0;line-height:1.6;"><strong>This week we'll do</strong> ${event1}, ${event2}, and ${event3}.</p>
                <p style="margin:0 0 15px 0;line-height:1.6;">You will also get access to discounted rental gear that you are free to borrow at any time!</p>
                <div style="background-color:#f8f9fa;padding:15px;border-radius:5px;margin:20px 0;">
                    <h3 style="color:#2c3e50;margin:0 0 15px 0;">Your Discount Codes:</h3>
                    <ul style="list-style:none;padding:0;margin:0;">
                        <li style="margin-bottom:10px;"><strong>Tube Discount Code:</strong> TUBINGFUN</li>
                        <li style="margin-bottom:0;"><strong>Kayak Discount Code:</strong> SCOMEMBERS</li>
                    </ul>
                </div>
                <p style="margin:20px 0;line-height:1.6;">The more people we have, the more folks we can meet, the more events we can have, and more fun will be had. Thanks for joining and hope to meet you soon!</p>
                <div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee;">
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
    try {
        const { subject, html } = await welcomeNewUserTemplate(user);
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: user.email,
            cc: 'cskurski00@gmail.com',
            subject,
            html
        });
        console.log('[NEW USER EMAIL] Welcome email sent to new user:', user.email);
        return true;
    } catch (error) {
        console.error('[NEW USER EMAIL] Error sending welcome new user email:', error);
        return false;
    }
};

module.exports = {
    sendWelcomeNewUserEmail
}; 