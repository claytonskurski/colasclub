 // Load environment variables from .env file
require('dotenv').config();

const nodemailer = require('nodemailer');
const { format, addDays, parseISO } = require('date-fns');
const { utcToZonedTime } = require('date-fns-tz');
const User = require('../models/user');
const Event = require('../models/events');
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
    } else {
        console.log('Trial expiration warning email server is ready');
    }
});

/**
 * Get users whose trial expires in 7 days
 */
const getUsersWithExpiringTrials = async () => {
    try {
        const sevenDaysFromNow = addDays(new Date(), 7);
        const startOfDay = new Date(sevenDaysFromNow);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(sevenDaysFromNow);
        endOfDay.setHours(23, 59, 59, 999);

        // For testing, only send to cskurski00@gmail.com
        const users = await User.find({
            email: 'cskurski00@gmail.com'
        }).select('email firstName lastName trialEnd');

        return users;
    } catch (error) {
        console.error('Error fetching users with expiring trials:', error);
        return [];
    }
};

/**
 * Get users whose trial expires in 1 day
 */
const getUsersWithTrialsExpiringTomorrow = async () => {
    try {
        const tomorrow = addDays(new Date(), 1);
        const startOfDay = new Date(tomorrow);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(tomorrow);
        endOfDay.setHours(23, 59, 59, 999);

        const users = await User.find({
            trialEnd: {
                $gte: startOfDay,
                $lte: endOfDay
            },
            accountStatus: 'trial'
        }).select('email firstName lastName trialEnd');

        return users;
    } catch (error) {
        console.error('Error fetching users with trials expiring tomorrow:', error);
        return [];
    }
};

/**
 * Get events from now until the user's trial end date
 */
const getEventsUntilTrialEnd = async (trialEndDate) => {
    try {
        const now = new Date();
        
        // Fetch all events
        const allEvents = await Event.find({});

        // Filter in JS (same approach as eventEmails.js)
        const events = allEvents.filter(ev => {
            try {
                const eventDate = new Date(ev.dtstart);
                return eventDate >= now && eventDate <= trialEndDate;
            } catch {
                return false;
            }
        }).sort((a, b) => new Date(a.dtstart) - new Date(b.dtstart));

        return events;
    } catch (error) {
        console.error('Error fetching events until trial end:', error);
        return [];
    }
};

/**
 * Format event date and time for display
 */
const formatEventDateTime = (event) => {
    try {
        const eventDate = parseISO(event.dtstart);
        const timezone = event.timezone || 'America/New_York';
        const zonedDate = utcToZonedTime(eventDate, timezone);
        
        return format(zonedDate, 'EEEE, MMMM do, yyyy \'at\' h:mm a', {
            timeZone: timezone
        });
    } catch (error) {
        console.error('Error formatting event date:', error);
        return new Date(event.dtstart).toLocaleString();
    }
};

/**
 * Generate HTML for trial expiration warning (7 days)
 */
const generateTrialWarningHTML = (user, events, trialEndDate) => {
    const eventsList = events.map(event => {
        const eventDateTime = formatEventDateTime(event);
        const eventUrl = `${process.env.WEBSITE_URL || 'https://sodacityoutdoors.com'}/events`;
        
        return `
            <div style="background-color:#f8f9fa;padding:20px;border-radius:8px;margin:20px 0;border-left:4px solid #0e747c;">
                <h3 style="color:#2c3e50;margin:0 0 15px 0;font-size:18px;">${event.summary}</h3>
                <p style="color:#666;margin:0 0 20px 0;font-size:14px;"><strong>📅 ${eventDateTime}</strong></p>
                ${event.location ? `<p style="color:#666;margin:0 0 20px 0;font-size:14px;"><strong>📍 ${event.location}</strong></p>` : ''}
                <a href="${eventUrl}" style="background-color:#0e747c;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;display:inline-block;font-weight:bold;font-size:14px;">RSVP for this Event</a>
            </div>
        `;
    }).join('');
    
    const noEventsMessage = `
        <div style="background-color:#f8f9fa;padding:30px;border-radius:8px;margin:20px 0;text-align:center;border-left:4px solid #0e747c;">
            <h3 style="color:#666;margin:0 0 15px 0;">No events scheduled during your trial period</h3>
            <p style="color:#666;margin:0;line-height:1.6;">Submit an event idea and get something on the calendar!</p>
        </div>
    `;
    
    const trialEndFormatted = format(trialEndDate, 'EEEE, MMMM do, yyyy');
    
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Trial Expiration Warning - Soda City Outdoors</title>
        </head>
        <body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8f9fa;">
        <div style="background:#fff;margin:0 auto;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            <div style="text-align:center;margin-bottom:30px;">
                <img src='https://sodacityoutdoors.com/static/images/SCO%20Logo.png' alt='Soda City Outdoors Logo' style='max-width:200px;width:100%;height:auto;display:block;margin:0 auto;'>
            </div>
            
            <h1 style="color:#2c3e50;margin:0 0 20px 0;font-size:24px;">Hello ${user.firstName}!</h1>
            
            <div style="background-color:#fff3cd;border:1px solid #ffeaa7;border-radius:8px;padding:20px;margin:20px 0;">
                <h2 style="color:#856404;margin:0 0 15px 0;font-size:20px;">⚠️ Trial Expiration Reminder</h2>
                <p style="color:#856404;margin:0 0 15px 0;line-height:1.6;font-size:16px;">
                    Just a reminder that your free trial is set to expire on <strong>${trialEndFormatted}</strong> (in 7 days).
                </p>
                <p style="color:#856404;margin:0;line-height:1.6;font-size:16px;">
                    Come check out our upcoming events before your trial ends!
                </p>
            </div>
            
            <h2 style="color:#2c3e50;margin:30px 0 20px 0;font-size:20px;">Upcoming Events During Your Trial Period</h2>
            
            ${events.length > 0 ? eventsList : noEventsMessage}
            
            <div style="background-color:#f8f9fa;padding:20px;border-radius:8px;margin:30px 0;border-left:4px solid #27ae60;">
                <h3 style="color:#2c3e50;margin:0 0 15px 0;font-size:18px;">Don't see anything you're interested in?</h3>
                <p style="color:#666;margin:0 0 20px 0;line-height:1.6;font-size:14px;">
                    Submit an event that you're passionate about, and we'll put it on the calendar and rally up some folks for a fun time!
                </p>
                <a href="${process.env.WEBSITE_URL || 'https://sodacityoutdoors.com'}/submit_event" 
                   style="background-color:#27ae60;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;display:inline-block;font-weight:bold;font-size:14px;">
                    Submit an Event Idea
                </a>
            </div>
            
            <div style="background-color:#f8d7da;border:1px solid #f5c6cb;border-radius:8px;padding:20px;margin:30px 0;">
                <h3 style="color:#721c24;margin:0 0 15px 0;font-size:18px;">No longer interested in joining Soda City Outdoors?</h3>
                <p style="color:#721c24;margin:0 0 20px 0;line-height:1.6;font-size:14px;">
                    Make sure to deactivate your account before your trial ends. You will not be charged for the upcoming period.
                </p>
                <a href="${process.env.WEBSITE_URL || 'https://sodacityoutdoors.com'}/account" 
                   style="background-color:#dc3545;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;display:inline-block;font-weight:bold;font-size:14px;">
                    Manage Your Account
                </a>
            </div>
            
            <p style="margin:30px 0 20px 0;line-height:1.6;font-size:16px;color:#333;text-align:center;font-weight:bold;">
                See you out there! 🌲
            </p>
            
            <div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee;">
                <p style="color:#666;font-size:14px;margin:0;"><strong>Soda City Outdoors</strong></p>
                <p style="color:#666;font-size:12px;margin:5px 0 0 0;">If you have any questions, reply to this email or contact us at <a href="mailto:scoadmin@sodacityoutdoors.com" style="color:#0e747c;text-decoration:none;">scoadmin@sodacityoutdoors.com</a></p>
            </div>
        </div>
        </body>
        </html>
    `;
};

/**
 * Generate HTML for trial expiration warning (1 day)
 */
const generateTrialExpirationTomorrowHTML = (user, trialEndDate) => {
    const trialEndFormatted = format(trialEndDate, 'EEEE, MMMM do, yyyy');
    
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Trial Expires Tomorrow - Soda City Outdoors</title>
        </head>
        <body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8f9fa;">
        <div style="background:#fff;margin:0 auto;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            <div style="text-align:center;margin-bottom:30px;">
                <img src='https://sodacityoutdoors.com/static/images/SCO%20Logo.png' alt='Soda City Outdoors Logo' style='max-width:200px;width:100%;height:auto;display:block;margin:0 auto;'>
            </div>
            
            <h1 style="color:#2c3e50;margin:0 0 20px 0;font-size:24px;">Hello ${user.firstName}!</h1>
            
            <div style="background-color:#fff3cd;border:1px solid #ffeaa7;border-radius:8px;padding:20px;margin:20px 0;">
                <h2 style="color:#856404;margin:0 0 15px 0;font-size:20px;">📅 Trial Expires Tomorrow</h2>
                <p style="color:#856404;margin:0 0 15px 0;line-height:1.6;font-size:16px;">
                    Just a friendly reminder that your free trial expires <strong>tomorrow (${trialEndFormatted})</strong>.
                </p>
                <p style="color:#856404;margin:0;line-height:1.6;font-size:16px;">
                    Your payment will be processed automatically, so you can continue enjoying all our events and member benefits!
                </p>
            </div>
            
            <div style="background-color:#f8f9fa;padding:20px;border-radius:8px;margin:30px 0;border-left:4px solid #6c757d;">
                <h3 style="color:#495057;margin:0 0 15px 0;font-size:18px;">Not Ready to Join?</h3>
                <p style="color:#6c757d;margin:0 0 20px 0;line-height:1.6;font-size:14px;">
                    If you're not interested in continuing, please deactivate your account to avoid any charges.
                </p>
                <a href="${process.env.WEBSITE_URL || 'https://sodacityoutdoors.com'}/account" 
                   style="background-color:#6c757d;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;display:inline-block;font-weight:bold;font-size:14px;">
                    Manage Your Account
                </a>
            </div>
            
            <p style="margin:30px 0 20px 0;line-height:1.6;font-size:16px;color:#333;text-align:center;font-weight:bold;">
                We hope to see you out there! 🌲
            </p>
            
            <div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee;">
                <p style="color:#666;font-size:14px;margin:0;"><strong>Soda City Outdoors</strong></p>
                <p style="color:#666;font-size:12px;margin:5px 0 0 0;">If you have any questions, reply to this email or contact us at <a href="mailto:scoadmin@sodacityoutdoors.com" style="color:#0e747c;text-decoration:none;">scoadmin@sodacityoutdoors.com</a></p>
            </div>
        </div>
        </body>
        </html>
    `;
};

/**
 * Send trial expiration warnings to users (7 days)
 */
const sendTrialExpirationWarnings = async () => {
    try {
        console.log('Starting trial expiration warnings (7 days)...');
        
        const users = await getUsersWithExpiringTrials();
        
        if (users.length === 0) {
            console.log('No users with expiring trials found');
            return;
        }
        
        console.log(`Sending trial expiration warnings to ${users.length} users`);
        
        let successCount = 0;
        let errorCount = 0;
        
        for (const user of users) {
            try {
                const events = await getEventsUntilTrialEnd(user.trialEnd);
                const html = generateTrialWarningHTML(user, events, user.trialEnd);
                
                const mailOptions = {
                    from: process.env.EMAIL_USER || 'scoadmin@sodacityoutdoors.com',
                    to: user.email,
                    subject: `⚠️ Trial Expires in 7 Days - Check Out These Events!`,
                    html: html
                };
                
                await transporter.sendMail(mailOptions);
                successCount++;
                console.log(`Trial expiration warning sent to ${user.email}`);
                
                // Add a small delay to avoid overwhelming the email server
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                errorCount++;
                console.error(`Error sending trial expiration warning to ${user.email}:`, error);
            }
        }
        
        console.log(`Trial expiration warnings completed: ${successCount} sent, ${errorCount} failed`);
        
    } catch (error) {
        console.error('Error in sendTrialExpirationWarnings:', error);
    }
};

/**
 * Send trial expiration warnings to users (1 day)
 */
const sendTrialExpirationTomorrowWarnings = async () => {
    try {
        console.log('Starting trial expiration warnings (1 day)...');
        
        const users = await getUsersWithTrialsExpiringTomorrow();
        
        if (users.length === 0) {
            console.log('No users with trials expiring tomorrow found');
            return;
        }
        
        console.log(`Sending trial expiration tomorrow warnings to ${users.length} users`);
        
        let successCount = 0;
        let errorCount = 0;
        
        for (const user of users) {
            try {
                const html = generateTrialExpirationTomorrowHTML(user, user.trialEnd);
                
                const mailOptions = {
                    from: process.env.EMAIL_USER || 'scoadmin@sodacityoutdoors.com',
                    to: user.email,
                    subject: `⚠️ Trial Expires Tomorrow - Action Required`,
                    html: html
                };
                
                await transporter.sendMail(mailOptions);
                successCount++;
                console.log(`Trial expiration tomorrow warning sent to ${user.email}`);
                
                // Add a small delay to avoid overwhelming the email server
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                errorCount++;
                console.error(`Error sending trial expiration tomorrow warning to ${user.email}:`, error);
            }
        }
        
        console.log(`Trial expiration tomorrow warnings completed: ${successCount} sent, ${errorCount} failed`);
        
    } catch (error) {
        console.error('Error in sendTrialExpirationTomorrowWarnings:', error);
    }
};

/**
 * Manual trigger function for testing
 */
const forceSendTrialWarnings = async () => {
    console.log('🚀 Force sending trial expiration warnings...');
    await sendTrialExpirationWarnings();
};

module.exports = {
    sendTrialExpirationWarnings,
    sendTrialExpirationTomorrowWarnings,
    forceSendTrialWarnings,
    getUsersWithExpiringTrials,
    getUsersWithTrialsExpiringTomorrow,
    generateTrialWarningHTML,
    generateTrialExpirationTomorrowHTML,
    getEventsUntilTrialEnd
}; 