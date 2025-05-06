const mongoose = require('mongoose');

const hostSchema = new mongoose.Schema({
    eventId: { type: String, required: true },
    username: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    experience: { type: String, required: true },
    eventSummary: { type: String, required: true },
    eventDate: { type: Date, required: true },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    createdAt: { type: Date, default: Date.now }
});

// Add a compound unique index to prevent multiple host applications for the same event
hostSchema.index({ eventId: 1, username: 1 }, { unique: true });

module.exports = mongoose.model('Host', hostSchema); 