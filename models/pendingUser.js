const mongoose = require('mongoose');

const pendingUserSchema = new mongoose.Schema({
    stripeCustomerId: { type: String, required: true },
    membership: { type: String, required: true },
    username: { type: String, required: true },
    password: { type: String, required: true },
    email: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phone: { type: String, required: true },
    waiverAccepted: { type: Boolean, default: false },
    waiverAcceptedDate: { type: Date },
    waiverIpAddress: { type: String },
    waiverUserAgent: { type: String },
    createdAt: { type: Date, default: Date.now, expires: '24h' }
});

module.exports = mongoose.model('PendingUser', pendingUserSchema);