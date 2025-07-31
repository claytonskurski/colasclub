const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { ensureAuthenticated, ensureAdmin } = require('../middleware/authMiddleware');

// Get all users with payment issues
router.get('/payment-issues', ensureAuthenticated, ensureAdmin, async (req, res) => {
    try {
        const users = await User.find({
            $or: [
                { accountStatus: { $in: ['paused', 'suspended', 'pending_reinstatement'] } },
                { 'lastPaymentFailure.attempts': { $gte: 1 } }
            ]
        }).select('-password');
        
        res.json(users);
    } catch (error) {
        console.error('Error fetching users with payment issues:', error);
        res.status(500).json({ message: 'Error fetching users' });
    }
});

// Get user details with payment history
router.get('/user/:userId', ensureAuthenticated, ensureAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        res.json(user);
    } catch (error) {
        console.error('Error fetching user details:', error);
        res.status(500).json({ message: 'Error fetching user details' });
    }
});

// Pause user account
router.post('/user/:userId/pause', ensureAuthenticated, ensureAdmin, async (req, res) => {
    try {
        const { reason, adminNotes } = req.body;
        const user = await User.findById(req.params.userId);
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        await user.pauseAccount(reason, adminNotes);
        res.json({ message: 'Account paused successfully', user });
    } catch (error) {
        console.error('Error pausing account:', error);
        res.status(500).json({ message: 'Error pausing account' });
    }
});

// Suspend user account
router.post('/user/:userId/suspend', ensureAuthenticated, ensureAdmin, async (req, res) => {
    try {
        const { reason, adminNotes } = req.body;
        const user = await User.findById(req.params.userId);
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        await user.suspendAccount(reason, adminNotes);
        res.json({ message: 'Account suspended successfully', user });
    } catch (error) {
        console.error('Error suspending account:', error);
        res.status(500).json({ message: 'Error suspending account' });
    }
});

// Reinstate user account
router.post('/user/:userId/reinstate', ensureAuthenticated, ensureAdmin, async (req, res) => {
    try {
        const { adminNotes } = req.body;
        const user = await User.findById(req.params.userId);
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        await user.reinstateAccount(adminNotes);
        res.json({ message: 'Account reinstated successfully', user });
    } catch (error) {
        console.error('Error reinstating account:', error);
        res.status(500).json({ message: 'Error reinstating account' });
    }
});

// Update admin notes
router.post('/user/:userId/notes', ensureAuthenticated, ensureAdmin, async (req, res) => {
    try {
        const { adminNotes } = req.body;
        const user = await User.findById(req.params.userId);
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        user.adminNotes = adminNotes;
        await user.save();
        
        res.json({ message: 'Admin notes updated successfully', user });
    } catch (error) {
        console.error('Error updating admin notes:', error);
        res.status(500).json({ message: 'Error updating admin notes' });
    }
});

// Get payment failure statistics
router.get('/payment-stats', ensureAuthenticated, ensureAdmin, async (req, res) => {
    try {
        const stats = await User.aggregate([
            {
                $group: {
                    _id: '$accountStatus',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        const failureStats = await User.aggregate([
            {
                $match: {
                    'lastPaymentFailure.attempts': { $gte: 1 }
                }
            },
            {
                $group: {
                    _id: '$lastPaymentFailure.reason',
                    count: { $sum: 1 },
                    avgAttempts: { $avg: '$lastPaymentFailure.attempts' }
                }
            }
        ]);
        
        res.json({
            accountStatuses: stats,
            failureReasons: failureStats
        });
    } catch (error) {
        console.error('Error fetching payment stats:', error);
        res.status(500).json({ message: 'Error fetching payment statistics' });
    }
});

module.exports = router; 