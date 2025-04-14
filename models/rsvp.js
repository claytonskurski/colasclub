const mongoose = require('mongoose');

const rsvpSchema = new mongoose.Schema({
    eventId: { type: String, required: true },
    username: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RSVP', rsvpSchema);