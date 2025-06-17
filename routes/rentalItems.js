const express = require('express');
const router = express.Router();
const RentalItem = require('../models/rentalItem');

// GET /api/rental-items - return all rental items as JSON
router.get('/', async (req, res) => {
  try {
    const items = await RentalItem.find({ isActive: true });
    res.json(items);
  } catch (err) {
    console.error('Error fetching rental items:', err);
    res.status(500).json({ error: 'Failed to fetch rental items' });
  }
});

module.exports = router; 