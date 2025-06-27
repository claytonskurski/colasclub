const express = require('express');
const router = express.Router();
const User = require('../models/user');
const PendingUser = require('../models/pendingUser');
const bcrypt = require('bcryptjs');
const { ensureAuthenticated, ensureAdmin } = require('../middleware/authMiddleware');
const stripe = require('stripe')(process.env.STRIPE_API_KEY);
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

// Middleware to initialize Stripe dynamically
router.use((req, res, next) => {
    if (!req.stripe) {
        if (!process.env.STRIPE_API_KEY) {
            console.error('STRIPE_API_KEY is undefined, Stripe initialization failed');
            return res.status(500).json({ message: 'Stripe configuration error' });
        }
        req.stripe = require('stripe')(process.env.STRIPE_API_KEY);
    }
    next();
});

// Registration page route
router.get('/register', (req, res) => {
    res.render('register', { title: 'Create Account', user: req.session.user });
});

// Handle sign-up form submission and redirect to waiver
router.post('/submit-sign-up', async (req, res) => {
    const { username, password, firstName, lastName, email, phone, membership } = req.body;

    try {
        // Validate all required fields
        if (!username || !password || !email || !firstName || !lastName || !phone || !membership) {
            console.error('Missing fields in /submit-sign-up:', { username, password, email, firstName, lastName, phone, membership });
            return res.status(400).json({ message: 'All fields are required' });
        }

        // Additional validation for password
        if (password.length < 6) {
            console.error('Password too short in /submit-sign-up:', password);
            return res.status(400).json({ message: 'Password must be at least 6 characters long' });
        }

        // Check for existing user
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.status(400).json({ message: 'Username or email already exists' });
        }

        if (!req.stripe) {
            return res.status(500).json({ message: 'Stripe initialization failed' });
        }

        // Create a Stripe customer
        const customer = await req.stripe.customers.create({
            email: email,
            name: `${firstName} ${lastName}`,
            phone: phone,
        });
        console.log('Stripe customer created:', customer.id);

        // Save all user data to PendingUser collection
        const pendingUser = new PendingUser({
            stripeCustomerId: customer.id,
            membership,
            username,
            password,
            email,
            firstName,
            lastName,
            phone,
            waiverAccepted: false
        });

        await pendingUser.save();
        console.log('Pending user saved to MongoDB:', pendingUser);

        // Restore backup behavior: do NOT set anything in the session, just redirect
        res.redirect(`/waiver?pendingUserId=${pendingUser._id}`);
    } catch (error) {
        console.error('Error in /submit-sign-up:', error);
        res.status(500).json({ message: 'Error processing signup', error: error.message });
    }
});

// Register user (called programmatically after payment)
router.post('/register', async (req, res) => {
    console.log('==== /api/users/register called ====');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    if (!req.stripe) {
        console.error('Stripe initialization failed');
        return res.status(500).json({ message: 'Stripe initialization failed' });
    }

    const { stripeCustomerId, subscriptionStatus, paidForCurrentMonth, pendingUserId } = req.body;

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
            waiverAccepted: pendingUser.waiverAccepted,
            waiverAcceptedDate: pendingUser.waiverAcceptedDate,
            waiverIpAddress: pendingUser.waiverIpAddress,
            waiverUserAgent: pendingUser.waiverUserAgent
        });

    } catch (error) {
        console.error('Error retrieving pending user in /register:', error);
        return res.status(500).json({ message: 'Error retrieving user data', error: error.message });
    }

    const { username, password, email, firstName, lastName, phone, membership } = pendingUser;

    // Check for missing fields
    if (!username || !password || !email || !firstName || !lastName || !phone || !stripeCustomerId || !subscriptionStatus || paidForCurrentMonth === undefined) {
        console.error('Missing fields in register request:', { username, password, email, firstName, lastName, phone, stripeCustomerId, subscriptionStatus, paidForCurrentMonth });
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
            stripeCustomerId,
            subscriptionStatus,
            paidForCurrentMonth,
            membership,
            accountType, // Add the determined account type
            waiver: {
                accepted: pendingUser.waiverAccepted || false,
                acceptedDate: pendingUser.waiverAcceptedDate,
                version: '2025-04-17',
                ipAddress: pendingUser.waiverIpAddress,
                userAgent: pendingUser.waiverUserAgent
            }
        });

        // Log the new user object before saving
        console.log('New user object before saving:', JSON.stringify(newUser, null, 2));

        // Save user to database
        await newUser.save();
        console.log('User saved to MongoDB:', JSON.stringify(newUser, null, 2));

        // Send email notification for new account
        try {
            await sendNewUserNotification(newUser);
            console.log('New user notification sent');
        } catch (notifyErr) {
            console.error('Error sending new user notification:', notifyErr);
        }

        // Send welcome email to the new user
        try {
            const { sendWelcomeNewUserEmail } = require('../services/newUserEmails');
            await sendWelcomeNewUserEmail(newUser);
            console.log('Welcome email sent to new user');
        } catch (welcomeErr) {
            console.error('Error sending welcome email:', welcomeErr);
        }

        // Store user data in session
        req.session.user = {
            _id: newUser._id,
            username: newUser.username,
            firstName: newUser.firstName,
            lastName: newUser.lastName,
            email: newUser.email,
            phone: newUser.phone,
            subscriptionStatus: newUser.subscriptionStatus,
            paidForCurrentMonth: newUser.paidForCurrentMonth,
            membership: newUser.membership
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

        if (user.membership === 'monthly' && !user.paidForCurrentMonth) {
            console.log('Payment required for user:', username);
            return res.status(403).json({ message: 'Payment required for the current month' });
        }

        req.session.user = {
            _id: user._id,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone,
            subscriptionStatus: user.subscriptionStatus,
            paidForCurrentMonth: user.paidForCurrentMonth,
            membership: user.membership // Include membership for authMiddleware
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
                    email: user.email,
                    subscriptionStatus: user.subscriptionStatus,
                    paidForCurrentMonth: user.paidForCurrentMonth
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

// Delete account route
router.post('/account/delete', ensureAuthenticated, async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/signin');
        }

        const userId = req.session.user._id;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Store user info for email notification before deletion
        const userInfo = {
            username: user.username,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            membership: user.membership
        };

        // Cancel Stripe subscription if it exists
        if (user.stripeCustomerId) {
            try {
                const subscriptions = await stripe.subscriptions.list({
                    customer: user.stripeCustomerId
                });

                // Cancel all active subscriptions
                for (const subscription of subscriptions.data) {
                    if (subscription.status === 'active' || subscription.status === 'trialing') {
                        await stripe.subscriptions.del(subscription.id);
                    }
                }

                // Delete the customer in Stripe
                await stripe.customers.del(user.stripeCustomerId);
            } catch (stripeError) {
                console.error('Error cleaning up Stripe data:', stripeError);
            }
        }

        // Delete the user account
        await User.findByIdAndDelete(userId);

        // Send email notification for account deletion
        await sendNewUserNotification(user, 'User Account Deleted');

        // Clear the session
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session:', err);
            }
            res.redirect('/');
        });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ message: 'Error deleting account', error: error.message });
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

router.get('/account', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
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

        // Debug logs
        const hostedDocs = await Host.find({
            username: { $regex: new RegExp(`^${trimmedUsername}$`, 'i') },
            status: 'approved'
        });
        const attendedDocs = await RSVP.find({
            username: { $regex: new RegExp(`^${trimmedUsername}$`, 'i') },
            eventDate: { $lt: now }
        });
        console.log('RSVP count query:', { username: trimmedUsername });
        console.log('RSVP count result:', pastEventsCount);
        console.log('Attended docs:', attendedDocs);
        console.log('Host count query:', { username: trimmedUsername, status: 'approved' });
        console.log('Host count result:', eventsHostedCount);
        console.log('Hosted docs:', hostedDocs);

        res.render('account', {
            user: user,
            pastEventsCount,
            eventsHostedCount,
            error: req.flash('error'),
            success: req.flash('success')
        });
    } catch (error) {
        console.error('Error loading account page:', error);
        req.flash('error', 'Error loading account information');
        res.redirect('/');
    }
});

module.exports = router;