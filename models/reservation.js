const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false }, // null for guests
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    rentalItem: { type: mongoose.Schema.Types.ObjectId, ref: 'RentalItem', required: true },
    date: { type: Date, required: true },
    interval: { type: String, required: true, enum: ['half-day', 'full-day'] },
    timeBlock: {
        type: String,
        enum: ['AM', 'PM'],
        required: function() { return this.interval === 'half-day'; }
    },
    quantity: { type: Number, required: true, min: 1 },
    total: { type: Number, required: true },
    paymentStatus: { type: String, enum: ['paid', 'unpaid'], default: 'unpaid' },
    paymentMethod: { type: String, enum: ['stripe', 'cash'], required: true },
    location: { type: mongoose.Schema.Types.ObjectId, ref: 'RentalLocation', required: true },
    locationName: { type: String, required: true },
    equipmentType: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Reservation', reservationSchema); 