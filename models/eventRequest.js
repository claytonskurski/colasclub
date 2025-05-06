const mongoose = require('mongoose');

const eventRequestSchema = new mongoose.Schema({
    summary: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    location: {
        type: String,
        required: true
    },
    startDate: {
        type: Date,
        required: true
    },
    duration: {
        type: Number,
        required: true
    },
    difficulty: {
        type: String,
        enum: ['easy', 'moderate', 'challenging', 'difficult'],
        required: true
    },
    tags: [{
        type: String
    }],
    maxParticipants: {
        type: Number,
        required: true
    },
    requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('EventRequest', eventRequestSchema, 'requests'); 