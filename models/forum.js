const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    content: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, {
    timestamps: true
});

const postSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    comments: [commentSchema]
}, {
    timestamps: true
});

// Add text index for search functionality
postSchema.index({ 
    title: 'text', 
    content: 'text'
});

// Add regular indexes for common queries
postSchema.index({ author: 1 });

module.exports = {
    Post: mongoose.model('Post', postSchema)
}; 