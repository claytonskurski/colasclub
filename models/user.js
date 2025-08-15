const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phone: { type: String, required: false },
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



// Hash password before saving
userSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});

// Prevent modifications to waiver information
userSchema.pre('save', async function(next) {
    if (!this.isNew && this.isModified('waiver')) {
        console.error('Attempt to modify waiver information detected');
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

// Additional middleware to prevent waiver updates
userSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], async function(next) {
    const update = this.getUpdate();
    if (update && (update.waiver || update['$set']?.waiver)) {
        console.error('Attempt to modify waiver information detected');
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