const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
    title: { 
        type: String, 
        required: true 
    },
    description: { 
        type: String, 
        required: true 
    },
    category: { 
        type: String, 
        required: true,
        enum: [
            'Educational',
            'Gear Shops',
            'Trail Maps',
            'Safety Guidelines',
            'Weather Resources',
            'Local Parks',
            'Outfitters'
        ]
    },
    link: { 
        type: String,
        required: true 
    },
    image: { 
        type: String 
    },
    tags: [{ 
        type: String 
    }],
    location: {
        name: String,
        address: String,
        coordinates: {
            lat: Number,
            lng: Number
        }
    },
    rating: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
    },
    reviews: [{
        user: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'User' 
        },
        rating: Number,
        comment: String,
        date: { 
            type: Date, 
            default: Date.now 
        }
    }],
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
    updatedAt: { 
        type: Date, 
        default: Date.now 
    }
});

// Add indexes for better query performance
resourceSchema.index({ category: 1 });
resourceSchema.index({ tags: 1 });
resourceSchema.index({ 
    title: 'text', 
    description: 'text',
    tags: 'text'
});

module.exports = mongoose.model('Resource', resourceSchema); 