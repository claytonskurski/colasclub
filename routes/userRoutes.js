const express = require('express');
const router = express.Router();
const User = require('../models/user');
const PendingUser = require('../models/pendingUser');
const bcrypt = require('bcryptjs');
const { ensureAuthenticated, ensureAdmin } = require('../middleware/authMiddleware');

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Event = require('../models/events');
const RSVP = require('../models/rsvp');
const Host = require('../models/host');
const { sendNewUserNotification } = require('../services/adminNotifications');

// Configure multer for handling file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'public_html/uploads/profile-photos';
        // Create the uploads directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Generate unique filename using timestamp and original extension
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        // Accept only image files
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});







// Register user (called programmatically after waiver acceptance)
router.post('/register', async (req, res) => {
    console.log('==== /api/users/register called via POST ====');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Request headers:', req.headers);
    
    const { pendingUserId } = req.body;

    // Log the incoming request body
    console.log('Register request body:', JSON.stringify(req.body, null, 2));

    // Retrieve user data from PendingUser
    let pendingUser;
    try {
        pendingUser = await PendingUser.findById(pendingUserId);
        if (!pendingUser) {
            console.error('Pending user not found in /register:', pendingUserId);
            return res.status(404).json({ message: 'User data not found' });
        }
        console.log('Retrieved pending user in /register:', JSON.stringify(pendingUser, null, 2));

        // Log waiver information from pending user
        console.log('Waiver information from pending user:', {
            waiverAccepted: pendingUser.waiver.accepted,
            waiverAcceptedDate: pendingUser.waiver.acceptedDate,
            waiverIpAddress: pendingUser.waiver.ipAddress,
            waiverUserAgent: pendingUser.waiver.userAgent
        });

    } catch (error) {
        console.error('Error retrieving pending user in /register:', error);
        return res.status(500).json({ message: 'Error retrieving user data', error: error.message });
    }

    const { username, password, email, firstName, lastName, phone } = pendingUser;

    // Check for missing fields
    if (!username || !password || !email || !firstName || !lastName) {
        console.error('Missing fields in register request:', { username, password, email, firstName, lastName });
        return res.status(400).json({ message: 'All fields are required' });
    }

    try {
        // Check for existing user
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            console.error('User already exists:', { username, email });
            return res.status(400).json({ message: 'Username or email already exists' });
        }

        // Set account type - founder for claytonskurski, member for everyone else
        const accountType = username.toLowerCase() === 'claytonskurski' ? 'founder' : 'member';

        // Create new user with waiver information
        const newUser = new User({
            username,
            password,
            email,
            firstName,
            lastName,
            phone,
            accountType, // Add the determined account type
            waiver: {
                accepted: pendingUser.waiver.accepted || false,
                acceptedDate: pendingUser.waiver.acceptedDate,
                version: '2025-04-17',
                ipAddress: pendingUser.waiver.ipAddress,
                userAgent: pendingUser.waiver.userAgent
            }
        });

        // Log the new user object before saving
        console.log('New user object before saving:', JSON.stringify(newUser, null, 2));

        // Save user to database
        await newUser.save();
        console.log('User saved to MongoDB:', JSON.stringify(newUser, null, 2));

        // Store user data in session
        req.session.user = {
            _id: newUser._id,
            username: newUser.username,
            firstName: newUser.firstName,
            lastName: newUser.lastName,
            email: newUser.email,
            phone: newUser.phone,
            accountType: newUser.accountType
        };

        // Explicitly save the session
        req.session.save((err) => {
            if (err) {
                console.error('Error saving session during registration:', err);
                return res.status(500).json({ message: 'Error saving session' });
            }
            console.log('Session saved successfully during registration:', req.session);
            console.log('Set-Cookie header in /register:', res.get('Set-Cookie') || 'No Set-Cookie header');
            // Redirect to sign-in page
            res.redirect('/signin');
        });
    } catch (error) {
        console.error('Error in /register:', error);
        if (error.code === 11000) {
            res.status(400).json({ message: 'Username or email already exists' });
        } else {
            res.status(500).json({ message: 'Error registering user', error: error.message });
        }
    }
});

// Login user
router.post('/login', async (req, res) => {
    console.log('Login route hit');
    console.log('Request headers:', req.headers);
    console.log('Content-Type:', req.get('Content-Type'));
    console.log('Raw request body:', req.body);

    if (!req.body) {
        console.error('Request body is undefined in /login');
        return res.status(400).json({ message: 'Request body is missing' });
    }

    let { username, password, redirectUrl } = req.body; // Added redirectUrl
    console.log('Login attempt:', { username, passwordProvided: !!password, redirectUrl });

    if (!username || !password) {
        console.error('Missing username or password in /login:', { username, password });
        return res.status(400).json({ message: 'Username and password are required' });
    }

    // Trim and lowercase the username to ensure consistency
    username = username.trim().toLowerCase();

    try {
        // Case-insensitive username search
        const user = await User.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
        if (!user) {
            console.log('User not found:', username);
            return res.status(400).json({ message: 'Invalid username or password' });
        }
        console.log('User found:', user.username);
        console.log('Stored hashed password:', user.password);

        const isMatch = await user.comparePassword(password);
        console.log('Password match:', isMatch);
        if (!isMatch) {
            console.log('Password mismatch for user:', username);
            return res.status(400).json({ message: 'Invalid username or password' });
        }



        req.session.user = {
            _id: user._id,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone,
            accountType: user.accountType
        };
        console.log('Session data before saving:', req.session);

        req.session.save((err) => {
            if (err) {
                console.error('Error saving session during login:', err);
                return res.status(500).json({ message: 'Error saving session' });
            }
            console.log('Session saved successfully:', req.session);
            console.log('Set-Cookie header in /login:', res.get('Set-Cookie') || 'No Set-Cookie header');
            res.json({
                message: 'User logged in successfully',
                user: {
                    username: user.username,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email
                },
                redirectUrl: redirectUrl || '/' // Include redirectUrl in response
            });
        });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ message: 'Error logging in', error: error.message });
    }
});

// Protected route
router.get('/protected', ensureAuthenticated, (req, res) => {
    res.json({ message: 'This is a protected route' });
});



// Account Page
router.get('/account', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.user._id);
        const now = new Date();

        // Count past events attended by the user (RSVPs with eventDate in the past)
        const trimmedUsername = user.username.trim();
        const pastEventsCount = await RSVP.countDocuments({
            username: { $regex: new RegExp(`^${trimmedUsername}$`, 'i') },
            eventDate: { $lt: now }
        });

        // Count events hosted by the user (Host records with status 'approved'), case-insensitive and trimmed
        const eventsHostedCount = await Host.countDocuments({
            username: { $regex: new RegExp(`^${trimmedUsername}$`, 'i') },
            status: 'approved'
        });

        res.render('account', {
            title: 'My Account',
            user: user,
            pastEventsCount,
            eventsHostedCount
        });
    } catch (error) {
        console.error('Error loading account page:', error);
        res.status(500).render('account', { 
            title: 'My Account', 
            user: req.session.user || null, 
            error: 'Failed to load account details' 
        });
    }
});

// Update Profile
router.post('/account/update-profile', ensureAuthenticated, async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/signin');
        }

        const userId = req.session.user._id;
        const { username, firstName, lastName, email, phone } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).render('error', { 
                title: 'Not Found', 
                message: 'User not found',
                user: null 
            });
        }

        // Check if the new username or email is already taken by another user
        const existingUser = await User.findOne({
            $or: [
                { username, _id: { $ne: userId } },
                { email, _id: { $ne: userId } }
            ]
        });
        if (existingUser) {
            return res.render('account', { 
                title: 'My Account', 
                user, 
                error: 'Username or email already in use' 
            });
        }

        // Update user fields
        user.username = username;
        user.firstName = firstName;
        user.lastName = lastName;
        user.email = email;
        user.phone = phone;

        await user.save();

        // Update session with new user data
        req.session.user = {
            _id: user._id,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone
        };

        req.session.save((err) => {
            if (err) {
                console.error('Error saving session during profile update:', err);
                return res.status(500).render('account', { 
                    title: 'My Account', 
                    user, 
                    error: 'Error saving session' 
                });
            }
            res.render('account', { 
                title: 'My Account', 
                user, 
                success: 'Profile updated successfully' 
            });
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).render('account', { 
            title: 'My Account', 
            user: req.session.user || null, 
            error: 'Failed to update profile' 
        });
    }
});

// Change Password
router.post('/account/change-password', ensureAuthenticated, async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/signin');
        }

        const userId = req.session.user._id;
        const { currentPassword, newPassword, confirmPassword } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).render('error', { 
                title: 'Not Found', 
                message: 'User not found',
                user: null 
            });
        }

        // Verify current password
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.render('account', { 
                title: 'My Account', 
                user, 
                error: 'Current password is incorrect' 
            });
        }

        // Check if new password matches confirm password
        if (newPassword !== confirmPassword) {
            return res.render('account', { 
                title: 'My Account', 
                user, 
                error: 'New password and confirm password do not match' 
            });
        }

        // Update password (this will trigger the pre('save') middleware to hash the new password)
        user.password = newPassword;
        await user.save();

        res.render('account', { 
            title: 'My Account', 
            user, 
            success: 'Password changed successfully' 
        });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).render('account', { 
            title: 'My Account', 
            user: req.session.user || null, 
            error: 'Failed to change password' 
        });
    }
});

// Delete Account
router.post('/account/delete', ensureAuthenticated, async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/signin');
        }

        const userId = req.session.user._id;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).render('error', { 
                title: 'Not Found', 
                message: 'User not found',
                user: null 
            });
        }

        // Store user info for email notification before deletion
        const userInfo = {
            username: user.username,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName
        };

        // Delete the user account
        await User.findByIdAndDelete(userId);

        // Send email notification for account deletion
        await sendAdminNotification(
            'Account Deletion Notification',
            `User Account Deleted:
            Username: ${userInfo.username}
            Email: ${userInfo.email}
            Name: ${userInfo.firstName} ${userInfo.lastName}
            
            Account has been successfully removed from the system.`
        );

        // Clear the session
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session:', err);
            }
            res.redirect('/');
        });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).render('error', { 
            title: 'Error', 
            message: 'Failed to delete account. Please try again or contact support.',
            user: req.session.user 
        });
    }
});

// Route for handling photo uploads
router.post('/upload-photo', ensureAuthenticated, upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Update user's profile photo in database
        const photoUrl = `/uploads/profile-photos/${req.file.filename}`;
        
        // If user had a previous photo, delete it
        const user = await User.findById(req.user._id);
        if (user.profilePhoto) {
            const oldPhotoPath = path.join(__dirname, '..', 'public_html', user.profilePhoto);
            if (fs.existsSync(oldPhotoPath)) {
                fs.unlinkSync(oldPhotoPath);
            }
        }

        await User.findByIdAndUpdate(req.user._id, { profilePhoto: photoUrl });

        res.json({ 
            success: true, 
            photoUrl: photoUrl,
            message: 'Photo uploaded successfully' 
        });
    } catch (error) {
        console.error('Error uploading photo:', error);
        res.status(500).json({ 
            error: 'Error uploading photo',
            details: error.message 
        });
    }
});





module.exports = router;