const nodemailer = require('nodemailer');
const twilio = require('twilio');

// Initialize Twilio client
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

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
        console.log('Notification email server is ready');
    }
});

// Email templates
const emailTemplates = {
    welcome: (user) => ({
        subject: 'Welcome to Soda City Outdoors!',
        html: `
            <h1>Welcome to Soda City Outdoors, ${user.firstName}!</h1>
            <p>We're excited to have you join our community of outdoor enthusiasts.</p>
            <p>Here are a few things you can do to get started:</p>
            <ul>
                <li>Browse our upcoming events</li>
                <li>Complete your profile</li>
                <li>Join our forum discussions</li>
            </ul>
            <p>Happy adventuring!</p>
        `
    }),
    eventReminder: (user, event) => ({
        subject: `Reminder: ${event.summary} tomorrow`,
        html: `
            <h2>Event Reminder</h2>
            <p>Hi ${user.firstName},</p>
            <p>This is a reminder that you're registered for:</p>
            <h3>${event.summary}</h3>
            <p><strong>When:</strong> ${new Date(event.dtstart).toLocaleString()}</p>
            <p><strong>Where:</strong> ${event.location}</p>
            <p>See you there!</p>
        `
    })
};

// SMS templates
const smsTemplates = {
    eventReminder: (event) => `
Reminder: ${event.summary} starts in 2 hours!
Location: ${event.location}
See you there!
`.trim()
};

// Send email
const sendEmail = async (to, template, data) => {
    try {
        const { subject, html } = emailTemplates[template](data);
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to,
            subject,
            html
        });
        console.log(`Email sent successfully to ${to}`);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        return false;
    }
};

// Send SMS
const sendSMS = async (to, template, data) => {
    try {
        const message = smsTemplates[template](data);
        await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to
        });
        console.log(`SMS sent successfully to ${to}`);
        return true;
    } catch (error) {
        console.error('Error sending SMS:', error);
        return false;
    }
};

// Schedule notifications for an event
const scheduleEventNotifications = async (user, event) => {
    const eventDate = new Date(event.dtstart);
    
    // Schedule email for 24 hours before
    const emailDate = new Date(eventDate);
    emailDate.setHours(emailDate.getHours() - 24);
    
    // Schedule SMS for 2 hours before
    const smsDate = new Date(eventDate);
    smsDate.setHours(smsDate.getHours() - 2);
    
    // Use node-schedule to schedule notifications
    require('node-schedule').scheduleJob(emailDate, async () => {
        await sendEmail(user.email, 'eventReminder', { user, event });
    });
    
    require('node-schedule').scheduleJob(smsDate, async () => {
        if (user.phone) {
            await sendSMS(user.phone, 'eventReminder', event);
        }
    });
};

module.exports = {
    sendEmail,
    sendSMS,
    scheduleEventNotifications
}; 