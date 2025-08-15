const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const validator = require('validator');

// Create Nodemailer transporter for Hostinger
const transporter = nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true, // use SSL
    auth: {
        user: process.env.EMAIL_USER, // your full email address
        pass: process.env.EMAIL_PASS  // your email password
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
        console.log('Email server is ready to send messages');
    }
});

// Stricter rate limiting for contact form submissions
const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour window
    max: 3, // limit each IP to 3 requests per hour
    message: 'Too many contact form submissions, please try again later.',
    skipFailedRequests: false, // count failed requests
    standardHeaders: true // Return rate limit info in the `RateLimit-*` headers
});

// Common spam phrases and patterns
const spamPatterns = [
    'buy now',
    'click here',
    'earn money',
    'make money',
    'win',
    'winner',
    'lottery',
    'prize',
    'bitcoin',
    'crypto',
    'investment',
    'casino',
    'viagra',
    'dating',
    'sexy',
    'hot singles',
    'weight loss',
    'diet',
    'http://',
    'https://',
    'www.',
    '.ru',
    '.cn',
    '[url=',
    '[/url]',
    '<a href',
    'SEO',
    'marketing services',
    'boost ranking',
    'cheap',
    'free trial',
    // Additional patterns for sophisticated spam
    'improve performance',
    'help improve',
    'couple of small things',
    'let me know if you\'d like',
    'check your site',
    'performance improvements',
    'site optimization',
    'website performance',
    'digital marketing',
    'online presence',
    'traffic boost',
    'ranking improvement'
];

// Spam check function
function isSpam(name, email, message) {
    // Convert all content to lowercase for checking
    const content = `${name} ${email} ${message}`.toLowerCase();
    
    // Basic validation
    if (!validator.isEmail(email)) return true;
    if (name.length < 2 || message.length < 10) return true;
    if (name.length > 100 || message.length > 5000) return true;
    
    // Check for spam patterns
    if (spamPatterns.some(pattern => content.includes(pattern.toLowerCase()))) return true;
    
    // Check for repetitive characters
    if (/(.)\1{4,}/.test(content)) return true; // e.g., "aaaaa"
    
    // Check for excessive uppercase
    const upperCasePercentage = (message.match(/[A-Z]/g) || []).length / message.length;
    if (upperCasePercentage > 0.5) return true;
    
    // Check for numeric or special character density
    const nonAlphaPercentage = (message.match(/[^a-zA-Z\s]/g) || []).length / message.length;
    if (nonAlphaPercentage > 0.4) return true;

    // Check for suspicious email patterns
    const emailDomain = email.split('@')[1];
    if (emailDomain) {
        // Check for suspicious domain patterns
        const suspiciousDomains = [
            'gmail.com', // Common in spam, but also legitimate
            'yahoo.com',
            'hotmail.com',
            'outlook.com'
        ];
        
        // If it's a common free email provider, apply stricter checks
        if (suspiciousDomains.includes(emailDomain.toLowerCase())) {
            // Check for name/email mismatch patterns
            const nameWords = name.toLowerCase().split(/\s+/);
            const emailUsername = email.split('@')[0].toLowerCase();
            
            // If name doesn't appear in email username, it's suspicious
            const nameInEmail = nameWords.some(word => 
                word.length > 2 && emailUsername.includes(word)
            );
            
            if (!nameInEmail && nameWords.length > 0) {
                // Additional check for common spam patterns in the message
                const suspiciousMessagePatterns = [
                    'check your site',
                    'improve performance',
                    'couple of things',
                    'let me know if you\'d like'
                ];
                
                if (suspiciousMessagePatterns.some(pattern => 
                    message.toLowerCase().includes(pattern)
                )) {
                    return true;
                }
            }
        }
    }

    return false;
}

// GET contact page
router.get('/', (req, res) => {
    res.render('contact', { 
        title: 'Contact Us',
        user: req.session.user
    });
});

// POST contact form submission
router.post('/submit', contactLimiter, async (req, res) => {
    try {
        const { name, email, message, honeypot } = req.body;
        
        // Check honeypot field - if it's filled out, it's probably a bot
        if (honeypot) {
            console.log('Honeypot triggered - likely bot submission');
            return res.status(400).json({
                success: false,
                message: 'Form submission failed.'
            });
        }

        // Validate required fields
        if (!name || !email || !message) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required.'
            });
        }

        // Check for spam
        if (isSpam(name, email, message)) {
            console.log('Spam detected from:', email);
            console.log('Spam details:', {
                name: name,
                email: email,
                messageLength: message.length,
                timestamp: new Date().toISOString(),
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
            return res.status(400).json({
                success: false,
                message: 'Your message was flagged as potential spam. Please try again with appropriate content.'
            });
        }
        
        console.log('Processing contact form submission from:', email);

        // Prepare email content
        const emailContent = `
            <h3>New Contact Form Submission</h3>
            <p><strong>From:</strong> ${validator.escape(name)}</p>
            <p><strong>Email:</strong> ${validator.escape(email)}</p>
            <p><strong>Message:</strong></p>
            <p>${validator.escape(message)}</p>
            <hr>
            <p><em>An auto-reply has been sent to the user with the following message:</em></p>
            <div style="background: #f5f5f5; padding: 15px; margin-top: 20px;">
                <h4>Auto-reply sent to user:</h4>
                <p>Dear ${validator.escape(name)},</p>
                <p>We have received your message and will get back to you as soon as possible during our office hours:</p>
                <ul>
                    <li>Monday - Thursday: 8am - Noon</li>
                    <li>Friday - Sunday: Closed</li>
                </ul>
                <p>Best regards,<br>The Cola\'s Club Team</p>
            </div>
        `;

        // Send email using Nodemailer
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: 'admin@colasclub.com',
            subject: `New Contact Form Submission from ${name}`,
            html: emailContent,
            replyTo: email
        };

        console.log('Attempting to send email...');
        
        try {
            await transporter.sendMail(mailOptions);
            console.log('Email sent successfully');
        } catch (emailError) {
            console.error('Detailed Email Error:', {
                code: emailError.code,
                message: emailError.message,
                response: emailError.response || 'No response details'
            });
            throw emailError;
        }

        res.json({ 
            success: true,
            message: 'Thank you for your message. We will get back to you soon!' 
        });
    } catch (error) {
        console.error('Error processing contact form:', error);
        res.status(500).json({ 
            success: false, 
            message: 'There was an error sending your message. Please try again later.' 
        });
    }
});

module.exports = router; 