const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const Event = require('../models/events');
const RSVP = require('../models/rsvp');

async function syncRSVPs() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Get all events
        const events = await Event.find();
        console.log(`Found ${events.length} events to process`);

        for (const event of events) {
            // Get all valid RSVPs for this event
            const validRSVPs = await RSVP.find({ eventId: event.eventId });
            const validUsernames = validRSVPs.map(rsvp => rsvp.username);

            // Update event's rsvps array to match valid RSVPs
            const updatedEvent = await Event.findOneAndUpdate(
                { eventId: event.eventId },
                { $set: { rsvps: validUsernames } },
                { new: true }
            );

            console.log(`Synced RSVPs for event ${event.summary}:`, {
                eventId: event.eventId,
                previousRSVPs: event.rsvps?.length || 0,
                newRSVPs: validUsernames.length
            });
        }

        console.log('RSVP sync completed successfully');
    } catch (error) {
        console.error('Error syncing RSVPs:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

// Run the sync
syncRSVPs(); 