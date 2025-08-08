// Load environment variables from .env file
require('dotenv').config();

const nodemailer = require('nodemailer');
const { format, startOfWeek, endOfWeek, isSunday, parseISO, addDays } = require('date-fns');
const { utcToZonedTime } = require('date-fns-tz');
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
    } else {
        console.log('Event email server is ready');
    }
});

/**
 * Get events for the next 7 days from the meta date (now)
 */
const getEventsForNextSevenDays = async () => {
    try {
        const metaDate = new Date();
        const windowStart = metaDate;
        const windowEnd = addDays(metaDate, 7);

        // Fetch all events
        const allEvents = await Event.find({});

        // Filter in JS
        const events = allEvents.filter(ev => {
            try {
                const eventDate = new Date(ev.dtstart);
                return eventDate >= windowStart && eventDate < windowEnd;
            } catch {
                return false;
            }
        }).sort((a, b) => new Date(a.dtstart) - new Date(b.dtstart));

        return events;
    } catch (error) {
        console.error('Error fetching events for next 7 days:', error);
        return [];
    }
};

/**
 * Get ALL users who should receive event emails
 */
const getAllUsers = async () => {
    try {
        const users = await User.find({
            email: { $exists: true, $ne: '' },
            accountStatus: { $ne: 'inactive' }
        }).select('email firstName lastName');
        
        return users;
    } catch (error) {
        console.error('Error fetching users:', error);
        return [];
    }
};

/**
 * Format event date for display
 */
const formatEventDateTime = (event) => {
    try {
        const eventDate = parseISO(event.dtstart);
        return format(eventDate, 'EEEE, MMMM do, yyyy');
    } catch (error) {
        console.error('Error formatting event date:', error);
        return new Date(event.dtstart).toLocaleDateString();
    }
};

/**
 * Generate HTML for weekly event summary
 */
const generateWeeklySummaryHTML = (user, events) => {
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
            <h3 style="color:#666;margin:0 0 15px 0;">No events scheduled this week</h3>
            <p style="color:#666;margin:0;line-height:1.6;">Perfect time to submit an event idea and get something on the calendar!</p>
        </div>
    `;
    
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>This Week's Events - Soda City Outdoors</title>
        </head>
        <body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8f9fa;">
        <div style="background:#fff;margin:0 auto;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            <div style="text-align:center;margin-bottom:30px;">
                <img src='https://sodacityoutdoors.com/static/images/SCO%20Logo.png' alt='Soda City Outdoors Logo' style='max-width:200px;width:100%;height:auto;display:block;margin:0 auto;'>
            </div>
            
            <h1 style="color:#2c3e50;margin:0 0 20px 0;font-size:24px;">Hello ${user.firstName}!</h1>
            
            <p style="margin:0 0 25px 0;line-height:1.6;font-size:16px;color:#333;">
                Check out the exciting events we have scheduled for this upcoming week! See anything that catches your interest? 
                RSVP and get outdoors to connect with fellow adventurers in our community.
            </p>
            
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
 * Send weekly event summaries to ALL users
 */
const sendWeeklySummaries = async () => {
    try {
        console.log('Starting weekly event summaries...');
        
        const events = await getEventsForNextSevenDays();
        const users = await getAllUsers();
        
        if (users.length === 0) {
            console.log('No users found, skipping weekly summaries');
            return;
        }
        
        console.log(`Sending weekly summaries for ${events.length} events to ${users.length} users`);
        
        let successCount = 0;
        let errorCount = 0;
        
        for (const user of users) {
            try {
                const html = generateWeeklySummaryHTML(user, events);
                
                const mailOptions = {
                    from: process.env.EMAIL_USER || 'scoadmin@sodacityoutdoors.com',
                    to: user.email,
                    subject: `🌲 This Week's Events: ${events.length} Adventure${events.length === 1 ? '' : 's'} Coming Up!`,
                    html: html
                };
                
                await transporter.sendMail(mailOptions);
                successCount++;
                console.log(`Weekly summary sent to ${user.email}`);
                
                // Add a small delay to avoid overwhelming the email server
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                errorCount++;
                console.error(`Error sending weekly summary to ${user.email}:`, error);
            }
        }
        
        console.log(`Weekly summaries completed: ${successCount} sent, ${errorCount} failed`);
        
    } catch (error) {
        console.error('Error in sendWeeklySummaries:', error);
    }
};

/**
 * Check if it's Monday at 9 AM for weekly summaries
 * More flexible check that allows for a 1-hour window
 */
const shouldSendWeeklySummary = () => {
    const now = new Date();
    const isMondayToday = now.getDay() === 1; // 1 = Monday
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // Check if it's Monday and between 9:00 AM and 9:59 AM
    const shouldSend = isMondayToday && currentHour === 9;
    
    // Add logging for debugging
    console.log(`[${now.toISOString()}] Weekly summary check:`, {
        isMonday: isMondayToday,
        currentHour,
        currentMinute,
        shouldSend
    });
    
    return shouldSend;
};

/**
 * Main function to run email checks
 */
const runEmailChecks = async () => {
    try {
        // Check for weekly summaries (only on Sundays at 6 PM)
        if (shouldSendWeeklySummary()) {
            await sendWeeklySummaries();
        }
        
    } catch (error) {
        console.error('Error in runEmailChecks:', error);
    }
};

/**
 * Manual trigger functions for testing
 */
const triggerWeeklySummaries = async () => {
    console.log('Manually triggering weekly summaries...');
    await sendWeeklySummaries();
};

/**
 * Force send weekly summaries (for testing - bypasses time check)
 */
const forceSendWeeklySummaries = async () => {
    console.log('🚀 Force sending weekly summaries (bypassing time check)...');
    await sendWeeklySummaries();
};

module.exports = {
    sendWeeklySummaries,
    runEmailChecks,
    triggerWeeklySummaries,
    forceSendWeeklySummaries,
    getEventsForNextSevenDays
}; 