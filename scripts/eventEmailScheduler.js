const mongoose = require('mongoose');
const { runEmailChecks, forceSendWeeklySummaries } = require('../services/eventEmails');

// MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sodacityoutdoors';

// Connect to MongoDB
const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB connected successfully');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

// Disconnect from MongoDB
const disconnectDB = async () => {
    try {
        await mongoose.disconnect();
        console.log('MongoDB disconnected successfully');
    } catch (error) {
        console.error('MongoDB disconnection error:', error);
    }
};

// Handle graceful shutdown
const gracefulShutdown = async (signal) => {
    console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
    
    // Stop the scheduler
    if (global.schedulerInterval) {
        clearInterval(global.schedulerInterval);
        console.log('Scheduler stopped');
    }
    
    // Disconnect from database
    await disconnectDB();
    
    console.log('Graceful shutdown completed');
    process.exit(0);
};

// Main scheduler function
const startScheduler = async () => {
    try {
        console.log('Starting Event Email Scheduler...');
        
        // Connect to database
        await connectDB();
        
        // Run initial check
        console.log('Running initial email check...');
        await runEmailChecks();
        
        // Set up interval to run every hour (3600000 ms)
        const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
        
        global.schedulerInterval = setInterval(async () => {
            try {
                console.log(`[${new Date().toISOString()}] Running scheduled email check...`);
                await runEmailChecks();
            } catch (error) {
                console.error('Error in scheduled email check:', error);
            }
        }, CHECK_INTERVAL);
        
        console.log(`Scheduler started. Running checks every ${CHECK_INTERVAL / 1000 / 60} minutes.`);
        console.log('Press Ctrl+C to stop the scheduler.');
        
    } catch (error) {
        console.error('Error starting scheduler:', error);
        await disconnectDB();
        process.exit(1);
    }
};

// Handle process signals for graceful shutdown
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
});

// Start the scheduler if this file is run directly
if (require.main === module) {
    if (process.argv.includes('--manual')) {
        (async () => {
            await connectDB();
            await forceSendWeeklySummaries();
            await disconnectDB();
            process.exit(0);
        })();
    } else {
        startScheduler();
    }
}

module.exports = {
    startScheduler,
    connectDB,
    disconnectDB
}; 