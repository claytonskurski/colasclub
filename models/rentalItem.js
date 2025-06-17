const mongoose = require('mongoose');

const rentalItemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    type: { type: String, required: true, enum: ['kayak', 'tube', 'paddleboard', 'other'] },
    quantityAvailable: { type: Number, required: true, min: 0 },
    priceHalfDay: { type: Number, required: true },
    priceFullDay: { type: Number, required: true },
    stripePriceIdHalfDay: { type: String },
    stripePriceIdFullDay: { type: String },
    isActive: { type: Boolean, default: true }
}, {
    timestamps: true
});

module.exports = mongoose.model('RentalItem', rentalItemSchema); 