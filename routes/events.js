// Route for suggesting new events
router.post('/suggest', isAuthenticated, async (req, res) => {
    try {
        const {
            summary,
            description,
            dtstart,
            dtend,
            location,
            tags
        } = req.body;

        const newEvent = new Event({
            eventId: `suggested-${Date.now()}`,
            summary,
            description,
            dtstart,
            dtend,
            location,
            tags: tags.split(',').map(tag => tag.trim()),
            status: 'pending',
            suggestedBy: req.user._id
        });

        await newEvent.save();
        
        // Send email notification to admin
        const adminEmail = process.env.ADMIN_EMAIL;
        if (adminEmail) {
            await sendEmail({
                to: adminEmail,
                subject: 'New Event Suggestion',
                text: `A new event "${summary}" has been suggested by ${req.user.email}. Please review it in the admin dashboard.`
            });
        }

        res.json({ 
            success: true, 
            message: 'Event suggestion submitted successfully' 
        });
    } catch (error) {
        console.error('Error suggesting event:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error submitting event suggestion' 
        });
    }
});

// Route for getting events by tag
router.get('/bytag/:tag', async (req, res) => {
    try {
        const events = await Event.find({
            tags: req.params.tag,
            status: 'approved'
        }).sort({ dtstart: 1 });
        
        res.json(events);
    } catch (error) {
        console.error('Error fetching events by tag:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching events' 
        });
    }
}); 