const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    content: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const postSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { 
        type: String, 
        required: true,
        enum: ['General', 'Trip Reports', 'Gear Discussion', 'Event Planning', 'Safety Tips']
    },
    tags: [{ type: String }],
    comments: [commentSchema],
    views: { type: Number, default: 0 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Add text index for search functionality
postSchema.index({ 
    title: 'text', 
    content: 'text',
    tags: 'text'
});

// Add regular indexes for common queries
postSchema.index({ category: 1, createdAt: -1 });
postSchema.index({ author: 1 });
postSchema.index({ tags: 1 });

module.exports = {
    Post: mongoose.model('Post', postSchema),
    Comment: mongoose.model('Comment', commentSchema)
}; 