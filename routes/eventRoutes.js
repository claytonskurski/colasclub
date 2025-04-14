const express = require('express');
const router = express.Router();
const Event = require('../models/events');
const RSVP = require('../models/rsvp'); // Add RSVP model
const authMiddleware = require('../middleware/authMiddleware');

// Fetch all events and render the events page (protected)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const events = await Event.find();
        console.log('Fetched events for /events:', events);
        res.render('events', { title: 'Events', events, user: req.session.user });
    } catch (error) {
        console.error('Error fetching events for /events:', error);
        res.render('events', { title: 'Events', events: [], error: 'Failed to load events', user: req.session.user });
    }
});

// Fetch all events and render the calendar page (protected)
router.get('/calendar', authMiddleware, async (req, res) => {
    try {
        const events = await Event.find();
        console.log('Fetched events for /calendar:', events);
        res.render('calendar', { title: 'Calendar', events, user: req.session.user });
    } catch (error) {
        console.error('Error fetching events for /calendar:', error);
        res.render('calendar', { title: 'Calendar', events: [], error: 'Failed to load events', user: req.session.user });
    }
});

// Fetch a specific event and render its details (protected)
router.get('/event/:id', authMiddleware, async (req, res) => {
    try {
        const event = await Event.findOne({ eventId: req.params.id });
        if (!event) {
            return res.status(404).render('404', { title: 'Not Found', user: req.session.user });
        }
        console.log('Fetched event for /event/:id:', event);
        res.render('event_details', { title: `Event: ${event.summary}`, event, user: req.session.user });
    } catch (error) {
        console.error('Error fetching event details:', error);
        res.status(500).render('error', { title: 'Error', error: 'Error fetching event details', user: req.session.user });
    }
});

// Handle RSVP submission (protected)
router.post('/rsvp/:id', authMiddleware, async (req, res) => {
    try {
        const event = await Event.findOne({ eventId: req.params.id });
        if (!event) {
            return res.status(404).render('404', { title: 'Not Found', user: req.session.user });
        }

        const username = req.session.user ? req.session.user.username : 'anonymous';
        const { phoneNumber } = req.body;

        if (!phoneNumber) {
            return res.status(400).render('event_details', {
                title: `Event: ${event.summary}`,
                event,
                user: req.session.user,
                error: 'Phone number is required to RSVP'
            });
        }

        // Check if user has already RSVPed
        if (event.rsvps.includes(username)) {
            return res.status(400).render('event_details', {
                title: `Event: ${event.summary}`,
                event,
                user: req.session.user,
                error: 'You have already RSVPed to this event'
            });
        }

        // Add username to event's rsvps
        event.rsvps.push(username);
        await event.save();

        // Save RSVP details to the RSVP collection
        const rsvp = new RSVP({
            eventId: event.eventId,
            username: username,
            phoneNumber: phoneNumber
        });
        await rsvp.save();

        console.log(`User ${username} RSVPed to event ${event.eventId} with phone number ${phoneNumber}`);

        res.redirect(`/events/event/${req.params.id}`);
    } catch (error) {
        console.error('Error RSVPing to event:', error);
        res.status(500).render('error', { title: 'Error', error: 'Error RSVPing to event', user: req.session.user });
    }
});

// Get RSVP phone numbers for an event (for admin use)
router.get('/event/:id/phone-numbers', authMiddleware, async (req, res) => {
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

module.exports = router;