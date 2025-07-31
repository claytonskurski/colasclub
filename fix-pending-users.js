// Load environment variables
require('dotenv').config();

const mongoose = require('mongoose');
const PendingUser = require('./models/pendingUser');
const User = require('./models/user');

// Script to diagnose and fix pending user issues
const diagnosePendingUsers = async () => {
    try {
        console.log('🔍 Diagnosing pending user issues...');
        
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB connected successfully');
        
        // Get all pending users
        const pendingUsers = await PendingUser.find({});
        console.log(`\n📊 Found ${pendingUsers.length} pending users`);
        
        if (pendingUsers.length === 0) {
            console.log('No pending users found. This might be normal if all users have been processed.');
            return;
        }
        
        // Analyze each pending user
        for (const pendingUser of pendingUsers) {
            console.log(`\n--- Pending User: ${pendingUser.username} ---`);
            console.log(`ID: ${pendingUser._id}`);
            console.log(`Email: ${pendingUser.email}`);
            console.log(`Created: ${pendingUser.createdAt}`);
            console.log(`Stripe Customer ID: ${pendingUser.stripeCustomerId}`);
            console.log(`Membership: ${pendingUser.membership}`);
            
            // Check if user already exists
            const existingUser = await User.findOne({ 
                $or: [{ email: pendingUser.email }, { username: pendingUser.username }] 
            });
            
            if (existingUser) {
                console.log(`⚠️  User already exists in main database: ${existingUser.username}`);
                console.log(`   Account Status: ${existingUser.accountStatus}`);
                console.log(`   Paid for Current Month: ${existingUser.paidForCurrentMonth}`);
            } else {
                console.log(`✅ No existing user found - ready for promotion`);
            }
        }
        
        // Check for orphaned pending users (older than 24 hours)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const oldPendingUsers = await PendingUser.find({
            createdAt: { $lt: oneDayAgo }
        });
        
        if (oldPendingUsers.length > 0) {
            console.log(`\n⚠️  Found ${oldPendingUsers.length} pending users older than 24 hours:`);
            for (const oldUser of oldPendingUsers) {
                console.log(`   - ${oldUser.username} (${oldUser.email}) - Created: ${oldUser.createdAt}`);
            }
        }
        
        console.log('\n🎯 Recommendations:');
        console.log('1. If pending users are legitimate, they should be promoted to User collection');
        console.log('2. If pending users are old/corrupted, they should be deleted');
        console.log('3. Check Stripe webhook logs for any failed processing');
        
    } catch (error) {
        console.error('❌ Error diagnosing pending users:', error);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB disconnected');
    }
};

// Function to clean up old pending users
const cleanupOldPendingUsers = async () => {
    try {
        console.log('🧹 Cleaning up old pending users...');
        
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const result = await PendingUser.deleteMany({
            createdAt: { $lt: oneDayAgo }
        });
        
        console.log(`✅ Deleted ${result.deletedCount} old pending users`);
        
    } catch (error) {
        console.error('❌ Error cleaning up pending users:', error);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB disconnected');
    }
};

// Run diagnosis
diagnosePendingUsers();

// Uncomment the line below to clean up old pending users
// cleanupOldPendingUsers(); 