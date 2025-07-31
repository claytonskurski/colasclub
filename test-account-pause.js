// Load environment variables
require('dotenv').config();

const mongoose = require('mongoose');
const User = require('./models/user');
const { handleAccountPause } = require('./services/accountPauseEmail');

// Test function to send updated account pause email
const sendAccountPauseTest = async () => {
    try {
        console.log('🚀 Testing updated account pause email...');
        
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
        
        // Send updated account pause notification
        console.log('\n📧 Sending updated account pause notification...');
        await handleAccountPause(user, 'payment failure');
        console.log('✅ Updated account pause notification sent');
        
        console.log('\n🎉 Account pause email test completed!');
        
    } catch (error) {
        console.error('❌ Error sending account pause test:', error);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB disconnected');
    }
};

// Run the test
sendAccountPauseTest(); 