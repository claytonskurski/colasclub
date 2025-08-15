const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
console.log('Environment loaded successfully');

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const userRoutes = require('./routes/userRoutes');
const eventRoutes = require('./routes/eventRoutes');
const submitEvent = require('./routes/submitEvent');
const contactRoutes = require('./routes/contactRoutes');
const { ensureAuthenticated } = require('./middleware/authMiddleware');
const cron = require('node-cron');
const User = require('./models/user');
const bcrypt = require('bcryptjs');
const expressLayouts = require('express-ejs-layouts');
const fs = require('fs');
const moment = require('moment-timezone');
const PendingUser = require('./models/pendingUser');
const adminRoutes = require('./routes/adminRoutes');
const { sendAdminNotification } = require('./services/adminNotifications');

const app = express();

// Set moment as a global variable for all templates
app.locals.moment = moment;

// Ensure Express recognizes HTTPS behind a proxy
app.set('trust proxy', 1);

// CORS headers middleware
app.use((req, res, next) => {
    const allowedOrigins = ['https://colasclub.fun', 'http://localhost:3002'];
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
    }
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});

// Add body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Validate environment variables
if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not defined in the environment variables');
    process.exit(1);
}

if (!process.env.SESSION_SECRET) {
    console.warn('SESSION_SECRET not defined, using fallback secret');
}



// Session configuration with connect-mongo
let sessionStore;
try {
    sessionStore = MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        collectionName: 'sessions'
    });
    console.log('MongoStore initialized successfully');
} catch (error) {
    console.error('Error initializing MongoStore:', error);
    process.exit(1);
}

app.use(session({
    secret: process.env.SESSION_SECRET || '9ae0cb8c445e7320568f23ae9a4ce36b5f470a14a3801d0d7ade841ae9b49695',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, // 1 day
        secure: false,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// Middleware to debug session data and cookies
app.use((req, res, next) => {
    console.log('Request URL:', req.url);
    console.log('Protocol:', req.protocol);
    console.log('X-Forwarded-Proto:', req.get('X-Forwarded-Proto'));
    console.log('Secure:', req.secure);
    console.log('Session ID:', req.sessionID);
    console.log('Session data:', req.session);
    console.log('Cookies:', req.headers.cookie || 'No cookies');
    console.log('Session cookie:', req.session.cookie);
    console.log('Session store:', sessionStore ? 'Initialized' : 'Not initialized');
    res.locals.user = req.session.user || null;
    console.log('Middleware - req.session.user:', req.session.user);
    console.log('Middleware - req.session.userData:', req.session.userData);

    const originalJson = res.json;
    res.json = function (body) {
        console.log('Set-Cookie header:', res.get('Set-Cookie') || 'No Set-Cookie header');
        return originalJson.call(this, body);
    };

    next();
});

// Set up EJS as the view engine with layouts
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Debugging static file requests
app.use((req, res, next) => {
    if (req.url.startsWith('/static/')) {
        console.log(`Serving static file: ${req.url}`);
    }
    next();
});

// Serve static files from 'public_html'
app.use('/static', express.static(path.join(__dirname, 'public_html')));

// Copy moment.min.js from node_modules to public_html/js with error handling
const momentPath = path.join(__dirname, 'node_modules', 'moment', 'min', 'moment.min.js');
const publicHtmlJsPath = path.join(__dirname, 'public_html', 'js');
if (!fs.existsSync(publicHtmlJsPath)) {
    fs.mkdirSync(publicHtmlJsPath);
}
const destMomentPath = path.join(publicHtmlJsPath, 'moment.min.js');
if (!fs.existsSync(destMomentPath)) {
    try {
        if (fs.existsSync(momentPath)) {
            fs.copyFileSync(momentPath, destMomentPath);
            console.log('Copied moment.min.js to /public_html/js/');
        } else {
            console.warn('moment.min.js not found in node_modules/moment/min/. Please run "npm install moment@2.29.4" and restart the server.');
        }
    } catch (error) {
        console.error('Error copying moment.min.js:', error.message);
    }
}

// Connect to MongoDB
mongoose.set('strictQuery', true);
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('Connected to MongoDB successfully');
    })
    .catch((err) => {
        console.error('MongoDB connection error:', err);
    });

// Routes
app.use((req, res, next) => {
    console.log('Incoming request:', {
        method: req.method,
        url: req.url,
        path: req.path,
        query: req.query,
        body: req.body
    });
    next();
});

app.get('/', async (req, res) => {
    res.render('index', { 
        title: 'Cola\'s Club',
        user: req.session.user
    });
});

app.use('/api/users', userRoutes);
app.use('/events', eventRoutes);
app.use('/submit_event', submitEvent);
app.use('/contact', contactRoutes);

app.use('/api/admin', adminRoutes);

// Redirect /calendar to /events/calendar
app.get('/calendar', (req, res) => {
    res.redirect('/events/calendar');
});

// Test route for debugging
app.get('/test-events', async (req, res) => {
    const Event = require('./models/events');
    try {
        const events = await Event.find();
        res.json(events);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// Protected route
app.use('/api/protected-route', ensureAuthenticated, (req, res) => {
    res.send('This is a protected route.');
});

// Serve EJS pages
app.get('/signin', (req, res) => {
    const redirectUrl = req.query.redirect || '/';
    const message = req.query.message;
    res.render('signin', { title: 'Sign In', user: req.session.user, redirectUrl, message });
});

app.get('/signup', (req, res) => {
    res.render('signup', { title: 'Sign Up', user: req.session.user });
});

app.get('/register', (req, res) => {
    res.render('register', { title: 'Create Account', user: req.session.user });
});

app.get('/waiver', async (req, res) => {
    const pendingUserId = req.query.pendingUserId;
    if (!pendingUserId) {
        console.error('No pendingUserId found in query');
        return res.redirect('/register');
    }

    try {
        // Get pending user data
        const pendingUser = await PendingUser.findById(pendingUserId);
        if (!pendingUser) {
            console.error('Pending user not found:', pendingUserId);
            return res.redirect('/register');
        }

        // Store pending user data in session
        req.session.pendingUser = {
            _id: pendingUser._id,
            username: pendingUser.username,
            email: pendingUser.email,
            firstName: pendingUser.firstName,
            lastName: pendingUser.lastName
        };

        // Save session before rendering
        req.session.save((err) => {
            if (err) {
                console.error('Error saving session during waiver page load:', err);
                return res.redirect('/register');
            }
            console.log('Session saved successfully during waiver page load:', req.session);
            res.render('waiver', { 
                title: 'Liability Waiver', 
                user: req.session.user,
                pendingUserId: pendingUserId,
                pendingUser: req.session.pendingUser
            });
        });
    } catch (error) {
        console.error('Error loading waiver page:', error);
        res.redirect('/register');
    }
});

// Handle initial form submission from signup page
app.post('/waiver', async (req, res) => {
    try {
        console.log('POST /waiver - Request body:', req.body);
        
        // Check database connection
        if (mongoose.connection.readyState !== 1) {
            console.error('Database not connected. Ready state:', mongoose.connection.readyState);
            return res.status(500).render('error', { 
                title: 'Database Error', 
                message: 'Database connection is not available. Please try again later.',
                user: null 
            });
        }
        
        const { username, password, email, firstName, lastName, phone } = req.body;
        
        // Validate required fields
        if (!username || !password || !email || !firstName || !lastName) {
            console.error('Missing required fields in waiver form submission:', { username, password, email, firstName, lastName, phone });
            return res.status(400).render('error', { 
                title: 'Missing Information', 
                message: 'Please fill in all required fields.',
                user: null 
            });
        }

        // Check for existing user
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            console.error('User already exists:', { username, email });
            return res.status(400).render('error', { 
                title: 'User Already Exists', 
                message: 'A user with this username or email already exists.',
                user: null 
            });
        }

        console.log('Creating pending user with data:', { username, email, firstName, lastName, phone });
        
        // Create pending user
        const pendingUser = new PendingUser({
            username,
            password,
            email,
            firstName,
            lastName,
            phone,
            waiver: {
                accepted: false
            }
        });

        console.log('PendingUser instance created, attempting to save...');
        await pendingUser.save();
        console.log('Pending user created successfully:', pendingUser._id);

        // Redirect to waiver page with the pending user ID
        res.redirect(`/waiver?pendingUserId=${pendingUser._id}`);
    } catch (error) {
        console.error('Error processing waiver form submission:', error);
        console.error('Error stack:', error.stack);
        res.status(500).render('error', { 
            title: 'Error', 
            message: 'An error occurred while processing your request. Please try again.',
            user: null,
            error: process.env.NODE_ENV === 'development' ? error : null
        });
    }
});

app.post('/waiver/accept', async (req, res) => {
    try {
        const { pendingUserId, waiverAccepted } = req.body;
        console.log('Waiver acceptance request:', {
            pendingUserId,
            waiverAccepted,
            body: req.body
        });

        if (!pendingUserId) {
            return res.status(400).json({ message: 'Pending user ID is required' });
        }

        // Get the current pending user first
        const currentUser = await PendingUser.findById(pendingUserId);
        console.log('Current pending user before update:', currentUser);

        if (!currentUser) {
            console.error('Pending user not found');
            return res.status(404).json({ message: 'Pending user not found' });
        }

        // Update the pending user to indicate waiver acceptance
        const updateData = {
            'waiver.accepted': true,
            'waiver.acceptedDate': new Date(),
            'waiver.ipAddress': req.ip,
            'waiver.userAgent': req.headers['user-agent']
        };

        console.log('Updating pending user with:', updateData);

        const pendingUser = await PendingUser.findByIdAndUpdate(
            pendingUserId,
            updateData,
            { new: true }
        );

        if (!pendingUser) {
            console.error('Pending user not found after update attempt');
            return res.status(404).json({ message: 'Pending user not found' });
        }

        console.log('Updated pending user:', pendingUser);

        // Create the user account directly here
        const accountType = pendingUser.username.toLowerCase() === 'claytonskurski' ? 'founder' : 'member';
        
        const newUser = new User({
            username: pendingUser.username,
            password: pendingUser.password, // This will be hashed by User model's pre-save middleware
            email: pendingUser.email,
            firstName: pendingUser.firstName,
            lastName: pendingUser.lastName,
            phone: pendingUser.phone,
            accountType,
            waiver: {
                accepted: pendingUser.waiver.accepted,
                acceptedDate: pendingUser.waiver.acceptedDate,
                version: '2025-04-17',
                ipAddress: pendingUser.waiver.ipAddress,
                userAgent: pendingUser.waiver.userAgent
            }
        });

        await newUser.save();
        console.log('User account created successfully:', newUser._id);

        // Delete the pending user
        await PendingUser.findByIdAndDelete(pendingUserId);

        // Redirect to signin page with success message
        res.redirect('/signin?message=Account created successfully! Please sign in.');
    } catch (error) {
        console.error('Error accepting waiver:', error);
        res.status(500).json({ message: 'Error processing waiver acceptance' });
    }
});



app.get('/about', (req, res) => {
    res.render('about', { title: 'About Us', user: req.session.user });
});

// Contact form submission
app.post('/contact/submit', async (req, res) => {
    try {
        const { name, email, subject, message } = req.body;
        // TODO: Add email sending functionality
        // For now, just return success
        res.json({ success: true });
    } catch (error) {
        console.error('Error processing contact form:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Account Page
app.get('/account', ensureAuthenticated, async (req, res) => {
    console.log('Reached /account route');
    console.log('req.session.user in /account:', req.session.user);
    try {
        if (!req.session.user) {
            console.log('No user in session, redirecting to signin');
            return res.redirect('/signin');
        }

        const userId = req.session.user._id;
        console.log('Fetching user with ID:', userId);
        const user = await User.findById(userId);
        if (!user) {
            console.log('User not found in database:', userId);
            return res.status(404).render('404', { title: 'Not Found', message: 'User not found', user: null });
        }
        console.log('Rendering account page for user:', user.username);
        res.render('account', { title: 'My Account', user });
    } catch (error) {
        console.error('Error loading account page:', error);
        res.status(500).render('account', { title: 'My Account', user: req.session.user || null, error: 'Failed to load account details' });
    }
});

// Update Profile
app.post('/account/update-profile', ensureAuthenticated, async (req, res) => {
    try {
        if (!req.session.user) {
            console.log('No user in session, redirecting to signin');
            return res.redirect('/signin');
        }

        const userId = req.session.user._id;
        const { username, firstName, lastName, email, phone } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            console.log('User not found in database:', userId);
            return res.status(404).render('404', { title: 'Not Found', message: 'User not found', user: null });
        }

        // Check if the new username or email is already taken by another user
        const existingUser = await User.findOne({
            $or: [
                { username, _id: { $ne: userId } },
                { email, _id: { $ne: userId } }
            ]
        });
        if (existingUser) {
            return res.render('account', { title: 'My Account', user, error: 'Username or email already in use' });
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
                return res.status(500).render('account', { title: 'My Account', user, error: 'Error saving session' });
            }
            console.log('Profile updated and session saved for user:', user.username);
            res.render('account', { title: 'My Account', user, success: 'Profile updated successfully' });
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).render('account', { title: 'My Account', user: req.session.user || null, error: 'Failed to update profile' });
    }
});

// Change Password
app.post('/account/change-password', ensureAuthenticated, async (req, res) => {
    try {
        if (!req.session.user) {
            console.log('No user in session, redirecting to signin');
            return res.redirect('/signin');
        }

        const userId = req.session.user._id;
        const { currentPassword, newPassword, confirmPassword } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            console.log('User not found in database:', userId);
            return res.status(404).render('404', { title: 'Not Found', message: 'User not found', user: null });
        }

        // Verify current password
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.render('account', { title: 'My Account', user, error: 'Current password is incorrect' });
        }

        // Check if new password matches confirm password
        if (newPassword !== confirmPassword) {
            return res.render('account', { title: 'My Account', user, error: 'New password and confirm password do not match' });
        }

        // Update password (this will trigger the pre('save') middleware to hash the new password)
        user.password = newPassword;
        await user.save();

        res.render('account', { title: 'My Account', user, success: 'Password changed successfully' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).render('account', { title: 'My Account', user: req.session.user || null, error: 'Failed to change password' });
    }
});

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session during logout:', err);
            return res.status(500).json({ message: 'Error logging out' });
        }
        console.log('Session destroyed, user logged out');
        res.redirect('/');
    });
});



// === AdminJS (AdminBro) Setup ===
// Note: AdminJS has been removed as it was related to rental management

// Mount account deletion route
app.post('/account/delete', ensureAuthenticated, async (req, res) => {
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





// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).render('error', {
        title: 'Error',
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('error', {
        title: '404 Not Found',
        message: 'The page you are looking for does not exist.'
    });
});

// Start the server
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;