const mongoose = require('mongoose');

const rsvpSchema = new mongoose.Schema({
    eventId: { type: String, required: true },
    username: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    eventSummary: { type: String, required: true },
    eventDate: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RSVP', rsvpSchema);