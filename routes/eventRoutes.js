const express = require('express');
const router = express.Router();
const Event = require('../models/events');
const RSVP = require('../models/rsvp'); // Add RSVP model
const Host = require('../models/host'); // Add Host model
const { ensureAuthenticated, ensureAdmin } = require('../middleware/authMiddleware');
const ICalGenerator = require('ical-generator').default;
const moment = require('moment-timezone');
const nodemailer = require('nodemailer');
const { sendRSVPNotification } = require('../services/adminNotifications');
const { sendRSVPConfirmationEmail } = require('../services/rsvpEmails');

// Configure nodemailer for Hostinger
const transporter = nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true, // use SSL
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Helper function to send admin notification
async function sendAdminNotification(subject, text) {
    console.log('Attempting to send admin notification:', { subject, text });
    
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
        subject: subject,
        text: text
    };

    try {
        console.log('Sending email with options:', {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject
        });
        await transporter.sendMail(mailOptions);
        console.log('Admin notification email sent successfully');
    } catch (emailError) {
        console.error('Error sending admin notification email:', {
            error: emailError.message,
            stack: emailError.stack,
            code: emailError.code,
            command: emailError.command
        });
    }
}

// Fetch all events and render the events page (public with limited info)
router.get('/', async (req, res) => {
    try {
        let query = {};
        
        // Add tag filter if provided
        if (req.query.tag) {
            query.tags = req.query.tag;
        }

        // Add date filter to only show future events
        const now = new Date();
        now.setHours(0, 0, 0, 0); // Set to start of today
        query.dtstart = { $gte: now.toISOString() };

        const events = await Event.find(query).sort({ dtstart: 1 });
        
        // Get all unique tags and their counts (including past events for tag counts)
        const allEvents = await Event.find();
        const tagCounts = {};
        allEvents.forEach(event => {
            if (event.tags) {
                event.tags.forEach(tag => {
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                });
            }
        });

        // Check if user is authenticated
        const isAuthenticated = !!req.session.user;

        // Helper function for formatting image paths
        const formatImagePath = (imagePath) => {
            if (!imagePath) return '';
            if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                return imagePath; // External image, return as is
            }
            if (imagePath.startsWith('static/')) {
                return '/' + imagePath;
            } else if (imagePath.startsWith('/static/')) {
                return imagePath;
            } else {
                return '/static/' + imagePath;
            }
        };

        res.render('events', { 
            events,
            tagCounts,
            selectedTag: req.query.tag || null,
            title: 'Events',
            user: req.session.user,
            moment: moment,
            isAuthenticated, // Pass this to the template
            formatImagePath
        });
    } catch (error) {
        console.error('Error fetching events:', error);
        res.render('events', { 
            title: 'Events', 
            events: [], 
            error: 'Failed to load events', 
            user: req.session.user,
            moment: moment,
            isAuthenticated: !!req.session.user
        });
    }
});

// Fetch all events and render the calendar page (public)
router.get('/calendar', async (req, res) => {
    try {
        console.log('Fetching events for calendar...');
        const events = await Event.find().sort({ dtstart: 1 });
        console.log(`Found ${events.length} events:`, events);
        
        // Log each event's details
        events.forEach((event, index) => {
            console.log(`Event ${index + 1}:`, {
                eventId: event.eventId,
                summary: event.summary,
                dtstart: event.dtstart,
                dtend: event.dtend,
                status: event.status
            });
        });

        res.render('calendar', { 
            title: 'Calendar', 
            events, 
            user: req.session.user,
            moment: moment
        });
    } catch (error) {
        console.error('Error fetching events for /calendar:', error);
        res.render('calendar', { 
            title: 'Calendar', 
            events: [], 
            error: 'Failed to load events', 
            user: req.session.user,
            moment: moment
        });
    }
});

// Fetch a specific event and render its details (protected)
router.get('/event/:id', ensureAuthenticated, async (req, res) => {
    try {
        const event = await Event.findOne({ eventId: req.params.id });
        if (!event) {
            return res.status(404).render('404', { title: 'Not Found', user: req.session.user });
        }

        console.log('Fetched event for /event/:id:', event);

        // Helper function for formatting image paths
        const formatImagePath = (imagePath) => {
            if (!imagePath) return '';
            if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                return imagePath; // External image, return as is
            }
            if (imagePath.startsWith('static/')) {
                return '/' + imagePath;
            } else if (imagePath.startsWith('/static/')) {
                return imagePath;
            } else {
                return '/static/' + imagePath;
            }
        };

        res.render('event_details', { 
            title: `Event: ${event.summary}`, 
            event,
            user: req.session.user,
            formatImagePath,
            moment: moment
        });
    } catch (error) {
        console.error('Error fetching event details:', error);
        res.status(500).render('error', { 
            title: 'Error', 
            error: 'Error fetching event details', 
            user: req.session.user,
            moment: moment
        });
    }
});

// Handle RSVP submission (protected)
router.post('/rsvp/:eventId', ensureAuthenticated, async (req, res) => {
    try {
        console.log('RSVP attempt details:', {
            eventId: req.params.eventId,
            user: req.session.user,
            body: req.body,
            headers: req.headers
        });
        
        // Validate user session
        if (!req.session.user) {
            console.error('No user session found');
            return res.status(401).json({ error: 'You must be logged in to RSVP' });
        }

        // Find event - using the correct field name
        const event = await Event.findOne({ eventId: req.params.eventId });
        if (!event) {
            console.error(`Event not found with ID: ${req.params.eventId}`);
            return res.status(404).json({ error: 'Event not found' });
        }
        console.log('Found event:', event);

        // Initialize rsvps array if it doesn't exist
        if (!event.rsvps) {
            event.rsvps = [];
        }

        // Validate phone number
        const { phoneNumber } = req.body;
        if (!phoneNumber) {
            console.error('Missing phone number in request body');
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Check for existing RSVP
        const existingRSVP = event.rsvps.find(rsvp => rsvp.username === req.session.user.username);
        if (existingRSVP) {
            console.log('User already RSVPed:', {
                username: req.session.user.username,
                eventId: event.eventId
            });
            return res.status(400).json({ error: 'You have already RSVPed to this event' });
        }

        // Parse the date safely with timezone consideration
        let eventDate;
        try {
            // Use the event's timezone, fallback to America/New_York
            const timeZone = event.timezone || 'America/New_York';
            
            // Parse the date string and convert to Date object in the correct timezone
            if (event.dtstart) {
                // Create a moment object in the event's timezone
                const momentDate = moment.tz(event.dtstart, timeZone);
                if (momentDate.isValid()) {
                    eventDate = momentDate.toDate();
                } else {
                    throw new Error('Invalid date format');
                }
            } else {
                eventDate = new Date();
            }
        } catch (error) {
            console.error('Error parsing date:', error);
            eventDate = new Date(); // Fallback to current date
        }

        // Create new RSVP object to add to the event
        const newRSVP = {
            username: req.session.user.username,
            phoneNumber: phoneNumber,
            eventSummary: event.summary || 'Untitled Event',
            eventDate: eventDate,
            createdAt: new Date()
        };

        // Update event with new RSVP
        console.log('Adding new RSVP to event:', newRSVP);
        const updatedEvent = await Event.findOneAndUpdate(
            { eventId: event.eventId },
            { $push: { rsvps: newRSVP } },
            { new: true, runValidators: true }
        );
        
        if (!updatedEvent) {
            throw new Error('Failed to update event with RSVP');
        }
        
        console.log('Successfully updated event with new RSVP');

        // Send admin notification using centralized service
        console.log('Preparing to send RSVP notification email');
        try {
            // Create a temporary RSVP object for email compatibility
            const tempRSVP = {
                eventId: event.eventId,
                username: req.session.user.username,
                phoneNumber: phoneNumber,
                eventSummary: event.summary || 'Untitled Event',
                eventDate: eventDate,
                createdAt: new Date()
            };
            await sendRSVPNotification(event, tempRSVP, req.session.user);
        } catch (emailError) {
            console.error('Failed to send RSVP notification:', emailError);
        }

        // Send confirmation email to the user
        console.log('Preparing to send RSVP confirmation email to user');
        try {
            // Create a temporary RSVP object for email compatibility
            const tempRSVP = {
                eventId: event.eventId,
                username: req.session.user.username,
                phoneNumber: phoneNumber,
                eventSummary: event.summary || 'Untitled Event',
                eventDate: eventDate,
                createdAt: new Date()
            };
            await sendRSVPConfirmationEmail(tempRSVP, req.session.user);
        } catch (emailError) {
            console.error('Failed to send RSVP confirmation email:', emailError);
        }

        // Return success response with updated event data
        res.status(200).json({ 
            success: true,
            message: 'Successfully RSVPed to event',
            rsvps: updatedEvent.rsvps,
            attendeeCount: updatedEvent.rsvps.length
        });
    } catch (error) {
        console.error('Detailed error in RSVP route:', {
            error: error.message,
            stack: error.stack,
            eventId: req.params.eventId,
            user: req.session.user
        });
        res.status(500).json({ error: 'Internal server error during RSVP processing' });
    }
});

// Handle RSVP cancellation (protected)
router.post('/rsvp/:eventId/cancel', ensureAuthenticated, async (req, res) => {
    try {
        console.log('RSVP cancellation attempt:', {
            eventId: req.params.eventId,
            user: req.session.user
        });

        // Validate user session
        if (!req.session.user) {
            console.error('No user session found');
            return res.status(401).json({ error: 'You must be logged in to cancel RSVP' });
        }

        // Find event
        const event = await Event.findOne({ eventId: req.params.eventId });
        if (!event) {
            console.error(`Event not found with ID: ${req.params.eventId}`);
            return res.status(404).json({ error: 'Event not found' });
        }

        // Check if user has RSVPed
        const existingRSVP = event.rsvps.find(rsvp => rsvp.username === req.session.user.username);
        if (!existingRSVP) {
            console.error('User has not RSVPed to this event');
            return res.status(400).json({ error: 'You have not RSVPed to this event' });
        }

        // Remove RSVP from event
        const updatedEvent = await Event.findOneAndUpdate(
            { eventId: event.eventId },
            { $pull: { rsvps: { username: req.session.user.username } } },
            { new: true, runValidators: true }
        );

        if (!updatedEvent) {
            throw new Error('Failed to update event when cancelling RSVP');
        }

        console.log('Successfully cancelled RSVP for user:', req.session.user.username);

        // Return success response
        res.status(200).json({
            success: true,
            message: 'RSVP cancelled successfully',
            rsvps: updatedEvent.rsvps,
            attendeeCount: updatedEvent.rsvps.length
        });

    } catch (error) {
        console.error('Error cancelling RSVP:', error);
        res.status(500).json({ error: 'Internal server error while cancelling RSVP' });
    }
});

// Get RSVP phone numbers for an event (for admin use)
router.get('/event/:id/phone-numbers', ensureAuthenticated, async (req, res) => {
    try {
        // Add authorization check if needed (e.g., only admins can access)
        const rsvps = await RSVP.find({ eventId: req.params.id });
        const phoneNumbers = rsvps.map(rsvp => ({
            username: rsvp.username,
            phoneNumber: rsvp.phoneNumber
        }));
        res.json(phoneNumbers);
    } catch (error) {
        console.error('Error fetching RSVP phone numbers:', error);
        res.status(500).json({ message: 'Error fetching phone numbers', error: error.message });
    }
});

// Route for getting events by tag
router.get('/bytag/:tag', async (req, res) => {
    try {
        const events = await Event.find({
            tags: req.params.tag,
            status: 'approved'
        }).sort({ dtstart: 1 });
        
        res.json(events);
    } catch (error) {
        console.error('Error fetching events by tag:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching events' 
        });
    }
});

// Helper function to create ICS for a single event
function createEventICS(event, req) {
    const calendar = ICalGenerator();
    const baseUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
    calendar.createEvent({
        start: moment(event.dtstart),
        end: moment(event.dtend),
        summary: event.summary,
        description: event.description,
        location: event.location,
        url: `${baseUrl}/events/event/${event.eventId}`
    });
    return calendar;
}

// Download full calendar (protected route)
router.get('/calendar/download', ensureAuthenticated, async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.session.user) {
            return res.status(403).json({ error: 'You must be logged in to access this feature' });
        }

        const events = await Event.find({ 
            dtstart: { $gte: new Date() } // Only future events
        }).sort({ dtstart: 1 });

        const calendar = ICalGenerator();
        calendar.name('Cola\'s Club Events');
        calendar.timezone('America/New_York');
        const baseUrl = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;

        events.forEach(event => {
            calendar.createEvent({
                start: moment(event.dtstart),
                end: moment(event.dtend),
                summary: event.summary,
                description: event.description,
                location: event.location,
                url: `${baseUrl}/events/event/${event.eventId}`
            });
        });

        res.set('Content-Type', 'text/calendar; charset=utf-8');
        res.set('Content-Disposition', 'attachment; filename=soda-city-events.ics');
        res.send(calendar.toString());
    } catch (error) {
        console.error('Error generating calendar:', error);
        res.status(500).json({ error: 'Error generating calendar file' });
    }
});

// Download single event (protected route)
router.get('/event/:id/download', ensureAuthenticated, async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.session.user) {
            return res.status(403).json({ error: 'You must be logged in to access this feature' });
        }

        const event = await Event.findOne({ eventId: req.params.id });
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }

        const calendar = createEventICS(event, req);

        res.set('Content-Type', 'text/calendar; charset=utf-8');
        res.set('Content-Disposition', `attachment; filename=event-${event.eventId}.ics`);
        res.send(calendar.toString());
    } catch (error) {
        console.error('Error generating event ICS:', error);
        res.status(500).json({ error: 'Error generating event file' });
    }
});

// Handle host application submission (protected)
router.post('/host/:eventId', ensureAuthenticated, async (req, res) => {
    try {
        console.log('Host application attempt details:', {
            eventId: req.params.eventId,
            user: req.session.user,
            body: req.body
        });
        
        // Validate user session
        if (!req.session.user) {
            console.error('No user session found');
            return res.status(401).json({ error: 'You must be logged in to apply as host' });
        }

        // Find event
        const event = await Event.findOne({ eventId: req.params.eventId });
        if (!event) {
            console.error(`Event not found with ID: ${req.params.eventId}`);
            return res.status(404).json({ error: 'Event not found' });
        }

        // Check if event already has an approved host
        if (event.host && event.host.username && event.host.status === 'approved') {
            console.error(`Event ${req.params.eventId} already has a host`);
            return res.status(400).json({ error: 'This event already has a host' });
        }

        // Check if user has already applied to host
        if (event.host && event.host.username === req.session.user.username) {
            console.error(`User ${req.session.user.username} has already applied to host event ${req.params.eventId}`);
            return res.status(400).json({ error: 'You have already applied to host this event' });
        }

        // Validate required fields
        if (!req.body.phoneNumber || !req.body.experience) {
            return res.status(400).json({ error: 'Phone number and experience are required' });
        }

        // Parse the date safely with timezone consideration
        let eventDate;
        try {
            const timeZone = event.timezone || 'America/New_York';
            if (event.dtstart) {
                const momentDate = moment.tz(event.dtstart, timeZone);
                if (momentDate.isValid()) {
                    eventDate = momentDate.toDate();
                } else {
                    throw new Error('Invalid date format');
                }
            } else {
                eventDate = new Date();
            }
        } catch (error) {
            console.error('Error parsing date:', error);
            eventDate = new Date();
        }

        // Create new host application object
        const hostApplication = {
            username: req.session.user.username,
            status: 'pending',
            phoneNumber: req.body.phoneNumber,
            experience: req.body.experience,
            appliedAt: new Date()
        };

        // Update event with host application
        const updatedEvent = await Event.findOneAndUpdate(
            { eventId: event.eventId },
            { host: hostApplication },
            { new: true, runValidators: true }
        );

        if (!updatedEvent) {
            throw new Error('Failed to update event with host application');
        }

        console.log('Successfully updated event with host application');

        // Send admin notification
        await sendAdminNotification(
            'New Host Application Submitted',
            `A new host application has been submitted:
            Event: ${event.summary}
            Date: ${new Date(event.dtstart).toLocaleDateString()}
            Host Applicant: ${hostApplication.username}
            Email: ${req.session.user.email}
            Phone Number: ${hostApplication.phoneNumber}
            Experience: ${hostApplication.experience}
            Status: ${hostApplication.status}`
        );

        res.status(200).json({ 
            success: true,
            message: 'Your host application has been submitted successfully and is pending approval'
        });
    } catch (error) {
        console.error('Error in host application route:', error);
        res.status(500).json({ 
            error: 'Internal server error while processing host application' 
        });
    }
});

// Approve/reject host application (admin only)
router.post('/host/:eventId/:username/status', ensureAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const event = await Event.findOne({ eventId: req.params.eventId });
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }

        if (!event.host || event.host.username !== req.params.username) {
            return res.status(404).json({ error: 'Host application not found' });
        }

        // Update host status in the event
        const updateData = {
            'host.status': status
        };

        if (status === 'approved') {
            updateData['host.approvedAt'] = new Date();
            updateData['host.approvedBy'] = req.session.user.username;
        }

        const updatedEvent = await Event.findOneAndUpdate(
            { eventId: req.params.eventId },
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedEvent) {
            throw new Error('Failed to update event with host status');
        }

        console.log('Successfully updated host status:', status);

        // Send admin notification
        await sendAdminNotification(
            'Host Application Status Updated',
            `A host application status has been updated:
            Event: ${event.summary}
            Date: ${new Date(event.dtstart).toLocaleDateString()}
            Host Applicant: ${event.host.username}
            New Status: ${status}
            Updated By: ${req.session.user.username}`
        );

        res.json({ 
            success: true, 
            message: `Host application ${status}`,
            host: updatedEvent.host
        });
    } catch (error) {
        console.error('Error updating host application status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});



module.exports = router;