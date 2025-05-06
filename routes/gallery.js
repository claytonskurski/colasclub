const express = require('express');
const GalleryItem = require('../models/GalleryItem'); // Adjust path if necessary
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- Multer Configuration for File Uploads ---

// Define the destination directory
const UPLOAD_DIR = path.join(__dirname, '..', 'public_html', 'uploads', 'gallery');

// Ensure the upload directory exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Configure disk storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        // Create a unique filename: timestamp + originalname
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_')); // Replace spaces
    }
});

// File filter function
const fileFilter = (req, file, cb) => {
    // Accept only specific image types
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = allowedTypes.test(file.mimetype);
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
        return cb(null, true);
    }
    cb(new Error('Error: File upload only supports the following filetypes - ' + allowedTypes), false);
};

// Multer middleware instance
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: fileFilter
}).array('galleryImages', 10); // Allow up to 10 images

// --- Routes ---

// GET /gallery - Display the gallery page
router.get('/', async (req, res, next) => {
    try {
        const galleryItems = await GalleryItem.find().sort({ uploadDate: -1 }); // Fetch newest first
        
        res.render('gallery', { 
            title: 'Gallery', 
            galleryItems: galleryItems,
            user: req.user // Pass user if needed for layout/auth checks
        });
    } catch (err) {
        console.error("Error fetching gallery items:", err);
        // Simple error handling for now, render error page or pass to error handler
        res.status(500).send("Error loading gallery"); 
        // Or use next(err) if you have a centralized error handler
    }
});

// GET /gallery/upload - Display the upload form
router.get('/upload', (req, res) => {
    // Optional: Add middleware here later to check if user is admin/allowed to upload
    res.render('gallery_upload', { 
        title: 'Upload Gallery Image',
        user: req.user
    });
});

// POST /gallery/upload - Handle the image upload and data saving
router.post('/upload', upload, async (req, res) => {
    if (!req.files || req.files.length === 0) {
        console.log("Upload attempt failed: No files or invalid file types.");
        return res.status(400).send('Upload failed. Check file types and sizes.');
    }

    try {
        const { title, description } = req.body;
        const imageUrls = req.files.map(file => '/static/uploads/gallery/' + file.filename);

        const newGalleryItem = new GalleryItem({
            title: title,
            description: description,
            imageUrls: imageUrls
        });

        await newGalleryItem.save();

        console.log('Gallery item saved:', newGalleryItem);
        res.redirect('/gallery');

    } catch (err) {
        console.error("Error saving gallery item:", err);
        req.files.forEach(file => {
            fs.unlink(file.path, (unlinkErr) => {
                if (unlinkErr) console.error("Error deleting uploaded file after DB error:", unlinkErr);
            });
        });
        res.status(500).send('Error saving gallery item to database.');
    }
});

// Note: Routes for adding/editing/deleting gallery items would go here later.
// e.g., router.post('/add', ...)

module.exports = router; 