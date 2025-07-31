// Load environment variables from .env file
require('dotenv').config();

const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_API_KEY);
const User = require('../models/user');
const { sendAdminNotification } = require('../services/adminNotifications');

/**
 * Fetch all customers from Stripe
 */
const fetchStripeCustomers = async () => {
    try {
        console.log('Fetching all Stripe customers...');
        const customers = [];
        let hasMore = true;
        let startingAfter = null;

        while (hasMore) {
            const params = { limit: 100 };
            if (startingAfter) {
                params.starting_after = startingAfter;
            }

            const response = await stripe.customers.list(params);
            customers.push(...response.data);
            
            hasMore = response.has_more;
            if (response.data.length > 0) {
                startingAfter = response.data[response.data.length - 1].id;
            }
        }

        console.log(`Fetched ${customers.length} customers from Stripe`);
        return customers;
    } catch (error) {
        console.error('Error fetching Stripe customers:', error);
        throw error;
    }
};

/**
 * Fetch all subscriptions from Stripe
 */
const fetchStripeSubscriptions = async () => {
    try {
        console.log('Fetching all Stripe subscriptions...');
        const subscriptions = [];
        let hasMore = true;
        let startingAfter = null;

        while (hasMore) {
            const params = { limit: 100 };
            if (startingAfter) {
                params.starting_after = startingAfter;
            }

            const response = await stripe.subscriptions.list(params);
            subscriptions.push(...response.data);
            
            hasMore = response.has_more;
            if (response.data.length > 0) {
                startingAfter = response.data[response.data.length - 1].id;
            }
        }

        console.log(`Fetched ${subscriptions.length} subscriptions from Stripe`);
        return subscriptions;
    } catch (error) {
        console.error('Error fetching Stripe subscriptions:', error);
        throw error;
    }
};

/**
 * Get payment-based account status for a customer
 */
const getCustomerPaymentStatus = async (customerId) => {
    try {
        // First check for active subscriptions (in case you have some)
        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'all'
        });

        const activeSubscription = subscriptions.data.find(sub => 
            sub.status === 'active' || sub.status === 'trialing'
        );

        if (activeSubscription) {
            return {
                hasActiveSubscription: true,
                subscriptionStatus: activeSubscription.status,
                currentPeriodEnd: new Date(activeSubscription.current_period_end * 1000),
                cancelAtPeriodEnd: activeSubscription.cancel_at_period_end,
                subscriptionId: activeSubscription.id,
                lastPaymentDate: null,
                paymentBasedActive: false
            };
        }

        // Get customer details to see their payment history
        const customer = await stripe.customers.retrieve(customerId);
        
        // Check charges for this customer (this should include all payments)
        const charges = await stripe.charges.list({
            customer: customerId,
            limit: 20
        });

        // Check payment intents
        const payments = await stripe.paymentIntents.list({
            customer: customerId,
            limit: 20
        });

        // Check for payment failures (failed charges and payment intents)
        const failedCharges = charges.data.filter(charge => charge.status === 'failed');
        const failedPayments = payments.data.filter(payment => 
            payment.status === 'requires_payment_method' || 
            payment.status === 'canceled' ||
            payment.status === 'requires_action'
        );

        console.log(`Customer ${customerId}: Found ${failedCharges.length} failed charges, ${failedPayments.length} failed payment intents`);

        // If no charges found, try to find other customers with the same email
        let allCharges = charges.data;
        let allPayments = payments.data;
        
        if (charges.data.length === 0 && customer.email) {
            console.log(`No charges found for ${customerId}, searching for other customers with email: ${customer.email}`);
            
            // Find all customers with the same email
            const allCustomersWithEmail = await stripe.customers.list({
                email: customer.email,
                limit: 10
            });
            
            // Get charges for all customers with this email
            for (const otherCustomer of allCustomersWithEmail.data) {
                if (otherCustomer.id !== customerId) {
                    const otherCharges = await stripe.charges.list({
                        customer: otherCustomer.id,
                        limit: 20
                    });
                    const otherPayments = await stripe.paymentIntents.list({
                        customer: otherCustomer.id,
                        limit: 20
                    });
                    
                    allCharges = allCharges.concat(otherCharges.data);
                    allPayments = allPayments.concat(otherPayments.data);
                    
                    console.log(`Found ${otherCharges.data.length} charges for customer ${otherCustomer.id}`);
                }
            }
        }

        console.log(`Customer ${customerId} (${customer.email}): Found ${allPayments.length} payment intents, ${allCharges.length} charges`);
        console.log(`Customer ${customerId}: Created ${new Date(customer.created * 1000).toLocaleDateString()}, Last payment: ${customer.metadata?.last_payment_date || 'Not in metadata'}`);

        // Combine and sort all payments by date
        const paymentRecords = [];
        
        // Add successful charges (these should include all payments)
        allCharges.forEach(charge => {
            if (charge.status === 'succeeded' && charge.amount > 0) {
                paymentRecords.push({
                    date: new Date(charge.created * 1000),
                    amount: charge.amount / 100, // Convert from cents
                    type: 'charge',
                    description: charge.description || 'Payment'
                });
            }
        });

        // Add successful payment intents (as backup)
        allPayments.forEach(payment => {
            if (payment.status === 'succeeded' && payment.amount > 0) {
                // Check if we already have this payment as a charge
                const existingPayment = paymentRecords.find(p => 
                    Math.abs(p.date.getTime() - new Date(payment.created * 1000).getTime()) < 60000 // Within 1 minute
                );
                
                if (!existingPayment) {
                    paymentRecords.push({
                        date: new Date(payment.created * 1000),
                        amount: payment.amount / 100, // Convert from cents
                        type: 'payment_intent',
                        description: 'Payment Intent'
                    });
                }
            }
        });

        // Sort by date (most recent first)
        paymentRecords.sort((a, b) => b.date - a.date);

        console.log(`Customer ${customerId}: Total valid payments found: ${paymentRecords.length}`);
        if (paymentRecords.length > 0) {
            console.log(`Customer ${customerId}: Most recent payment: ${paymentRecords[0].date.toLocaleDateString()} - $${paymentRecords[0].amount}`);
        }

        if (paymentRecords.length === 0) {
            return {
                hasActiveSubscription: false,
                subscriptionStatus: 'none',
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                subscriptionId: null,
                lastPaymentDate: null,
                paymentBasedActive: false
            };
        }

        const lastPayment = paymentRecords[0];
        const paymentDate = lastPayment.date;
        
        // Check if this is an annual subscription user
        const annualUsers = ['Bradley', 'claytonskurski', 'danindixie'];
        const isAnnualUser = annualUsers.some(name => 
            customer.email && customer.email.toLowerCase().includes(name.toLowerCase()) ||
            customer.name && customer.name.toLowerCase().includes(name.toLowerCase())
        );
        
        const activeUntil = new Date(paymentDate);
        if (isAnnualUser) {
            activeUntil.setFullYear(activeUntil.getFullYear() + 1); // 1 year from payment
            console.log(`Customer ${customerId}: Annual subscription - active until ${activeUntil.toLocaleDateString()}`);
        } else {
            activeUntil.setDate(activeUntil.getDate() + 30); // 30 days from payment
        }

        const now = new Date();
        const isPaymentBasedActive = now <= activeUntil;

        console.log(`Customer ${customerId}: Last payment ${paymentDate.toLocaleDateString()}, active until ${activeUntil.toLocaleDateString()}, currently active: ${isPaymentBasedActive}, amount: $${lastPayment.amount}`);

        return {
            hasActiveSubscription: false,
            subscriptionStatus: 'payment_based',
            currentPeriodEnd: activeUntil,
            cancelAtPeriodEnd: false,
            subscriptionId: null,
            lastPaymentDate: paymentDate,
            paymentBasedActive: isPaymentBasedActive,
            hasPaymentFailures: failedCharges.length > 0 || failedPayments.length > 0,
            failedCharges: failedCharges,
            failedPayments: failedPayments,
            lastPaymentFailure: failedCharges.length > 0 ? {
                date: new Date(failedCharges[0].created * 1000),
                reason: failedCharges[0].failure_reason || 'Payment failed',
                stripeEventId: failedCharges[0].id,
                amount: failedCharges[0].amount / 100
            } : null
        };

    } catch (error) {
        console.error(`Error getting payment status for customer ${customerId}:`, error);
        return {
            hasActiveSubscription: false,
            subscriptionStatus: 'error',
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            subscriptionId: null,
            lastPaymentDate: null,
            paymentBasedActive: false
        };
    }
};

/**
 * Compare user database with Stripe data
 */
const compareUserAndStripeData = async () => {
    try {
        console.log('Starting Stripe sync analysis...');
        
        // Fetch data from both sources
        const stripeCustomers = await fetchStripeCustomers();
        const stripeSubscriptions = await fetchStripeSubscriptions();
        const dbUsers = await User.find({});

        console.log(`Database users: ${dbUsers.length}`);
        console.log(`Stripe customers: ${stripeCustomers.length}`);

        // Analysis results
        const analysis = {
            totalDbUsers: dbUsers.length,
            totalStripeCustomers: stripeCustomers.length,
            matchedUsers: [],
            unmatchedStripeCustomers: [],
            unmatchedDbUsers: [],
            discrepancies: [],
            recommendations: []
        };

        // Create Stripe customer map
        const stripeCustomerMap = new Map();
        stripeCustomers.forEach(customer => {
            stripeCustomerMap.set(customer.id, customer);
        });

        // Analyze each database user
        for (const dbUser of dbUsers) {
            console.log(`\nAnalyzing user: ${dbUser.username} (${dbUser.email})`);
            if (!dbUser.stripeCustomerId) {
                analysis.unmatchedDbUsers.push({
                    username: dbUser.username,
                    email: dbUser.email,
                    reason: 'No Stripe Customer ID'
                });
                continue;
            }

            const stripeCustomer = stripeCustomerMap.get(dbUser.stripeCustomerId);
            if (!stripeCustomer) {
                analysis.unmatchedDbUsers.push({
                    username: dbUser.username,
                    email: dbUser.email,
                    stripeCustomerId: dbUser.stripeCustomerId,
                    reason: 'Customer not found in Stripe'
                });
                continue;
            }

            // Get payment-based status
            const paymentStatus = await getCustomerPaymentStatus(dbUser.stripeCustomerId);
            
            // Check for discrepancies
            const discrepancies = [];
            
            // Determine if user should be active based on Stripe data
            const shouldBeActive = paymentStatus.hasActiveSubscription || paymentStatus.paymentBasedActive;
            const shouldBePaid = paymentStatus.hasActiveSubscription && 
                               paymentStatus.subscriptionStatus === 'active';
            
            // Check account status vs payment status
            if (dbUser.accountStatus === 'active' && !shouldBeActive) {
                discrepancies.push(`Account marked active but no active subscription/payment in Stripe (last payment: ${paymentStatus.lastPaymentDate ? paymentStatus.lastPaymentDate.toLocaleDateString() : 'none'})`);
            }
            
            if (dbUser.accountStatus === 'trial' && shouldBeActive && !paymentStatus.hasActiveSubscription) {
                discrepancies.push('Account marked trial but has active payment in Stripe');
            }

            // Check paidForCurrentMonth
            if (dbUser.paidForCurrentMonth !== shouldBePaid) {
                discrepancies.push(`paidForCurrentMonth mismatch: DB=${dbUser.paidForCurrentMonth}, Stripe=${shouldBePaid}`);
            }

            // Check payment failures
            if (paymentStatus.hasPaymentFailures && (!dbUser.lastPaymentFailure || !dbUser.lastPaymentFailure.date)) {
                discrepancies.push(`Payment failures detected in Stripe but not recorded in database`);
            }

            // Check if user should be paused due to payment failures
            if (paymentStatus.hasPaymentFailures && dbUser.accountStatus !== 'paused') {
                discrepancies.push(`User has payment failures but account is not paused`);
            }

            // Check subscription end dates
            if (dbUser.subscriptionEnd && paymentStatus.currentPeriodEnd) {
                const dbEnd = new Date(dbUser.subscriptionEnd);
                const stripeEnd = paymentStatus.currentPeriodEnd;
                const daysDiff = Math.abs((dbEnd - stripeEnd) / (1000 * 60 * 60 * 24));
                
                if (daysDiff > 1) { // Allow 1 day difference for timezone issues
                    discrepancies.push(`Subscription end date mismatch: DB=${dbEnd.toISOString()}, Stripe=${stripeEnd.toISOString()}`);
                }
            }

            analysis.matchedUsers.push({
                username: dbUser.username,
                email: dbUser.email,
                stripeCustomerId: dbUser.stripeCustomerId,
                dbAccountStatus: dbUser.accountStatus,
                dbPaidForCurrentMonth: dbUser.paidForCurrentMonth,
                stripeSubscriptionStatus: paymentStatus.subscriptionStatus,
                stripeHasActiveSubscription: paymentStatus.hasActiveSubscription,
                stripeCurrentPeriodEnd: paymentStatus.currentPeriodEnd,
                discrepancies: discrepancies
            });

            if (discrepancies.length > 0) {
                analysis.discrepancies.push({
                    username: dbUser.username,
                    email: dbUser.email,
                    discrepancies: discrepancies
                });
            }
        }

        // Find Stripe customers not in database
        const dbCustomerIds = new Set(dbUsers.map(user => user.stripeCustomerId).filter(id => id));
        stripeCustomers.forEach(customer => {
            if (!dbCustomerIds.has(customer.id)) {
                analysis.unmatchedStripeCustomers.push({
                    customerId: customer.id,
                    email: customer.email,
                    name: customer.name,
                    created: new Date(customer.created * 1000)
                });
            }
        });

        // Generate recommendations
        if (analysis.discrepancies.length > 0) {
            analysis.recommendations.push('Update accountStatus and paidForCurrentMonth for users with discrepancies');
        }
        
        if (analysis.unmatchedStripeCustomers.length > 0) {
            analysis.recommendations.push('Review Stripe customers not in database - may need to be added or removed');
        }
        
        if (analysis.unmatchedDbUsers.length > 0) {
            analysis.recommendations.push('Review database users without Stripe customers');
        }

        return analysis;
    } catch (error) {
        console.error('Error in Stripe sync analysis:', error);
        throw error;
    }
};

/**
 * Generate detailed HTML report
 */
const generateStripeSyncReport = (analysis) => {
    const discrepanciesHtml = analysis.discrepancies.map(item => `
        <div style="background-color:#fff3cd;border:1px solid #ffeaa7;border-radius:8px;padding:15px;margin:10px 0;">
            <h4 style="color:#856404;margin:0 0 10px 0;">${item.username} (${item.email})</h4>
            <ul style="color:#856404;margin:0;padding-left:20px;">
                ${item.discrepancies.map(d => `<li>${d}</li>`).join('')}
            </ul>
        </div>
    `).join('');

    const unmatchedStripeHtml = analysis.unmatchedStripeCustomers.map(customer => `
        <div style="background-color:#f8d7da;border:1px solid #f5c6cb;border-radius:8px;padding:15px;margin:10px 0;">
            <h4 style="color:#721c24;margin:0 0 10px 0;">Customer ID: ${customer.customerId}</h4>
            <p style="color:#721c24;margin:5px 0;">Email: ${customer.email}</p>
            <p style="color:#721c24;margin:5px 0;">Name: ${customer.name || 'N/A'}</p>
            <p style="color:#721c24;margin:5px 0;">Created: ${customer.created.toLocaleDateString()}</p>
        </div>
    `).join('');

    const unmatchedDbHtml = analysis.unmatchedDbUsers.map(user => `
        <div style="background-color:#d1ecf1;border:1px solid #bee5eb;border-radius:8px;padding:15px;margin:10px 0;">
            <h4 style="color:#0c5460;margin:0 0 10px 0;">${user.username} (${user.email})</h4>
            <p style="color:#0c5460;margin:5px 0;">Reason: ${user.reason}</p>
            ${user.stripeCustomerId ? `<p style="color:#0c5460;margin:5px 0;">Stripe ID: ${user.stripeCustomerId}</p>` : ''}
        </div>
    `).join('');

    const recommendationsHtml = analysis.recommendations.map(rec => `
        <li style="color:#155724;margin:5px 0;">${rec}</li>
    `).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Stripe Sync Report - Soda City Outdoors</title>
        </head>
        <body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8f9fa;">
        <div style="background:#fff;margin:0 auto;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            <div style="text-align:center;margin-bottom:30px;">
                <h1 style="color:#2c3e50;margin:0;">Stripe Sync Report</h1>
                <p style="color:#666;margin:10px 0;">Generated on ${new Date().toLocaleString()}</p>
            </div>
            
            <div style="background-color:#d4edda;border:1px solid #c3e6cb;border-radius:8px;padding:20px;margin:20px 0;">
                <h2 style="color:#155724;margin:0 0 15px 0;">Summary</h2>
                <p style="color:#155724;margin:5px 0;"><strong>Database Users:</strong> ${analysis.totalDbUsers}</p>
                <p style="color:#155724;margin:5px 0;"><strong>Stripe Customers:</strong> ${analysis.totalStripeCustomers}</p>
                <p style="color:#155724;margin:5px 0;"><strong>Matched Users:</strong> ${analysis.matchedUsers.length}</p>
                <p style="color:#155724;margin:5px 0;"><strong>Discrepancies Found:</strong> ${analysis.discrepancies.length}</p>
                <p style="color:#155724;margin:5px 0;"><strong>Unmatched Stripe Customers:</strong> ${analysis.unmatchedStripeCustomers.length}</p>
                <p style="color:#155724;margin:5px 0;"><strong>Unmatched Database Users:</strong> ${analysis.unmatchedDbUsers.length}</p>
            </div>

            ${analysis.discrepancies.length > 0 ? `
                <div style="margin:30px 0;">
                    <h2 style="color:#856404;margin:0 0 20px 0;">⚠️ Discrepancies Found</h2>
                    ${discrepanciesHtml}
                </div>
            ` : ''}

            ${analysis.unmatchedStripeCustomers.length > 0 ? `
                <div style="margin:30px 0;">
                    <h2 style="color:#721c24;margin:0 0 20px 0;">🔍 Stripe Customers Not in Database</h2>
                    ${unmatchedStripeHtml}
                </div>
            ` : ''}

            ${analysis.unmatchedDbUsers.length > 0 ? `
                <div style="margin:30px 0;">
                    <h2 style="color:#0c5460;margin:0 0 20px 0;">🔍 Database Users Not in Stripe</h2>
                    ${unmatchedDbHtml}
                </div>
            ` : ''}

            ${analysis.recommendations.length > 0 ? `
                <div style="background-color:#fff3cd;border:1px solid #ffeaa7;border-radius:8px;padding:20px;margin:30px 0;">
                    <h2 style="color:#856404;margin:0 0 15px 0;">📋 Recommendations</h2>
                    <ul style="color:#856404;margin:0;padding-left:20px;">
                        ${recommendationsHtml}
                    </ul>
                </div>
            ` : ''}

            <div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee;">
                <p style="color:#666;font-size:14px;margin:0;"><strong>Soda City Outdoors</strong></p>
                <p style="color:#666;font-size:12px;margin:5px 0 0 0;">This report was generated automatically by the Stripe sync system.</p>
            </div>
        </div>
        </body>
        </html>
    `;
};

/**
 * Sync database users with Stripe data based on analysis
 */
const syncDatabaseWithStripe = async (analysis) => {
    try {
        console.log('🔄 Starting database sync with Stripe...');
        
        const syncResults = {
            updatedUsers: [],
            errors: [],
            summary: {
                totalProcessed: 0,
                updated: 0,
                errors: 0
            }
        };

        // Process users with discrepancies
        for (const discrepancy of analysis.discrepancies) {
            syncResults.summary.totalProcessed++;
            
            try {
                const user = await User.findOne({ email: discrepancy.email });
                if (!user) {
                    syncResults.errors.push(`User not found: ${discrepancy.email}`);
                    continue;
                }

                // Get current Stripe payment status
                const paymentStatus = await getCustomerPaymentStatus(user.stripeCustomerId);
                
                // Determine correct account status
                let newAccountStatus = user.accountStatus;
                let newPaidForCurrentMonth = user.paidForCurrentMonth;
                let newPaymentFailureHistory = user.paymentFailureHistory || [];
                let newLastPaymentFailure = user.lastPaymentFailure || {};
                
                // Handle payment failures first
                if (paymentStatus.hasPaymentFailures) {
                    // Add payment failure to history if not already recorded
                    const failureToAdd = {
                        date: paymentStatus.lastPaymentFailure.date,
                        reason: paymentStatus.lastPaymentFailure.reason,
                        stripeEventId: paymentStatus.lastPaymentFailure.stripeEventId,
                        amount: paymentStatus.lastPaymentFailure.amount,
                        description: `Payment failure detected via Stripe sync`
                    };
                    
                    // Check if this failure is already recorded
                    const failureExists = newPaymentFailureHistory.some(failure => 
                        failure.stripeEventId === failureToAdd.stripeEventId
                    );
                    
                    if (!failureExists) {
                        newPaymentFailureHistory.push(failureToAdd);
                    }
                    
                    // Update last payment failure
                    newLastPaymentFailure = {
                        date: paymentStatus.lastPaymentFailure.date,
                        reason: paymentStatus.lastPaymentFailure.reason,
                        stripeEventId: paymentStatus.lastPaymentFailure.stripeEventId,
                        attempts: (newLastPaymentFailure.attempts || 0) + 1
                    };
                    
                    // Pause account due to payment failure
                    newAccountStatus = 'paused';
                    newPaidForCurrentMonth = false;
                } else if (paymentStatus.hasActiveSubscription && paymentStatus.subscriptionStatus === 'active') {
                    newAccountStatus = 'active';
                    newPaidForCurrentMonth = true;
                } else if (paymentStatus.hasActiveSubscription && paymentStatus.subscriptionStatus === 'trialing') {
                    newAccountStatus = 'trial';
                    newPaidForCurrentMonth = false;
                } else if (paymentStatus.paymentBasedActive) {
                    // Payment-based active (like AndreaSH)
                    newAccountStatus = 'active';
                    newPaidForCurrentMonth = false; // They paid but not for current month yet
                } else {
                    // No active subscription or payment - check if they have a trial period
                    if (user.trialEnd && new Date() < new Date(user.trialEnd)) {
                        newAccountStatus = 'trial';
                        newPaidForCurrentMonth = false;
                    } else {
                        newAccountStatus = 'inactive';
                        newPaidForCurrentMonth = false;
                    }
                }

                // Update subscription end date if available
                let newSubscriptionEnd = user.subscriptionEnd;
                if (paymentStatus.currentPeriodEnd) {
                    newSubscriptionEnd = paymentStatus.currentPeriodEnd;
                }

                // Only update if there are actual changes
                const hasChanges = 
                    newAccountStatus !== user.accountStatus ||
                    newPaidForCurrentMonth !== user.paidForCurrentMonth ||
                    (newSubscriptionEnd && (!user.subscriptionEnd || 
                     Math.abs(new Date(newSubscriptionEnd) - new Date(user.subscriptionEnd)) > 24 * 60 * 60 * 1000)) || // 1 day tolerance
                    paymentStatus.hasPaymentFailures !== (user.paymentFailureHistory && user.paymentFailureHistory.length > 0);

                if (hasChanges) {
                    const updateData = {
                        accountStatus: newAccountStatus,
                        paidForCurrentMonth: newPaidForCurrentMonth
                    };

                    if (newSubscriptionEnd) {
                        updateData.subscriptionEnd = newSubscriptionEnd;
                    }

                    // Add payment failure data if there are failures
                    if (paymentStatus.hasPaymentFailures) {
                        updateData.paymentFailureHistory = newPaymentFailureHistory;
                        updateData.lastPaymentFailure = newLastPaymentFailure;
                        updateData.accountPauseReason = 'Payment failure detected';
                        updateData.accountPauseDate = new Date();
                    }

                    await User.findByIdAndUpdate(user._id, updateData);
                    
                    syncResults.updatedUsers.push({
                        username: user.username,
                        email: user.email,
                        oldStatus: user.accountStatus,
                        newStatus: newAccountStatus,
                        oldPaid: user.paidForCurrentMonth,
                        newPaid: newPaidForCurrentMonth,
                        oldSubscriptionEnd: user.subscriptionEnd,
                        newSubscriptionEnd: newSubscriptionEnd
                    });
                    
                    syncResults.summary.updated++;
                    console.log(`✅ Updated user ${user.username}: ${user.accountStatus} → ${newAccountStatus}, paid: ${user.paidForCurrentMonth} → ${newPaidForCurrentMonth}`);
                } else {
                    console.log(`ℹ️ No changes needed for user ${user.username}`);
                }

            } catch (error) {
                syncResults.errors.push(`Error updating ${discrepancy.email}: ${error.message}`);
                syncResults.summary.errors++;
                console.error(`❌ Error updating user ${discrepancy.email}:`, error);
            }
        }

        // Process unmatched database users (users with Stripe IDs that don't exist)
        for (const unmatchedUser of analysis.unmatchedDbUsers) {
            if (unmatchedUser.stripeCustomerId) {
                syncResults.summary.totalProcessed++;
                
                try {
                    const user = await User.findOne({ email: unmatchedUser.email });
                    if (!user) continue;

                    // Clear the invalid Stripe customer ID and mark as inactive
                    await User.findByIdAndUpdate(user._id, {
                        stripeCustomerId: null,
                        accountStatus: 'inactive',
                        paidForCurrentMonth: false
                    });

                    syncResults.updatedUsers.push({
                        username: user.username,
                        email: user.email,
                        action: 'Cleared invalid Stripe ID and marked inactive',
                        oldStatus: user.accountStatus,
                        newStatus: 'inactive',
                        oldPaid: user.paidForCurrentMonth,
                        newPaid: false
                    });

                    syncResults.summary.updated++;
                    console.log(`✅ Cleared invalid Stripe ID for user ${user.username}`);

                } catch (error) {
                    syncResults.errors.push(`Error processing unmatched user ${unmatchedUser.email}: ${error.message}`);
                    syncResults.summary.errors++;
                }
            }
        }

        console.log(`🔄 Database sync completed: ${syncResults.summary.updated} updated, ${syncResults.summary.errors} errors`);
        return syncResults;

    } catch (error) {
        console.error('❌ Error in database sync:', error);
        throw error;
    }
};

/**
 * Generate sync results report
 */
const generateSyncResultsReport = (syncResults) => {
    const updatedUsersHtml = syncResults.updatedUsers.map(user => `
        <div style="background-color:#d4edda;border:1px solid #c3e6cb;border-radius:8px;padding:15px;margin:10px 0;">
            <h4 style="color:#155724;margin:0 0 10px 0;">${user.username} (${user.email})</h4>
            ${user.action ? `<p style="color:#155724;margin:5px 0;"><strong>Action:</strong> ${user.action}</p>` : ''}
            <p style="color:#155724;margin:5px 0;"><strong>Status:</strong> ${user.oldStatus} → ${user.newStatus}</p>
            <p style="color:#155724;margin:5px 0;"><strong>Paid:</strong> ${user.oldPaid} → ${user.newPaid}</p>
            ${user.oldSubscriptionEnd && user.newSubscriptionEnd ? 
                `<p style="color:#155724;margin:5px 0;"><strong>Subscription End:</strong> ${new Date(user.oldSubscriptionEnd).toLocaleDateString()} → ${new Date(user.newSubscriptionEnd).toLocaleDateString()}</p>` : ''}
        </div>
    `).join('');

    const errorsHtml = syncResults.errors.map(error => `
        <div style="background-color:#f8d7da;border:1px solid #f5c6cb;border-radius:8px;padding:15px;margin:10px 0;">
            <p style="color:#721c24;margin:0;">❌ ${error}</p>
        </div>
    `).join('');

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Database Sync Results - Soda City Outdoors</title>
        </head>
        <body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8f9fa;">
        <div style="background:#fff;margin:0 auto;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
            <div style="text-align:center;margin-bottom:30px;">
                <h1 style="color:#2c3e50;margin:0;">Database Sync Results</h1>
                <p style="color:#666;margin:10px 0;">Generated on ${new Date().toLocaleString()}</p>
            </div>
            
            <div style="background-color:#d4edda;border:1px solid #c3e6cb;border-radius:8px;padding:20px;margin:20px 0;">
                <h2 style="color:#155724;margin:0 0 15px 0;">Summary</h2>
                <p style="color:#155724;margin:5px 0;"><strong>Total Processed:</strong> ${syncResults.summary.totalProcessed}</p>
                <p style="color:#155724;margin:5px 0;"><strong>Successfully Updated:</strong> ${syncResults.summary.updated}</p>
                <p style="color:#155724;margin:5px 0;"><strong>Errors:</strong> ${syncResults.summary.errors}</p>
            </div>

            ${syncResults.updatedUsers.length > 0 ? `
                <div style="margin:30px 0;">
                    <h2 style="color:#155724;margin:0 0 20px 0;">✅ Updated Users</h2>
                    ${updatedUsersHtml}
                </div>
            ` : ''}

            ${syncResults.errors.length > 0 ? `
                <div style="margin:30px 0;">
                    <h2 style="color:#721c24;margin:0 0 20px 0;">❌ Errors</h2>
                    ${errorsHtml}
                </div>
            ` : ''}

            <div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee;">
                <p style="color:#666;font-size:14px;margin:0;"><strong>Soda City Outdoors</strong></p>
                <p style="color:#666;font-size:12px;margin:5px 0 0 0;">This report was generated automatically by the Stripe sync system.</p>
            </div>
        </div>
        </body>
        </html>
    `;
};

/**
 * Monthly Stripe Database Sync
 * 
 * This script aligns your database with Stripe payment reality.
 * Run this monthly to ensure account status matches actual payments.
 * 
 * Features:
 * - Handles monthly and annual subscriptions
 * - Finds payments across multiple customer records
 * - Updates accountStatus and paidForCurrentMonth
 * - Handles payment failures and account pausing
 * - Sends detailed reports via email
 * 
 * Usage:
 * - node scripts/stripeSync.js (full sync with database updates)
 * - node scripts/stripeSync.js --analyze (read-only analysis)
 */
const runMonthlyStripeSync = async () => {
    try {
        console.log('🚀 Starting Monthly Stripe Database Sync...');
        
        // Connect to MongoDB
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB connected successfully');
        
        // Step 1: Analyze discrepancies
        console.log('\n📊 Step 1: Analyzing Stripe vs Database discrepancies...');
        const analysis = await compareUserAndStripeData();
        
        console.log(`📈 Analysis Results:`);
        console.log(`- Database Users: ${analysis.totalDbUsers}`);
        console.log(`- Stripe Customers: ${analysis.totalStripeCustomers}`);
        console.log(`- Matched Users: ${analysis.matchedUsers.length}`);
        console.log(`- Discrepancies Found: ${analysis.discrepancies.length}`);
        console.log(`- Unmatched Stripe Customers: ${analysis.unmatchedStripeCustomers.length}`);
        console.log(`- Unmatched Database Users: ${analysis.unmatchedDbUsers.length}`);
        
        // Send initial analysis report
        const analysisReportHtml = generateStripeSyncReport(analysis);
        await sendAdminNotification(
            'Monthly Stripe Sync Analysis',
            analysisReportHtml,
            true
        );
        console.log('📧 Analysis report sent to admin');
        
        // Check if this is analysis-only mode
        const isAnalysisOnly = process.argv.includes('--analyze');
        
        if (isAnalysisOnly) {
            console.log('\n📊 Analysis-only mode - no database changes will be made');
            await mongoose.disconnect();
            console.log('MongoDB disconnected');
            return {
                initialAnalysis: analysis,
                syncResults: null,
                finalAnalysis: analysis
            };
        }
        
        // Step 2: Perform database sync if there are discrepancies
        if (analysis.discrepancies.length > 0 || analysis.unmatchedDbUsers.length > 0) {
            console.log('\n🔄 Step 2: Performing database sync...');
            
            const syncResults = await syncDatabaseWithStripe(analysis);
            
            console.log(`\n✅ Sync Results:`);
            console.log(`- Total Processed: ${syncResults.summary.totalProcessed}`);
            console.log(`- Successfully Updated: ${syncResults.summary.updated}`);
            console.log(`- Errors: ${syncResults.summary.errors}`);
            
            // Send sync results report
            const syncReportHtml = generateSyncResultsReport(syncResults);
            await sendAdminNotification(
                'Monthly Database Sync Results',
                syncReportHtml,
                true
            );
            console.log('📧 Sync results report sent to admin');
            
            // Step 3: Run final analysis to confirm sync
            console.log('\n📊 Step 3: Running final analysis to confirm sync...');
            const finalAnalysis = await compareUserAndStripeData();
            
            console.log(`📈 Final Analysis Results:`);
            console.log(`- Remaining Discrepancies: ${finalAnalysis.discrepancies.length}`);
            console.log(`- Remaining Unmatched DB Users: ${finalAnalysis.unmatchedDbUsers.length}`);
            
            // Send final confirmation report
            const finalReportHtml = generateStripeSyncReport(finalAnalysis);
            await sendAdminNotification(
                'Monthly Stripe Sync - Final Report',
                finalReportHtml,
                true
            );
            console.log('📧 Final confirmation report sent to admin');
            
            await mongoose.disconnect();
            console.log('MongoDB disconnected');
            
            return {
                initialAnalysis: analysis,
                syncResults: syncResults,
                finalAnalysis: finalAnalysis
            };
            
        } else {
            console.log('\n✅ No discrepancies found - database is already in sync with Stripe!');
            await mongoose.disconnect();
            console.log('MongoDB disconnected');
            return {
                initialAnalysis: analysis,
                syncResults: null,
                finalAnalysis: analysis
            };
        }
        
    } catch (error) {
        console.error('❌ Error in monthly sync:', error);
        await mongoose.disconnect();
        console.log('MongoDB disconnected');
        throw error;
    }
};

// Run the monthly sync if this script is executed directly
if (require.main === module) {
    runMonthlyStripeSync()
        .then(results => {
            console.log('\n🎉 Monthly Stripe database sync finished successfully!');
            if (results.syncResults) {
                console.log(`📊 Summary: ${results.syncResults.summary.updated} users updated`);
            }
        })
        .catch(error => {
            console.error('💥 Monthly sync failed:', error);
            process.exit(1);
        });
}

module.exports = {
    runMonthlyStripeSync,
    compareUserAndStripeData,
    fetchStripeCustomers,
    fetchStripeSubscriptions,
    generateStripeSyncReport,
    syncDatabaseWithStripe,
    generateSyncResultsReport
}; 