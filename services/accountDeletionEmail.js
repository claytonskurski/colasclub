const nodemailer = require('nodemailer');

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
    } else {
        console.log('Account deletion email server is ready');
    }
});

// Account deletion email template
const accountDeletionTemplate = (user) => {
    return {
        subject: 'Your Cola\'s Club Account Has Been Deleted',
        html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Account Deleted</title>
            </head>
            <body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8f9fa;">
            <div style="background:#fff;margin:0 auto;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div style="text-align:center;margin-bottom:20px;">
                    <img src='https://colasclub.fun/static/images/Cola's Club Official Logo.png' alt='Cola\'s Club Logo' style='max-width:200px;width:100%;height:auto;display:block;margin:0 auto;'>
                </div>
                <h1 style="color:#2c3e50;margin:0 0 20px 0;">We're sad to see you go, ${user.firstName}.</h1>
                <p style="margin:0 0 15px 0;line-height:1.6;">Your Cola\'s Club account has been deleted. All your personal data has been removed from our system.</p>
                <p style="margin:0 0 15px 0;line-height:1.6;">If you change your mind, you're always welcome to rejoin our community at any time!</p>
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

// Function to send account deletion email
const sendAccountDeletionEmail = async (user) => {
    console.log('[ACCOUNT DELETION EMAIL] Entered sendAccountDeletionEmail for user:', user.email);
    try {
        const { subject, html } = accountDeletionTemplate(user);
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: user.email,
            subject,
            html
        });
        console.log('[ACCOUNT DELETION EMAIL] Account deletion email sent to user:', user.email);
        return true;
    } catch (error) {
        console.error('[ACCOUNT DELETION EMAIL] Error sending account deletion email:', error);
        return false;
    }
};

module.exports = {
    sendAccountDeletionEmail
}; 