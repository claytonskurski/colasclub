const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  summary: String,
  description: String,
  dtstart: { 
    type: String, 
    required: true,
    validate: {
      validator: function(v) {
        // Validate ISO 8601 format with timezone
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/.test(v);
      },
      message: props => `${props.value} is not a valid ISO 8601 datetime with timezone!`
    }
  },
  dtend: { 
    type: String, 
    required: true,
    validate: {
      validator: function(v) {
        // Validate ISO 8601 format with timezone
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/.test(v);
      },
      message: props => `${props.value} is not a valid ISO 8601 datetime with timezone!`
    }
  },
  location: String,
  image: String,
  images: [{ type: String }],
  tags: [{ type: String }],
  attendees: [{ type: String }],
  rsvps: [{ type: String }],
  status: { 
    type: String, 
    enum: ['approved', 'pending', 'rejected'],
    default: 'pending'
  },
  host: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  event_type: {
    type: String,
    enum: ['FLAGSHIP', 'PROMOTIONAL', 'REGULAR'],
    default: 'REGULAR',
    required: true
  },
  link: { type: String },
  type: { type: String },
  region: { type: String },
  suggestedBy: { 
    type: mongoose.Schema.Types.Mixed,
    default: 'system'
  },
  timezone: {
    type: String,
    default: 'America/New_York',
    required: true
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
eventSchema.index({ event_type: 1 });
eventSchema.index({ host: 1 });

module.exports = mongoose.model('Event', eventSchema);