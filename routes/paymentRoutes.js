require('dotenv').config();
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_API_KEY);
const fetch = require('node-fetch');
const User = require('../models/user');
const PendingUser = require('../models/pendingUser');

// Ensure Stripe is properly configured
if (!process.env.STRIPE_API_KEY) {
    console.error('STRIPE_API_KEY is not configured');
    process.exit(1);
}

// Stripe webhook secret is loaded from process.env.STRIPE_WEBHOOK_SECRET

// Create Stripe Checkout session
router.post('/create-checkout-session', async (req, res) => {
    const { pendingUserId } = req.body;

    if (!pendingUserId) {
        console.error('Missing pendingUserId in /create-checkout-session');
        return res.status(400).json({ message: 'Pending user ID is required' });
    }

    // Retrieve the PendingUser document to get the membership
    let pendingUser;
    try {
        pendingUser = await PendingUser.findById(pendingUserId);
        if (!pendingUser) {
            console.error('Pending user not found in /create-checkout-session:', pendingUserId);
            return res.status(404).json({ message: 'Pending user not found' });
        }
        console.log('Pending user retrieved in /create-checkout-session:', pendingUser);
    } catch (error) {
        console.error('Error retrieving pending user in /create-checkout-session:', error);
        return res.status(500).json({ message: 'Error retrieving user data' });
    }

    const membership = pendingUser.membership;
    if (!membership) {
        console.error('Membership type missing for pendingUserId:', pendingUserId);
        return res.status(400).json({ message: 'Membership type is required' });
    }

    let priceId;
    let sessionConfig = {
        payment_method_types: ['card'],
        line_items: [
            {
                price: '',
                quantity: 1,
            },
        ],
        mode: '',
        client_reference_id: pendingUserId,
        success_url: 'https://sodacityoutdoors.com/api/payments/payment-success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://sodacityoutdoors.com/api/payments/payment-cancel',
    };

    if (membership === 'monthly') {
        // Respond with the payment link for monthly subscription with trial
        return res.json({ paymentLink: 'https://buy.stripe.com/aEU4iL5xibUf6U8145' });
    } else if (membership === 'annual') {
        priceId = 'price_1REyTsKH1jTdrtwd55iBuX7y';
        sessionConfig.line_items[0].price = priceId;
        sessionConfig.mode = 'subscription';
        sessionConfig.allow_promotion_codes = true;
    } else {
        console.error('Invalid membership option:', membership);
        return res.status(400).json({ message: 'Invalid membership option' });
    }

    try {
        const session = await stripe.checkout.sessions.create(sessionConfig);

        console.log('Stripe session created:', session.url);
        console.log('Session config:', sessionConfig);
        console.log('Created session details:', session);
        res.json({ sessionId: session.id });
    } catch (error) {
        console.error('Error creating Stripe session:', error.message);
        res.status(500).json({ message: 'Error creating checkout session', error: error.message });
    }
});

// Payment success route
router.get('/payment-success', async (req, res) => {
    console.log('==== /payment-success route called ====');
    const sessionId = req.query.session_id;
    console.log('Query session_id in /payment-success:', sessionId);

    if (!sessionId) {
        console.error('No session ID provided in /payment-success');
        return res.render('payment_success', { 
            paymentIntentId: null, 
            userData: {}, 
            error: 'No session ID provided. Please try signing up again.', 
            user: req.session.user 
        });
    }

    try {
        console.log('Retrieving Stripe session for sessionId:', sessionId);
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['payment_intent', 'subscription']
        });
        console.log('Retrieved Stripe session:', JSON.stringify(session, null, 2));

        if (!session || !session.client_reference_id) {
            console.error('Invalid session or missing client reference ID');
            return res.render('payment_success', {
                paymentIntentId: null,
                userData: {},
                error: 'Invalid payment session. Please try signing up again.',
                user: req.session.user
            });
        }

        const pendingUserId = session.client_reference_id;
        console.log('Pending User ID from session.client_reference_id:', pendingUserId);

        let pendingUser;
        try {
            console.log('Attempting to retrieve PendingUser with ID:', pendingUserId);
            
            // Validate that pendingUserId is a valid ObjectId
            if (pendingUserId && pendingUserId !== 'null' && pendingUserId !== 'undefined' && pendingUserId.match(/^[0-9a-fA-F]{24}$/)) {
                pendingUser = await PendingUser.findById(pendingUserId);
            } else {
                console.log('Invalid ObjectId format for pendingUserId:', pendingUserId);
                // Try to find by email as fallback
                if (session.customer_email) {
                    pendingUser = await PendingUser.findOne({ email: session.customer_email });
                    console.log('Found pending user by email:', pendingUser ? 'Yes' : 'No');
                }
            }
            
            console.log('Retrieved pending user:', pendingUser);
        } catch (error) {
            console.error('Error retrieving pending user in /payment-success:', error);
            return res.render('payment_success', {
                paymentIntentId: null,
                userData: {},
                error: 'Error retrieving user data. Please contact support.',
                user: req.session.user
            });
        }

        if (!pendingUser) {
            console.error('Pending user not found:', pendingUserId);
            return res.render('payment_success', {
                paymentIntentId: null,
                userData: {},
                error: 'User data not found. Please sign up again.',
                user: req.session.user
            });
        }

        // Initialize subscription details
        let accountStatus = 'inactive';
        let paidForCurrentMonth = false;
        let subscriptionStart = new Date();
        let subscriptionEnd = null;
        let trialEnd = null;
        console.log('Session mode:', session.mode);
        if (session.mode === 'subscription') {
            if (session.subscription) {
                console.log('Retrieving Stripe subscription for ID:', session.subscription.id);
                const subscription = await stripe.subscriptions.retrieve(session.subscription.id);
                console.log('Retrieved subscription:', JSON.stringify(subscription, null, 2));

                if (subscription.status === 'active' || subscription.status === 'trialing') {
                    accountStatus = subscription.status === 'trialing' ? 'trial' : 'active';
                    paidForCurrentMonth = true;
                    subscriptionStart = new Date(subscription.current_period_start * 1000);
                    if (pendingUser.membership === 'annual') {
                        subscriptionEnd = new Date(subscriptionStart);
                        subscriptionEnd.setFullYear(subscriptionEnd.getFullYear() + 1);
                    } else {
                        subscriptionEnd = new Date(subscription.current_period_end * 1000);
                    }
                    if (subscription.trial_end) {
                        trialEnd = new Date(subscription.trial_end * 1000);
                    }
                } else {
                    console.log('Subscription is not active or trialing:', subscription.status);
                }
            } else {
                console.error('No subscription found in session');
                return res.render('payment_success', {
                    paymentIntentId: null,
                    userData: {},
                    error: 'Subscription not found. Please contact support.',
                    user: req.session.user
                });
            }
        }

        // Use the actual customer ID from the payment session, not the one from signup
        const stripeCustomerId = session.customer || pendingUser.stripeCustomerId;
        const { username, email, firstName, lastName, membership } = pendingUser;
        console.log('Retrieved stripeCustomerId:', stripeCustomerId);
        console.log('Preparing to POST to /api/users/register on localhost:3001');
        console.log('POST body:', {
            stripeCustomerId,
            accountStatus,
            paidForCurrentMonth,
            subscriptionStart,
            subscriptionEnd,
            trialEnd,
            membership,
            pendingUserId
        });
        try {
            const response = await fetch('http://localhost:3001/api/users/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    stripeCustomerId,
                    accountStatus,
                    paidForCurrentMonth,
                    subscriptionStart,
                    subscriptionEnd,
                    trialEnd,
                    membership,
                    pendingUserId
                }),
            });
            console.log('Fetch call made, response status:', response.status);
            const responseText = await response.text();
            console.log('Response text from /api/users/register:', responseText);
            if (!response.ok && response.status !== 302) {
                console.error('Error registering user after payment:', responseText);
                return res.render('payment_success', {
                    paymentIntentId: null,
                    userData: { username, email, firstName, lastName },
                    error: 'Error completing registration. Please contact support.',
                    user: req.session.user
                });
            }
        } catch (fetchError) {
            console.error('Fetch to /api/users/register failed:', fetchError);
            return res.render('payment_success', {
                paymentIntentId: null,
                userData: { username, email, firstName, lastName },
                error: 'Internal error during registration. Please contact support.',
                user: req.session.user
            });
        }

        try {
            console.log('Attempting to delete PendingUser with ID:', pendingUserId);
            await PendingUser.findByIdAndDelete(pendingUserId);
            console.log('Deleted pending user after successful registration:', pendingUserId);
        } catch (deleteError) {
            console.error('Error deleting pending user:', deleteError);
        }

        // Redirect to sign-in page
        console.log('Redirecting to /signin after payment success.');
        res.redirect('/signin');
    } catch (error) {
        console.error('Error in /payment-success:', error);
        res.render('payment_success', {
            paymentIntentId: null,
            userData: {},
            error: 'An unexpected error occurred. Please contact support.',
            user: req.session.user
        });
    }
});

// Payment cancel route
router.get('/payment-cancel', async (req, res) => {
    const sessionId = req.query.session_id;
    if (sessionId) {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const pendingUserId = session.client_reference_id;
        if (pendingUserId) {
            await PendingUser.findByIdAndDelete(pendingUserId);
            console.log('Deleted pending user on cancel:', pendingUserId);
        }
    }
    res.render('payment_failure', { user: req.session.user });
});

// Update subscription status
router.post('/update-status', async (req, res) => {
    const { email, accountStatus, paidForCurrentMonth } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            console.error('User not found for email:', email);
            return res.status(404).json({ message: 'User not found' });
        }
        user.accountStatus = accountStatus;
        user.paidForCurrentMonth = paidForCurrentMonth;
        await user.save();
        console.log('Subscription status updated for user:', email);
        res.json({ message: 'Subscription status updated', accountStatus, paidForCurrentMonth });
    } catch (error) {
        console.error('Error updating subscription status:', error);
        res.status(500).json({ message: 'Error updating subscription status', error: error.message });
    }
});

// Stripe webhook endpoint
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const customerEmail = session.customer_email || (session.customer_details && session.customer_details.email);
        console.log('Webhook received for checkout.session.completed, email:', customerEmail);
        if (!customerEmail) {
            console.error('No customer email found in session');
            return res.status(400).send('No customer email');
        }
        try {
            const pendingUser = await PendingUser.findOne({ email: customerEmail });
            if (!pendingUser) {
                console.error('No PendingUser found for email:', customerEmail);
                return res.status(404).send('PendingUser not found');
            }
            // Promote to User - use the actual customer ID from the payment session
            const user = new User({
                username: pendingUser.username,
                password: pendingUser.password,
                email: pendingUser.email,
                firstName: pendingUser.firstName,
                lastName: pendingUser.lastName,
                phone: pendingUser.phone,
                stripeCustomerId: session.customer || pendingUser.stripeCustomerId,
                accountStatus: 'active',
                paidForCurrentMonth: true,
                waiverAccepted: pendingUser.waiverAccepted,
                waiverAcceptedDate: pendingUser.waiverAcceptedDate,
                waiverIpAddress: pendingUser.waiverIpAddress,
                waiverUserAgent: pendingUser.waiverUserAgent
            });
            await user.save();
            await PendingUser.findByIdAndDelete(pendingUser._id);
            console.log('User promoted and PendingUser deleted for email:', customerEmail);
            res.status(200).send('User registration completed');
        } catch (err) {
            console.error('Error in webhook user promotion:', err);
            res.status(500).send('Internal server error');
        }
    } else {
        res.status(200).send('Event ignored');
    }
});

module.exports = router;