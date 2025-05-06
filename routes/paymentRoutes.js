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
        success_url: 'https://sodacityoutdoors.com/payment-success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://sodacityoutdoors.com/payment-cancel',
    };

    if (membership === 'monthly') {
        priceId = 'price_1QvKLzKH1jTdrtwdtqvA70aH';
        sessionConfig.line_items[0].price = priceId;
        sessionConfig.mode = 'subscription';
        sessionConfig.allow_promotion_codes = true;
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
        // Retrieve the Stripe session with expanded fields
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['payment_intent', 'subscription']
        });
        console.log('Retrieved Stripe session:', JSON.stringify(session, null, 2));

        // Validate session
        if (!session || !session.client_reference_id) {
            console.error('Invalid session or missing client reference ID');
            return res.render('payment_success', {
                paymentIntentId: null,
                userData: {},
                error: 'Invalid payment session. Please try signing up again.',
                user: req.session.user
            });
        }

        // Retrieve user data from PendingUser collection first
        const pendingUserId = session.client_reference_id;
        console.log('Pending User ID from session.client_reference_id:', pendingUserId);

        let pendingUser;
        try {
            pendingUser = await PendingUser.findById(pendingUserId);
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
        let subscriptionStatus = 'inactive';
        let paidForCurrentMonth = false;
        let subscriptionStart = new Date();
        let subscriptionEnd = null;
        let trialEnd = null;

        if (session.mode === 'subscription') {
            if (session.subscription) {
                const subscription = await stripe.subscriptions.retrieve(session.subscription.id);
                console.log('Retrieved subscription:', JSON.stringify(subscription, null, 2));

                if (subscription.status === 'active' || subscription.status === 'trialing') {
                    subscriptionStatus = subscription.status === 'trialing' ? 'trial' : 'active';
                    paidForCurrentMonth = true;
                    subscriptionStart = new Date(subscription.current_period_start * 1000);
                    
                    // Set subscription end based on membership type
                    if (pendingUser.membership === 'annual') {
                        // For annual, set to 1 year from start
                        subscriptionEnd = new Date(subscriptionStart);
                        subscriptionEnd.setFullYear(subscriptionEnd.getFullYear() + 1);
                    } else {
                        // For monthly, use current period end
                        subscriptionEnd = new Date(subscription.current_period_end * 1000);
                    }
                    
                    if (subscription.trial_end) {
                        trialEnd = new Date(subscription.trial_end * 1000);
                    }
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

        const stripeCustomerId = pendingUser.stripeCustomerId;
        const { username, email, firstName, lastName, membership } = pendingUser;
        console.log('Retrieved stripeCustomerId:', stripeCustomerId);

        // Call the /register endpoint with updated subscription details
        console.log('Calling /api/users/register with body:', {
            stripeCustomerId,
            subscriptionStatus,
            paidForCurrentMonth,
            subscriptionStart,
            subscriptionEnd,
            trialEnd,
            membership,
            pendingUserId
        });

        const response = await fetch('https://sodacityoutdoors.com/api/users/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                stripeCustomerId,
                subscriptionStatus,
                paidForCurrentMonth,
                subscriptionStart,
                subscriptionEnd,
                trialEnd,
                membership,
                pendingUserId
            }),
        });

        if (!response.ok && response.status !== 302) {
            const errorData = await response.text();
            console.error('Error registering user after payment:', errorData);
            return res.render('payment_success', {
                paymentIntentId: null,
                userData: { username, email, firstName, lastName },
                error: 'Error completing registration. Please contact support.',
                user: req.session.user
            });
        }

        // Delete the pending user record
        await PendingUser.findByIdAndDelete(pendingUserId);
        console.log('Deleted pending user after successful registration:', pendingUserId);

        // Redirect to sign-in page
        res.redirect('/signin');
    } catch (error) {
        console.error('Error in /payment-success:', error.message);
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
    const { email, subscriptionStatus, paidForCurrentMonth } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            console.error('User not found for email:', email);
            return res.status(404).json({ message: 'User not found' });
        }
        user.subscriptionStatus = subscriptionStatus;
        user.paidForCurrentMonth = paidForCurrentMonth;
        await user.save();
        console.log('Subscription status updated for user:', email);
        res.json({ message: 'Subscription status updated', subscriptionStatus, paidForCurrentMonth });
    } catch (error) {
        console.error('Error updating subscription status:', error);
        res.status(500).json({ message: 'Error updating subscription status', error: error.message });
    }
});

module.exports = router;