const ensureAuthenticated = (req, res, next) => {
    if (!req.session.user) {
        console.log('authMiddleware: No user in session');
        const accepts = req.get('Accept') || '';
        if (accepts.includes('text/html')) {
            console.log('authMiddleware: Redirecting to /signin');
            // Store the original URL in the query parameter
            const redirectUrl = req.originalUrl;
            return res.redirect(`/signin?redirect=${encodeURIComponent(redirectUrl)}`);
        } else {
            console.log('authMiddleware: Returning 401 Unauthorized');
            return res.status(401).json({ message: 'Unauthorized' });
        }
    }

    // Check account status
    if (req.session.user.accountStatus === 'suspended') {
        console.log(`authMiddleware: User ${req.session.user.username} account is suspended`);
        const accepts = req.get('Accept') || '';
        if (accepts.includes('text/html')) {
            return res.redirect('/account-suspended');
        } else {
            return res.status(403).json({ message: 'Account suspended. Please contact support.' });
        }
    }

    if (req.session.user.accountStatus === 'paused') {
        console.log(`authMiddleware: User ${req.session.user.username} account is paused`);
        const accepts = req.get('Accept') || '';
        if (accepts.includes('text/html')) {
            return res.redirect('/account-paused');
        } else {
            return res.status(403).json({ message: 'Account paused. Please contact support.' });
        }
    }

    if (req.session.user.accountStatus === 'pending_reinstatement') {
        console.log(`authMiddleware: User ${req.session.user.username} account reinstatement is pending`);
        const accepts = req.get('Accept') || '';
        if (accepts.includes('text/html')) {
            return res.redirect('/account-pending');
        } else {
            return res.status(403).json({ message: 'Account reinstatement pending. Please wait for admin review.' });
        }
    }

    if (req.session.user.membership === 'monthly' && !req.session.user.paidForCurrentMonth) {
        console.log(`authMiddleware: User ${req.session.user.username} has not paid for the current month`);
        const accepts = req.get('Accept') || '';
        if (accepts.includes('text/html')) {
            console.log('authMiddleware: Redirecting to /payment');
            return res.redirect('/payment');
        } else {
            console.log('authMiddleware: Returning 403 Payment Required');
            return res.status(403).json({ message: 'Payment required for the current month' });
        }
    }

    console.log('authMiddleware: User authenticated and paid, proceeding');
    next();
};

const ensureAdmin = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    if (req.session.user.accountType !== 'founder' && req.session.user.accountType !== 'moderator') {
        return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    next();
};

module.exports = {
    ensureAuthenticated,
    ensureAdmin
};