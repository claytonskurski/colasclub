const mongoose = require('mongoose');

const galleryItemSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Gallery item must have a title'],
        trim: true,
        maxlength: [100, 'Title cannot be more than 100 characters']
    },
    description: {
        type: String,
        trim: true,
        maxlength: [500, 'Description cannot be more than 500 characters']
    },
    imageUrls: [{
        type: String,
        required: [true, 'Gallery item must have at least one image URL']
    }],
    uploadDate: {
        type: Date,
        default: Date.now
    },
    // Optional: Add user reference if you want to track who uploaded it
     uploadedBy: {
         type: mongoose.Schema.ObjectId,
         ref: 'User' 
     }
});

// Optional: Indexing for faster queries if needed
// galleryItemSchema.index({ uploadDate: -1 }); 

const GalleryItem = mongoose.model('GalleryItem', galleryItemSchema);

module.exports = GalleryItem; 