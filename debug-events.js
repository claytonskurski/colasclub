require('dotenv').config();
const mongoose = require('mongoose');
const Event = require('./models/events');
const User = require('./models/user');

async function debug() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB connected successfully');
        
        // Get the user's trial end date
        const user = await User.findOne({ email: 'cskurski00@gmail.com' });
        console.log('User trial end date:', user.trialEnd);
        
        // Get current date
        const now = new Date();
        console.log('Current date:', now);
        
        // Get all events
        const allEvents = await Event.find({}).sort({ dtstart: 1 });
        console.log('Total events in database:', allEvents.length);
        
        // Show last 10 events (most recent)
        const recentEvents = allEvents.slice(-10);
        console.log('\nLast 10 events (most recent):');
        recentEvents.forEach((event, index) => {
            console.log(`Event ${index + 1}:`, {
                summary: event.summary,
                dtstart: event.dtstart,
                location: event.location
            });
        });
        
        // Check events between now and trial end
        const eventsInRange = await Event.find({
            dtstart: {
                $gte: now,
                $lte: user.trialEnd
            }
        }).sort({ dtstart: 1 });
        
        console.log('\nEvents between now and trial end:', eventsInRange.length);
        eventsInRange.forEach((event, index) => {
            console.log(`Event in range ${index + 1}:`, {
                summary: event.summary,
                dtstart: event.dtstart,
                location: event.location
            });
        });
        
    } catch (error) {
        console.error('Debug failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB disconnected');
    }
}

debug(); 