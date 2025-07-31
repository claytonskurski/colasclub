// Load environment variables
require('dotenv').config();

const mongoose = require('mongoose');
const User = require('./models/user');
const { generateTrialExpirationTomorrowHTML, generateTrialWarningHTML, getEventsUntilTrialEnd } = require('./services/trialExpirationEmails');
const { handleAccountPause } = require('./services/accountPauseEmail');

// Test function to send updated emails
const sendUpdatedTestEmails = async () => {
    try {
        console.log('🚀 Starting updated email tests...');
        
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
        
        // Test 1: Send 7-day trial warning
        console.log('\n📧 Test 1: Sending 7-day trial warning...');
        const events = await getEventsUntilTrialEnd(user.trialEnd);
        const trial7DayHtml = generateTrialWarningHTML(user, events, user.trialEnd);
        
        const trial7DayMailOptions = {
            from: process.env.EMAIL_USER || 'scoadmin@sodacityoutdoors.com',
            to: user.email,
            subject: `⚠️ Trial Expires in 7 Days - Check Out These Events! (TEST)`,
            html: trial7DayHtml
        };
        
        await transporter.sendMail(trial7DayMailOptions);
        console.log('✅ 7-day trial warning sent');
        
        // Test 2: Send updated 1-day trial warning
        console.log('\n📧 Test 2: Sending updated 1-day trial warning...');
        const trialHtml = generateTrialExpirationTomorrowHTML(user, user.trialEnd);
        
        const trialMailOptions = {
            from: process.env.EMAIL_USER || 'scoadmin@sodacityoutdoors.com',
            to: user.email,
            subject: `📅 Trial Expires Tomorrow - Friendly Reminder (UPDATED)`,
            html: trialHtml
        };
        
        await transporter.sendMail(trialMailOptions);
        console.log('✅ Updated 1-day trial warning sent');
        
        // Test 3: Send updated account pause notification
        console.log('\n📧 Test 3: Sending updated account pause notification...');
        await handleAccountPause(user, 'payment failure');
        console.log('✅ Updated account pause notification sent');
        
        console.log('\n🎉 All updated test emails sent successfully!');
        
    } catch (error) {
        console.error('❌ Error sending updated test emails:', error);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB disconnected');
    }
};

// Run the test
sendUpdatedTestEmails(); 