const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  summary: String,
  description: String,
  dtstart: { type: String, required: true }, // Changed to String
  dtend: { type: String, required: true },   // Changed to String
  location: String,
  image: String, // Optional; remove if not needed
  tags: [{ type: String }], // Added tags array
  attendees: [{ type: String }], // Simplified to match empty arrays in data
  rsvps: [{ type: String }],
  status: { 
    type: String, 
    enum: ['approved', 'pending', 'rejected'],
    default: 'pending'
  },
  suggestedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Add indexes for better query performance
eventSchema.index({ tags: 1 });
eventSchema.index({ status: 1 });
eventSchema.index({ dtstart: 1 });

module.exports = mongoose.model('Event', eventSchema);