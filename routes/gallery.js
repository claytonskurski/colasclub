const express = require('express');
const GalleryItem = require('../models/GalleryItem'); // Adjust path if necessary
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');

// --- Constants ---
const UPLOAD_DIR = path.join(__dirname, '..', 'public_html', 'uploads', 'gallery');
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumbnails');

// Ensure upload directories exist
async function ensureDirectories() {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.mkdir(THUMB_DIR, { recursive: true });
}
ensureDirectories();

// Configure disk storage
const storage = multer.diskStorage({
    destination: async function (req, file, cb) {
        await ensureDirectories();
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, uniqueSuffix + ext);
    }
});

// File filter function
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = allowedTypes.test(file.mimetype);
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
        return cb(null, true);
    }
    cb(new Error('Only image files (JPEG, PNG, GIF, WEBP) are allowed!'), false);
};

// Multer middleware instance
const upload = multer({
    storage: storage,
    limits: { 
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 20 // Allow up to 20 files at once
    },
    fileFilter: fileFilter
}).array('galleryImages', 20);

// Image processing function
async function processImage(file) {
    const originalPath = file.path;
    const filename = path.basename(file.path);
    const thumbFilename = `thumb_${filename}`;
    const thumbPath = path.join(THUMB_DIR, thumbFilename);
    
    try {
        // Create optimized main image
        await sharp(originalPath)
            .resize(1920, 1080, { 
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 80 })
            .toFile(originalPath + '_optimized');

        // Create thumbnail
        await sharp(originalPath)
            .resize(300, 300, { 
                fit: 'cover',
                position: 'centre'
            })
            .jpeg({ quality: 70 })
            .toFile(thumbPath);

        // Replace original with optimized version
        await fs.unlink(originalPath);
        await fs.rename(originalPath + '_optimized', originalPath);

        return {
            mainUrl: `/static/uploads/gallery/${filename}`,
            thumbnailUrl: `/static/uploads/gallery/thumbnails/${thumbFilename}`
        };
    } catch (error) {
        console.error('Error processing image:', error);
        throw error;
    }
}

// --- Routes ---

// GET /gallery - Display the gallery page
router.get('/', async (req, res, next) => {
    try {
        const galleryItems = await GalleryItem.find().sort({ uploadDate: -1 });
        res.render('gallery', { 
            title: 'Gallery', 
            galleryItems: galleryItems,
            user: req.user
        });
    } catch (err) {
        next(err);
    }
});

// GET /gallery/upload - Display the upload form
router.get('/upload', (req, res) => {
    res.render('gallery_upload', { 
        title: 'Upload Gallery Images',
        user: req.user
    });
});

// POST /gallery/upload - Handle the image upload and data saving
router.post('/upload', async (req, res) => {
    try {
        // Handle file upload
        await new Promise((resolve, reject) => {
            upload(req, res, function(err) {
                if (err instanceof multer.MulterError) {
                    reject(new Error(`Upload error: ${err.message}`));
                } else if (err) {
                    reject(err);
                }
                resolve();
            });
        });

        if (!req.files || req.files.length === 0) {
            throw new Error('No files were uploaded.');
        }

        // Process all images
        const processedImages = await Promise.all(req.files.map(processImage));

        // Create gallery item
        const newGalleryItem = new GalleryItem({
            title: req.body.title,
            description: req.body.description,
            imageUrls: processedImages.map(img => img.mainUrl),
            thumbnailUrls: processedImages.map(img => img.thumbnailUrl)
        });

        await newGalleryItem.save();
        
        res.json({ 
            success: true, 
            message: 'Images uploaded successfully',
            redirect: '/gallery'
        });

    } catch (error) {
        console.error('Upload error:', error);
        
        // Clean up any uploaded files if there was an error
        if (req.files) {
            await Promise.all(req.files.map(file => 
                fs.unlink(file.path).catch(err => console.error('Error deleting file:', err))
            ));
        }
        
        res.status(400).json({ 
            success: false, 
            error: error.message || 'Error uploading images'
        });
    }
});

// Note: Routes for adding/editing/deleting gallery items would go here later.
// e.g., router.post('/add', ...)

module.exports = router; 