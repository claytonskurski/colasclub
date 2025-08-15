const express = require('express');
const router = express.Router();
const EventRequest = require('../models/eventRequest');
const nodemailer = require('nodemailer');

// Configure nodemailer for Hostinger
const transporter = nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true, // use SSL/TLS
    auth: {
        user: process.env.EMAIL_USER || 'admin@colasclub.com',
        pass: process.env.EMAIL_PASS
    }
});

// GET route to display the submit event form
router.get('/', (req, res) => {
    res.render('submit_event');
});

// POST route to handle event submission
router.post('/', async (req, res) => {
    try {
        // Validate required fields
        const requiredFields = ['summary', 'description', 'location', 'date', 'time', 'duration', 'difficulty', 'maxParticipants'];
        for (const field of requiredFields) {
            if (!req.body[field]) {
                throw new Error(`${field} is required`);
            }
        }

        // Combine date and time into a single Date object for startDate
        const dateStr = req.body.date;
        const timeStr = req.body.time;
        const startDate = new Date(`${dateStr}T${timeStr}`);

        if (isNaN(startDate.getTime())) {
            throw new Error('Invalid date or time format');
        }

        // Create new event request
        const eventRequest = new EventRequest({
            summary: req.body.summary,
            description: req.body.description,
            location: req.body.location,
            startDate: startDate,
            duration: parseFloat(req.body.duration),
            difficulty: req.body.difficulty,
            maxParticipants: parseInt(req.body.maxParticipants),
            tags: req.body.tags ? req.body.tags.split(',').map(tag => tag.trim()) : [],
            status: 'pending',
            requestedBy: req.user ? req.user._id : null
        });

        await eventRequest.save();

        // Check if email configuration is available
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.warn('Email configuration not found - skipping email notification');
            return res.status(200).json({ success: true });
        }

        // Send email notification
        const mailOptions = {
            from: process.env.EMAIL_USER || 'admin@colasclub.com',
            to: 'admin@colasclub.com',
            subject: 'New Event Request Submitted',
            text: `A new event request has been submitted:
                Title: ${eventRequest.summary}
                Description: ${eventRequest.description}
                Location: ${eventRequest.location}
                Date: ${startDate.toLocaleDateString()}
                Time: ${startDate.toLocaleTimeString()}
                Duration: ${eventRequest.duration} hours
                Difficulty: ${eventRequest.difficulty}
                Max Participants: ${eventRequest.maxParticipants}`
        };

        try {
            await transporter.sendMail(mailOptions);
        } catch (emailError) {
            console.error('Error sending email notification:', emailError);
            // Don't fail the request if email fails
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error submitting event:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'There was an error submitting your event. Please try again.' 
        });
    }
});

// GET route for success page
router.get('/success', (req, res) => {
    res.render('submit_success', { title: 'Submission Successful' });
});

module.exports = router; 