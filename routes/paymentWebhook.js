const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_API_KEY);
const User = require('../models/user');
const PendingUser = require('../models/pendingUser');

// Stripe webhook endpoint
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
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
        const pendingUserId = session.client_reference_id;
        console.log('Webhook received for checkout.session.completed, client_reference_id:', pendingUserId, 'email:', customerEmail);
        let pendingUser = null;
        if (pendingUserId) {
            pendingUser = await PendingUser.findById(pendingUserId);
        }
        if (!pendingUser && customerEmail) {
            pendingUser = await PendingUser.findOne({ email: customerEmail });
        }
        if (!pendingUser) {
            console.error('No PendingUser found for client_reference_id or email:', pendingUserId, customerEmail);
            return res.status(404).send('PendingUser not found');
        }
        try {
            // Promote to User (copy your existing logic here)
            const user = new User({
                username: pendingUser.username,
                password: pendingUser.password,
                email: pendingUser.email,
                firstName: pendingUser.firstName,
                lastName: pendingUser.lastName,
                phone: pendingUser.phone,
                stripeCustomerId: pendingUser.stripeCustomerId,
                membership: pendingUser.membership,
                subscriptionStatus: 'active',
                paidForCurrentMonth: true,
                waiverAccepted: pendingUser.waiverAccepted,
                waiverAcceptedDate: pendingUser.waiverAcceptedDate,
                waiverIpAddress: pendingUser.waiverIpAddress,
                waiverUserAgent: pendingUser.waiverUserAgent
            });
            await user.save();
            await PendingUser.findByIdAndDelete(pendingUser._id);
            console.log('User promoted and PendingUser deleted for client_reference_id or email:', pendingUserId, customerEmail);
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