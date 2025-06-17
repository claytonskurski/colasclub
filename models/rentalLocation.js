const mongoose = require('mongoose');

const rentalLocationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  address: { type: String, required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  notes: { type: String },
  image: { type: String }
}, {
  timestamps: true,
  collection: 'rentallocations'
});

module.exports = mongoose.model('RentalLocation', rentalLocationSchema); 