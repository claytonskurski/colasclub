const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const WaiverAudit = require('./waiverAudit');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phone: { type: String, required: true },
    stripeCustomerId: { type: String },
    subscriptionStart: { type: Date },
    subscriptionEnd: { type: Date },
    trialEnd: { type: Date },
    paidForCurrentMonth: { type: Boolean, default: false },
    membership: { 
        type: String, 
        enum: ['monthly', 'annual', 'none'],
        required: true  
    },
    // New fields for payment failure handling
    accountStatus: {
        type: String,
        enum: ['trial', 'active', 'paused', 'suspended', 'pending_reinstatement'],
        default: 'trial'
    },
    paymentFailureHistory: [{
        date: { type: Date, default: Date.now },
        reason: { type: String, required: true },
        stripeEventId: { type: String },
        amount: { type: Number },
        description: { type: String }
    }],
    lastPaymentFailure: {
        date: { type: Date },
        reason: { type: String },
        stripeEventId: { type: String },
        attempts: { type: Number, default: 0 }
    },
    accountPauseReason: { type: String },
    accountPauseDate: { type: Date },
    reinstatementRequested: { type: Boolean, default: false },
    reinstatementRequestDate: { type: Date },
    adminNotes: { type: String },
    waiver: {
        accepted: { type: Boolean, default: false, immutable: true },
        acceptedDate: { type: Date, immutable: true },
        version: { type: String, default: '2025-04-17', immutable: true },
        ipAddress: { type: String, immutable: true },
        userAgent: { type: String, immutable: true }
    },
    accountType: {
        type: String,
        enum: ['founder', 'moderator', 'member'],
        default: 'member',
        required: true,
        validate: {
            validator: function(v) {
                // Only allow founder status during initial creation for claytonskurski
                if (v === 'founder') {
                    return this.isNew && this.username.toLowerCase() === 'claytonskurski';
                }
                return true;
            },
            message: 'Founder status can only be set for claytonskurski during account creation'
        }
    },
    profilePhoto: {
        type: String,
        default: null
    }
});

// Set trial end date and accountStatus on new user creation
userSchema.pre('save', function(next) {
    if (this.isNew) {
        const now = new Date();
        this.subscriptionStart = now;
        this.trialEnd = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days from now
        this.accountStatus = 'trial';
        this.paidForCurrentMonth = true;
    }
    next();
});

// Update accountStatus and paidForCurrentMonth based on trial and payment
userSchema.pre('save', function(next) {
    const now = new Date();
    if (this.accountStatus === 'trial' && this.trialEnd && this.trialEnd < now) {
        // Trial expired, check payment
        if (this.paidForCurrentMonth) {
            this.accountStatus = 'active';
        } else {
            this.accountStatus = 'paused';
        }
    }
    next();
});

// Method to activate subscription
userSchema.methods.activateSubscription = function(type) {
    const now = new Date();
    this.subscriptionStart = now;
    this.accountStatus = 'active';
    this.paidForCurrentMonth = true;
    
    if (type === 'monthly') {
        this.subscriptionEnd = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
    } else if (type === 'annual') {
        this.subscriptionEnd = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000));
    }
    
    return this.save();
};

// Method to check if subscription is active
userSchema.methods.isSubscriptionActive = function() {
    const now = new Date();
    return (
        this.accountStatus === 'active' ||
        (this.accountStatus === 'trial' && this.trialEnd > now) ||
        (this.subscriptionEnd && this.subscriptionEnd > now)
    );
};

// Method to handle payment failure
userSchema.methods.handlePaymentFailure = function(failureData) {
    const failure = {
        date: new Date(),
        reason: failureData.reason,
        stripeEventId: failureData.stripeEventId,
        amount: failureData.amount,
        description: failureData.description
    };
    
    this.paymentFailureHistory.push(failure);
    this.lastPaymentFailure = {
        date: failure.date,
        reason: failure.reason,
        stripeEventId: failure.stripeEventId,
        attempts: (this.lastPaymentFailure?.attempts || 0) + 1
    };
    
    // Determine account action based on failure reason and attempts
    if (failureData.reason === 'stolen_card' || failureData.reason === 'fraudulent') {
        this.accountStatus = 'suspended';
        this.accountPauseReason = `Account suspended due to ${failureData.reason}`;
        this.accountPauseDate = new Date();
    } else if (this.lastPaymentFailure.attempts >= 3) {
        this.accountStatus = 'paused';
        this.accountPauseReason = 'Multiple payment failures';
        this.accountPauseDate = new Date();
    }
    
    return this.save();
};

// Method to pause account
userSchema.methods.pauseAccount = function(reason, adminNotes = '') {
    this.accountStatus = 'paused';
    this.accountPauseReason = reason;
    this.accountPauseDate = new Date();
    this.adminNotes = adminNotes;
    return this.save();
};

// Method to suspend account
userSchema.methods.suspendAccount = function(reason, adminNotes = '') {
    this.accountStatus = 'suspended';
    this.accountPauseReason = reason;
    this.accountPauseDate = new Date();
    this.adminNotes = adminNotes;
    return this.save();
};

// Method to request reinstatement
userSchema.methods.requestReinstatement = function() {
    this.reinstatementRequested = true;
    this.reinstatementRequestDate = new Date();
    this.accountStatus = 'pending_reinstatement';
    return this.save();
};

// Method to reinstate account
userSchema.methods.reinstateAccount = function(adminNotes = '') {
    this.accountStatus = 'active';
    this.reinstatementRequested = false;
    this.reinstatementRequestDate = null;
    this.accountPauseReason = null;
    this.accountPauseDate = null;
    this.lastPaymentFailure = null;
    this.adminNotes = adminNotes;
    return this.save();
};

// Method to check if account is accessible
userSchema.methods.isAccountAccessible = function() {
    return this.accountStatus === 'active' && this.isSubscriptionActive();
};

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});

// Prevent modifications to waiver information and log attempts
userSchema.pre('save', async function(next) {
    if (!this.isNew && this.isModified('waiver')) {
        console.error('Attempt to modify waiver information detected');
        
        // Create audit log
        try {
            await WaiverAudit.create({
                userId: this._id,
                action: 'modify',
                previousValue: this._original.waiver,
                newValue: this.waiver,
                modifiedBy: 'direct_db_modification',
                ipAddress: 'unknown',
                userAgent: 'unknown'
            });
        } catch (error) {
            console.error('Failed to create audit log:', error);
        }
        
        const err = new Error('Waiver information cannot be modified once set');
        return next(err);
    }
    next();
});

// Store original document for comparison
userSchema.pre('save', function(next) {
    this._original = this.toObject();
    next();
});

// Additional middleware to prevent waiver updates and log attempts
userSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], async function(next) {
    const update = this.getUpdate();
    if (update && (update.waiver || update['$set']?.waiver)) {
        console.error('Attempt to modify waiver information detected');
        
        // Get the documents that would be modified
        const docs = await this.model.find(this.getQuery());
        
        // Create audit logs for each affected document
        try {
            await Promise.all(docs.map(doc => 
                WaiverAudit.create({
                    userId: doc._id,
                    action: 'modify',
                    previousValue: doc.waiver,
                    newValue: update.waiver || update['$set'].waiver,
                    modifiedBy: 'direct_db_modification',
                    ipAddress: 'unknown',
                    userAgent: 'unknown'
                })
            ));
        } catch (error) {
            console.error('Failed to create audit logs:', error);
        }
        
        const err = new Error('Waiver information cannot be modified once set');
        return next(err);
    }
    next();
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Add a static method to check if a user can be promoted to moderator
userSchema.statics.canBecomeModerator = async function(userId) {
    const user = await this.findById(userId);
    return user && (user.accountType === 'founder' || user.accountType === 'moderator');
};

// Add a static method to check if a user is the founder
userSchema.statics.isFounder = async function(userId) {
    const user = await this.findById(userId);
    return user && user.accountType === 'founder';
};

// Middleware to prevent changes to founder status
userSchema.pre('save', function(next) {
    if (!this.isNew && this.isModified('accountType')) {
        // If the user is a founder, prevent any changes to accountType
        if (this._original && this._original.accountType === 'founder') {
            console.error('Attempt to modify founder account type detected');
            const err = new Error('Founder account type cannot be modified');
            return next(err);
        }
        
        // Prevent setting anyone to founder after creation
        if (this.accountType === 'founder') {
            console.error('Attempt to set founder status after creation detected');
            const err = new Error('Founder status can only be set during account creation');
            return next(err);
        }
        
        // Only allow moderator changes if the modifier is a founder
        if (this.accountType === 'moderator') {
            // Note: The actual check for founder permission should be done in the route handler
            // This is just an additional safety check
            console.log('Moderator status change detected - ensure this is done by a founder');
        }
    }
    next();
});

// Additional middleware to prevent founder status changes in update operations
userSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], async function(next) {
    const update = this.getUpdate();
    const accountTypeUpdate = update.accountType || update['$set']?.accountType;

    if (accountTypeUpdate) {
        // Find the documents that would be modified
        const docs = await this.model.find(this.getQuery());
        
        for (const doc of docs) {
            // Prevent changes to founder accounts
            if (doc.accountType === 'founder') {
                console.error('Attempt to modify founder account type detected');
                const err = new Error('Founder account type cannot be modified');
                return next(err);
            }
            
            // Prevent setting founder status through updates
            if (accountTypeUpdate === 'founder') {
                console.error('Attempt to set founder status through update detected');
                const err = new Error('Founder status can only be set during account creation');
                return next(err);
            }
        }
    }
    next();
});

userSchema.pre('findOneAndDelete', async function(next) {
    const user = await this.model.findOne(this.getQuery());
    if (user) {
        try {
            const { sendAccountDeletionEmail } = require('../services/accountDeletionEmail');
            await sendAccountDeletionEmail(user);
        } catch (err) {
            console.error('[PRE-DELETE HOOK] Error sending account deletion email:', err);
        }
    }
    next();
});

// Post-save hook to send welcome email for new users (like account deletion emails)
userSchema.post('save', async function(doc) {
    if (doc.isNew) {
        try {
            const { sendWelcomeNewUserEmail } = require('../services/newUserEmails');
            await sendWelcomeNewUserEmail(doc);
            console.log('[POST-SAVE HOOK] Welcome email sent to new user:', doc.email);
        } catch (err) {
            console.error('[POST-SAVE HOOK] Error sending welcome email:', err);
        }
    }
});

module.exports = mongoose.model('User', userSchema);