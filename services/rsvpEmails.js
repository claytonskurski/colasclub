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
        console.log('RSVP email server is ready');
    }
});

// RSVP confirmation email template
const rsvpConfirmationTemplate = async (rsvp, user) => {
    // Find the event details using the eventId from the RSVP
    const event = await Event.findOne({ eventId: rsvp.eventId });
    if (!event) {
        console.error('Event not found for RSVP confirmation:', rsvp.eventId);
        return {
            subject: 'RSVP Confirmation',
            html: '<p>Your RSVP has been confirmed, but event details are currently unavailable.</p>'
        };
    }

    // Format the event date and time
    const eventDate = new Date(event.dtstart);
    const formattedDate = eventDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    const formattedTime = eventDate.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
    });

    return {
        subject: `RSVP Confirmed: ${event.summary}`,
        html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>RSVP Confirmation</title>
            </head>
            <body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8f9fa;">
            <div style="background:#fff;margin:0 auto;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div style="text-align:center;margin-bottom:20px;">
                    <img src='https://colasclub.fun/static/images/Cola's Club Official Logo.png' alt='Cola\'s Club Logo' style='max-width:200px;width:100%;height:auto;display:block;margin:0 auto;'>
                </div>
                <h1 style="color:#2c3e50;margin:0 0 20px 0;">Thanks for signing up, ${user.firstName}!</h1>
                <p style="margin:0 0 15px 0;line-height:1.6;">We're excited to have you join us for this adventure! Your RSVP has been confirmed and we can't wait to see you there.</p>
                <p style="margin:0 0 20px 0;line-height:1.6;"><strong>We'll see you there!</strong></p>
                
                <div style="background-color:#f8f9fa;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #0e747c;">
                    <h2 style="color:#2c3e50;margin:0 0 15px 0;">Event Details</h2>
                    <div style="margin-bottom:15px;">
                        <h3 style="color:#0e747c;margin:0 0 10px 0;">${event.summary}</h3>
                        <p style="margin:0 0 8px 0;color:#666;"><strong>Date:</strong> ${formattedDate}</p>
                        <p style="margin:0 0 8px 0;color:#666;"><strong>Time:</strong> ${formattedTime}</p>
                        <p style="margin:0 0 8px 0;color:#666;"><strong>Location:</strong> ${event.location || 'Location TBD'}</p>
                        ${event.description ? `<p style="margin:10px 0 0 0;color:#666;"><strong>Description:</strong> ${event.description}</p>` : ''}
                    </div>
                </div>

                <p style="margin:20px 0;line-height:1.6;">We're looking forward to a great time together! If you have any questions or need to make changes to your RSVP, please don't hesitate to reach out.</p>
                
                <div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee;">
                    <p style="color:#666;font-size:14px;margin:0;"><strong>Cola\'s Club</strong></p>
                    <p style="color:#666;font-size:12px;margin:5px 0 0 0;">If you have any questions, reply to this email or contact us at <a href="mailto:admin@colasclub.com" style="color:#0e747c;text-decoration:none;">admin@colasclub.com</a></p>
                </div>
            </div>
            </body>
            </html>
        `
    };
};

// Function to send RSVP confirmation email to user
const sendRSVPConfirmationEmail = async (rsvp, user) => {
    console.log('[RSVP EMAIL] Entered sendRSVPConfirmationEmail for user:', user.email, 'event:', rsvp.eventId);
    try {
        const { subject, html } = await rsvpConfirmationTemplate(rsvp, user);
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: user.email,
            subject,
            html
        });
        console.log('[RSVP EMAIL] RSVP confirmation email sent to user:', user.email);
        return true;
    } catch (error) {
        console.error('[RSVP EMAIL] Error sending RSVP confirmation email:', error);
        return false;
    }
};

module.exports = {
    sendRSVPConfirmationEmail
}; 