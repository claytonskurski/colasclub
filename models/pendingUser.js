const mongoose = require('mongoose');

const pendingUserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    password: { type: String, required: true },
    email: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phone: { type: String, required: false },
    waiver: {
        accepted: { type: Boolean, default: false },
        acceptedDate: { type: Date },
        version: { type: String, default: '2025-04-17' },
        ipAddress: { type: String },
        userAgent: { type: String }
    },
    createdAt: { type: Date, default: Date.now, expires: '24h' }
});

module.exports = mongoose.model('PendingUser', pendingUserSchema);