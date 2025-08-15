const nodemailer = require('nodemailer');
const { format, utcToZonedTime } = require('date-fns-tz');

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
        console.log('Account pause notification email server is ready');
    }
});

// Send account pause notification to user
const sendAccountPauseNotification = async (user, pauseReason, resolutionSteps) => {
    console.log('[ACCOUNT PAUSE] Sending pause notification to user:', user.email);
    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn('Email configuration not found');
        return false;
    }

    const mailOptions = {
        from: process.env.EMAIL_USER || 'admin@colasclub.com',
        to: user.email,
        subject: 'Your Cola\'s Club Account Has Been Paused',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <h2 style="color: #e74c3c; margin-bottom: 20px; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">
                        ⚠️ Account Paused
                    </h2>
                    
                    <p style="color: #2c3e50; font-size: 16px; line-height: 1.6;">
                        Hi ${user.firstName},
                    </p>
                    
                    <p style="color: #2c3e50; font-size: 16px; line-height: 1.6;">
                        We've temporarily paused your Cola's Club account. 
                        This means you won't be able to RSVP for events or access member benefits until this is resolved.
                    </p>
                    
                    <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 6px; margin: 20px 0;">
                        <h3 style="color: #856404; margin-top: 0;">Account Status</h3>
                        <p style="color: #856404; margin: 8px 0;"><strong>Your account has been temporarily paused.</strong></p>
                    </div>
                    
                    <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; padding: 20px; border-radius: 6px; margin: 20px 0;">
                        <h3 style="color: #0c5460; margin-top: 0;">How to Resolve</h3>
                        <p style="color: #0c5460; margin: 8px 0; line-height: 1.6;">
                            To reactivate your account, please contact us directly:
                        </p>
                        <p style="color: #0c5460; margin: 8px 0; line-height: 1.6;">
                            📧 <a href="mailto:admin@colasclub.com" style="color: #007bff; font-weight: bold;">admin@colasclub.com</a>
                        </p>
                        <p style="color: #0c5460; margin: 8px 0; line-height: 1.6;">
                            We'll work with you to get your account reactivated quickly.
                        </p>
                    </div>
                    
                    <div style="background-color: #e8f5e8; border: 1px solid #c3e6c3; padding: 20px; border-radius: 6px; margin: 20px 0;">
                        <h3 style="color: #2d5a2d; margin-top: 0;">Manage Your Account</h3>
                        <p style="color: #2d5a2d; margin: 8px 0;">
                            You can view your account status and manage your settings through your account page.
                        </p>
                        <a href="${process.env.WEBSITE_URL || 'https://colasclub.fun'}/account" 
                           style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 14px;">
                            Go to Account Settings
                        </a>
                    </div>
                    
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0;">
                        <h3 style="color: #495057; margin-top: 0;">Need Help?</h3>
                        <p style="color: #6c757d; margin: 8px 0;">
                            If you have any questions or need assistance, please contact us at:
                        </p>
                        <p style="color: #6c757d; margin: 8px 0;">
                            📧 <a href="mailto:admin@colasclub.com" style="color: #007bff;">admin@colasclub.com</a>
                        </p>
                        <p style="color: #6c757d; margin: 8px 0;">
                            We're here to help you get back to enjoying outdoor adventures with our community!
                        </p>
                    </div>
                    
                    <p style="color: #7f8c8d; font-size: 14px; margin-top: 20px;">
                        Thank you for being part of Cola's Club!
                    </p>
                </div>
            </div>
        `,
        text: `
Account Paused - Cola's Club

Hi ${user.firstName},

We've temporarily paused your Cola's Club account. 
This means you won't be able to RSVP for events or access member benefits until this is resolved.

Reason for Pause: ${pauseReason}

How to Resolve:
${resolutionSteps.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()}

Need Help?
If you have any questions or need assistance, please contact us at:
admin@colasclub.com

We're here to help you get back to enjoying outdoor adventures with our community!

Thank you for being part of Cola's Club!
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('[ACCOUNT PAUSE] Pause notification sent successfully to:', user.email);
        return true;
    } catch (error) {
        console.error('[ACCOUNT PAUSE] Error sending pause notification:', error);
        return false;
    }
};

// Handle account pause with manual resolution
const handleAccountPause = async (user, pauseReason) => {
    return await sendAccountPauseNotification(user, pauseReason, '');
};

module.exports = {
    sendAccountPauseNotification,
    handleAccountPause
}; 