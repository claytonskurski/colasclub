const express = require('express');
const router = express.Router();
const User = require('../models/user');
const PendingUser = require('../models/pendingUser');
const bcrypt = require('bcryptjs');
const authMiddleware = require('../middleware/authMiddleware');
const stripe = require('stripe')(process.env.STRIPE_API_KEY);

console.log('STRIPE_API_KEY from userRoutes.js (initial):', process.env.STRIPE_API_KEY);

// Middleware to initialize Stripe dynamically
router.use((req, res, next) => {
    if (!req.stripe) {
        if (process.env.STRIPE_API_KEY) {
            req.stripe = require('stripe')(process.env.STRIPE_API_KEY);
            console.log('Stripe initialized successfully in middleware');
        } else {
            console.error('STRIPE_API_KEY is undefined, Stripe initialization failed');
            req.stripe = null;
        }
    }
    next();
});

// Handle sign-up form submission and redirect to payment
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

        // Log the password being saved to PendingUser
        console.log('Password in /submit-sign-up:', password);

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
            phone
        });
        await pendingUser.save();
        console.log('Pending user saved to MongoDB:', pendingUser);
        console.log('Pending user ID for redirect:', pendingUser._id.toString());

        // Redirect to payment with pendingUserId
        res.redirect(`/payment?pendingUserId=${pendingUser._id}`);
    } catch (error) {
        console.error('Error in /submit-sign-up:', error);
        res.status(500).json({ message: 'Error processing signup', error: error.message });
    }
});

// Register user (called programmatically after payment)
router.post('/register', async (req, res) => {
    if (!req.stripe) {
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
        console.log('Retrieved pending user in /register:', pendingUser);
    } catch (error) {
        console.error('Error retrieving pending user in /register:', error);
        return res.status(500).json({ message: 'Error retrieving user data', error: error.message });
    }

    const { username, password, email, firstName, lastName, phone, membership } = pendingUser;

    // Log the password retrieved from PendingUser
    console.log('Password retrieved from PendingUser in /register:', password);

    // Check for missing fields
    if (!username || !password || !email || !firstName || !lastName || !phone || !stripeCustomerId || !subscriptionStatus || paidForCurrentMonth === undefined) {
        console.error('Missing fields in register request:', { username, password, email, firstName, lastName, phone, stripeCustomerId, subscriptionStatus, paidForCurrentMonth });
        return res.status(400).json({ message: 'All fields are required' });
    }

    // Additional validation for password
    if (password.length < 6) {
        console.error('Password too short in /register:', password);
        return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    try {
        // Check for existing user
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.status(400).json({ message: 'Username or email already exists' });
        }

        // Create new user (password will be hashed by the pre('save') middleware)
        const newUser = new User({
            username,
            password, // Do NOT hash here; let the pre('save') middleware handle it
            email,
            firstName,
            lastName,
            phone,
            stripeCustomerId,
            subscriptionStatus,
            paidForCurrentMonth,
            membership
        });

        // Save user to database
        await newUser.save();
        console.log('User saved to MongoDB:', newUser);

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
            membership: newUser.membership // Include membership for authMiddleware
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
        const user = await User.findOne({ username });
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
router.get('/protected', authMiddleware, (req, res) => {
    res.json({ message: 'This is a protected route' });
});

module.exports = router;