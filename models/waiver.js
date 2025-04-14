const mongoose = require('mongoose');

const waiverSchema = new mongoose.Schema({
    user: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    fullName: { 
        type: String, 
        required: true 
    },
    email: { 
        type: String, 
        required: true 
    },
    phoneNumber: { 
        type: String, 
        required: true 
    },
    emergencyContact: {
        name: { type: String, required: true },
        relationship: { type: String, required: true },
        phoneNumber: { type: String, required: true }
    },
    acknowledgements: {
        riskAwareness: { type: Boolean, required: true },
        medicalConditions: { type: Boolean, required: true },
        followInstructions: { type: Boolean, required: true },
        photoRelease: { type: Boolean, required: true }
    },
    signature: { 
        type: String, 
        required: true 
    },
    dateAccepted: { 
        type: Date, 
        default: Date.now 
    },
    ipAddress: String,
    userAgent: String,
    isActive: { 
        type: Boolean, 
        default: true 
    },
    expirationDate: { 
        type: Date,
        default: () => {
            const date = new Date();
            date.setFullYear(date.getFullYear() + 1);
            return date;
        }
    }
});

// Add indexes for common queries
waiverSchema.index({ user: 1 });
waiverSchema.index({ email: 1 });
waiverSchema.index({ isActive: 1 });
waiverSchema.index({ expirationDate: 1 });

module.exports = mongoose.model('Waiver', waiverSchema); 