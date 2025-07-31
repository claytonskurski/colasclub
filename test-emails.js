// Load environment variables
require('dotenv').config();

const mongoose = require('mongoose');
const User = require('./models/user');
const { sendTrialExpirationTomorrowWarnings, generateTrialExpirationTomorrowHTML } = require('./services/trialExpirationWarnings');
const { handleAccountPause } = require('./services/accountPauseEmail');

// Test function to send emails
const sendTestEmails = async () => {
    try {
        console.log('🚀 Starting email tests...');
        
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB connected successfully');
        
        // Get paveldatsyuk user
        const user = await User.findOne({ username: 'paveldatsyuk' });
        if (!user) {
            console.error('User paveldatsyuk not found');
            return;
        }
        
        console.log(`Found user: ${user.firstName} ${user.lastName} (${user.email})`);
        
        // Test 1: Send 1-day trial warning
        console.log('\n📧 Test 1: Sending 1-day trial warning...');
        const trialHtml = generateTrialExpirationTomorrowHTML(user, user.trialEnd);
        
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: 'smtp.hostinger.com',
            port: 465,
            secure: true,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
        
        const trialMailOptions = {
            from: process.env.EMAIL_USER || 'scoadmin@sodacityoutdoors.com',
            to: user.email,
            subject: `⚠️ Trial Expires Tomorrow - Action Required (TEST)`,
            html: trialHtml
        };
        
        await transporter.sendMail(trialMailOptions);
        console.log('✅ 1-day trial warning sent');
        
        // Test 2: Send account pause notification
        console.log('\n📧 Test 2: Sending account pause notification...');
        await handleAccountPause(user, 'stolen card');
        console.log('✅ Account pause notification sent');
        
        console.log('\n🎉 All test emails sent successfully!');
        
    } catch (error) {
        console.error('❌ Error sending test emails:', error);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB disconnected');
    }
};

// Run the test
sendTestEmails(); 