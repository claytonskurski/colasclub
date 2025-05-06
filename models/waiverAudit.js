const mongoose = require('mongoose');

const waiverAuditSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    action: {
        type: String,
        required: true,
        enum: ['create', 'modify', 'delete']
    },
    timestamp: {
        type: Date,
        default: Date.now,
        immutable: true
    },
    previousValue: {
        type: Object,
        required: true,
        immutable: true
    },
    newValue: {
        type: Object,
        required: true,
        immutable: true
    },
    modifiedBy: {
        type: String,
        required: true,
        immutable: true
    },
    ipAddress: {
        type: String,
        required: true,
        immutable: true
    },
    userAgent: {
        type: String,
        required: true,
        immutable: true
    }
});

// Prevent any modifications to audit records
waiverAuditSchema.pre(['save', 'updateOne', 'findOneAndUpdate', 'updateMany'], function(next) {
    if (!this.isNew) {
        return next(new Error('Audit records cannot be modified'));
    }
    next();
});

module.exports = mongoose.model('WaiverAudit', waiverAuditSchema); 