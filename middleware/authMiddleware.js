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

    console.log('authMiddleware: User authenticated, proceeding');
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