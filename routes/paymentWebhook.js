const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_API_KEY);
const User = require('../models/user');
const PendingUser = require('../models/pendingUser');
const { sendAdminNotification } = require('../services/adminNotifications');

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

    console.log('Webhook received:', event.type);

    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutSessionCompleted(event.data.object);
                break;
            case 'invoice.payment_failed':
                await handleInvoicePaymentFailed(event.data.object);
                break;
            case 'invoice.payment_succeeded':
                await handleInvoicePaymentSucceeded(event.data.object);
                break;
            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object);
                break;
            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(event.data.object);
                break;
            case 'payment_intent.payment_failed':
                await handlePaymentIntentFailed(event.data.object);
                break;
            case 'charge.dispute.created':
                await handleChargeDisputeCreated(event.data.object);
                break;
            case 'charge.failed':
                await handleChargeFailed(event.data.object);
                break;
            default:
                console.log('Unhandled event type:', event.type);
        }
        
        res.status(200).send('Webhook processed successfully');
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).send('Webhook processing failed');
    }
});

// Handle successful checkout session
async function handleCheckoutSessionCompleted(session) {
    const customerEmail = session.customer_email || (session.customer_details && session.customer_details.email);
    const pendingUserId = session.client_reference_id;
    console.log('Webhook received for checkout.session.completed, client_reference_id:', pendingUserId, 'email:', customerEmail);
    
    let pendingUser = null;
    if (pendingUserId && pendingUserId !== 'null' && pendingUserId !== 'undefined') {
        try {
            // Validate that pendingUserId is a valid ObjectId
            if (pendingUserId.match(/^[0-9a-fA-F]{24}$/)) {
                pendingUser = await PendingUser.findById(pendingUserId);
            } else {
                console.log('Invalid ObjectId format for pendingUserId:', pendingUserId);
            }
        } catch (error) {
            console.error('Error finding PendingUser by ID:', error);
        }
    }
    if (!pendingUser && customerEmail) {
        pendingUser = await PendingUser.findOne({ email: customerEmail });
    }
    if (!pendingUser) {
        console.error('No PendingUser found for client_reference_id or email:', pendingUserId, customerEmail);
        return;
    }
    
    try {
        // Calculate subscription end date based on membership type
        const now = new Date();
        let subscriptionEnd;
        if (pendingUser.membership === 'monthly') {
            subscriptionEnd = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days
        } else if (pendingUser.membership === 'annual') {
            subscriptionEnd = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000)); // 365 days
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
            membership: pendingUser.membership,
            accountStatus: 'active',
            subscriptionStart: now,
            subscriptionEnd: subscriptionEnd,
            paidForCurrentMonth: true,
            waiver: {
                accepted: pendingUser.waiverAccepted || false,
                acceptedDate: pendingUser.waiverAcceptedDate,
                version: '2025-04-17',
                ipAddress: pendingUser.waiverIpAddress,
                userAgent: pendingUser.waiverUserAgent
            }
        });
        await user.save();
        
        // Explicitly send welcome email after user creation
        try {
            const { sendWelcomeNewUserEmail } = require('../services/newUserEmails');
            await sendWelcomeNewUserEmail(user);
            console.log('[WEBHOOK] Welcome email sent to new user:', user.email);
        } catch (emailErr) {
            console.error('[WEBHOOK] Error sending welcome email:', emailErr);
        }
        
        // Send admin notification
        try {
            const subject = `New Member Registration - ${user.firstName} ${user.lastName}`;
            const text = `
New member has successfully registered and paid:
Name: ${user.firstName} ${user.lastName}
Email: ${user.email}
Username: ${user.username}
Membership: ${user.membership}
Phone: ${user.phone}
Stripe Customer ID: ${user.stripeCustomerId}
Registration Date: ${now.toISOString()}
            `;
            await sendAdminNotification(subject, text);
            console.log('[WEBHOOK] Admin notification sent for new user:', user.email);
        } catch (adminErr) {
            console.error('[WEBHOOK] Error sending admin notification:', adminErr);
        }
        
        await PendingUser.findByIdAndDelete(pendingUser._id);
        console.log('User promoted and PendingUser deleted for client_reference_id or email:', pendingUserId, customerEmail);
    } catch (err) {
        console.error('Error in webhook user promotion:', err);
        throw err;
    }
}

// Handle invoice payment failure
async function handleInvoicePaymentFailed(invoice) {
    const user = await User.findOne({ stripeCustomerId: invoice.customer });
    if (!user) {
        console.error('User not found for customer:', invoice.customer);
        return;
    }

    const failureData = {
        reason: 'invoice_payment_failed',
        stripeEventId: invoice.id,
        amount: invoice.amount_due,
        description: `Invoice payment failed for ${invoice.currency} ${invoice.amount_due / 100}`
    };

    await user.handlePaymentFailure(failureData);
    
    // Send admin notification
    const subject = `Payment Failure Alert - ${user.email}`;
    const text = `
Payment Failure Detected:
User: ${user.firstName} ${user.lastName} (${user.email})
Reason: Invoice payment failed
Amount: ${invoice.currency} ${invoice.amount_due / 100}
Account Status: ${user.accountStatus}
Action Required: ${user.accountStatus === 'suspended' ? 'Manual review required' : 'Monitor for additional failures'}
    `;
    
    await sendAdminNotification(subject, text);
    console.log('Payment failure handled for user:', user.email);
}

// Handle invoice payment succeeded
async function handleInvoicePaymentSucceeded(invoice) {
    const user = await User.findOne({ stripeCustomerId: invoice.customer });
    if (!user) {
        console.error('User not found for customer:', invoice.customer);
        return;
    }

    // Update subscription dates based on current period
    const now = new Date();
    const currentPeriodEnd = new Date(invoice.period_end * 1000);
    
    // Update subscription start and end dates
    user.subscriptionStart = new Date(invoice.period_start * 1000);
    user.subscriptionEnd = currentPeriodEnd;
    
    await user.save();
    console.log(`Subscription updated for user ${user.email}: period ends ${currentPeriodEnd.toISOString()}`);
}

// Handle subscription deletion
async function handleSubscriptionDeleted(subscription) {
    const user = await User.findOne({ stripeCustomerId: subscription.customer });
    if (!user) {
        console.error('User not found for customer:', subscription.customer);
        return;
    }

    user.accountStatus = 'expired';
    user.paidForCurrentMonth = false;
    await user.save();
    
    console.log('Subscription deleted for user:', user.email);
}

// Handle subscription updates
async function handleSubscriptionUpdated(subscription) {
    const user = await User.findOne({ stripeCustomerId: subscription.customer });
    if (!user) {
        console.error('User not found for customer:', subscription.customer);
        return;
    }

    if (subscription.status === 'past_due') {
        const failureData = {
            reason: 'subscription_past_due',
            stripeEventId: subscription.id,
            amount: subscription.items.data[0]?.price?.unit_amount || 0,
            description: 'Subscription payment past due'
        };
        
        await user.handlePaymentFailure(failureData);
    } else if (subscription.status === 'active') {
        user.accountStatus = 'active';
        user.paidForCurrentMonth = true;
        
        // Update subscription dates based on current period
        const now = new Date();
        const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
        
        // Update subscription start and end dates
        user.subscriptionStart = new Date(subscription.current_period_start * 1000);
        user.subscriptionEnd = currentPeriodEnd;
        
        await user.save();
        console.log(`Subscription updated for user ${user.email}: period ends ${currentPeriodEnd.toISOString()}`);
    }
    
    console.log('Subscription updated for user:', user.email);
}

// Handle payment intent failure
async function handlePaymentIntentFailed(paymentIntent) {
    const user = await User.findOne({ stripeCustomerId: paymentIntent.customer });
    if (!user) {
        console.error('User not found for customer:', paymentIntent.customer);
        return;
    }

    const failureData = {
        reason: paymentIntent.last_payment_error?.code || 'payment_intent_failed',
        stripeEventId: paymentIntent.id,
        amount: paymentIntent.amount,
        description: paymentIntent.last_payment_error?.message || 'Payment intent failed'
    };

    await user.handlePaymentFailure(failureData);
    console.log('Payment intent failed for user:', user.email);
}

// Handle charge dispute (potential fraud)
async function handleChargeDisputeCreated(dispute) {
    const user = await User.findOne({ stripeCustomerId: dispute.customer });
    if (!user) {
        console.error('User not found for customer:', dispute.customer);
        return;
    }

    const failureData = {
        reason: 'charge_dispute',
        stripeEventId: dispute.id,
        amount: dispute.amount,
        description: `Charge dispute created: ${dispute.reason}`
    };

    await user.handlePaymentFailure(failureData);
    
    // Send urgent admin notification
    const subject = `URGENT: Charge Dispute - ${user.email}`;
    const text = `
URGENT: Charge Dispute Detected:
User: ${user.firstName} ${user.lastName} (${user.email})
Dispute Reason: ${dispute.reason}
Amount: ${dispute.currency} ${dispute.amount / 100}
Account Status: ${user.accountStatus}
Action Required: IMMEDIATE REVIEW - Account has been suspended
    `;
    
    await sendAdminNotification(subject, text);
    console.log('Charge dispute handled for user:', user.email);
}

// Handle charge failure
async function handleChargeFailed(charge) {
    const user = await User.findOne({ stripeCustomerId: charge.customer });
    if (!user) {
        console.error('User not found for customer:', charge.customer);
        return;
    }

    const failureData = {
        reason: charge.failure_code || 'charge_failed',
        stripeEventId: charge.id,
        amount: charge.amount,
        description: charge.failure_message || 'Charge failed'
    };

    await user.handlePaymentFailure(failureData);
    console.log('Charge failed for user:', user.email);
}

module.exports = router; 