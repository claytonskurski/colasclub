const express = require('express');
const router = express.Router();
const RentalLocation = require('../models/rentalLocation');

// GET /api/rental-locations - return all rental locations as JSON
router.get('/', async (req, res) => {
  try {
    const locations = await RentalLocation.find({});
    res.json(locations);
  } catch (err) {
    console.error('Error fetching rental locations:', err);
    res.status(500).json({ error: 'Failed to fetch rental locations' });
  }
});

module.exports = router; 