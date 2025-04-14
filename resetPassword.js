const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/user'); // Adjust the path if needed

// Suppress the strictQuery deprecation warning
mongoose.set('strictQuery', false);

// Connect to MongoDB Atlas
mongoose.connect('mongodb+srv://cskurski00:sLYt16mLQDFzfOty@sodacityoutdoors.zb3ov.mongodb.net/sodacity?retryWrites=true&w=majority&appName=sodacityoutdoors', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => {
    console.log('Connected to MongoDB');
    resetPassword();
}).catch(err => {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
});

async function resetPassword() {
    try {
        // Find the user
        const user = await User.findOne({ username: 'claytonskurski' });
        if (!user) {
            console.log('User not found');
            return;
        }

        // Update the password (this will trigger the pre('save') middleware)
        user.password = 'Equitymethods';
        await user.save();

        console.log('Password updated successfully for user:', user.username);
        console.log('New hashed password:', user.password);
    } catch (error) {
        console.error('Error updating password:', error);
    } finally {
        mongoose.connection.close();
    }
}