const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_API_KEY);
const RentalItem = require('../models/rentalItem');
const Reservation = require('../models/reservation');
const RentalLocation = require('../models/rentalLocation');
const { sendEmail } = require('../services/notifications');
const { format, utcToZonedTime } = require('date-fns-tz');
const { sendRentalConfirmationEmails, sendRentalNotification } = require('../services/notifications');

console.log('rentalRoutes loaded');

// Create a new booking
router.post('/create-booking', async (req, res) => {
    try {
        const {
            location,
            itemId,
            date,
            interval,
            quantity,
            name,
            email,
            phone,
            paymentMethod,
            stripePriceId
        } = req.body;

        // Validate required fields
        if (!location || !itemId || !date || !interval || !quantity || !name || !email || !phone) {
            return res.status(400).json({ message: 'All fields are required' });
        }

        // Get rental item details
        const rentalItem = await RentalItem.findById(itemId);
        if (!rentalItem) {
            return res.status(404).json({ message: 'Rental item not found' });
        }

        // Check availability
        const existingReservations = await Reservation.find({
            rentalItem: itemId,
            location,
            date,
            interval,
            status: { $in: ['confirmed', 'pending'] }
        });

        const totalReserved = existingReservations.reduce((sum, res) => sum + res.quantity, 0);
        if (totalReserved + parseInt(quantity) > rentalItem.quantity) {
            return res.status(400).json({ message: 'Not enough items available for the selected date and interval' });
        }

        // Calculate total price
        const price = interval === 'half-day' ? rentalItem.halfDayPrice : rentalItem.fullDayPrice;
        const total = price * quantity;

        // Create reservation
        const reservation = new Reservation({
            location,
            rentalItem: itemId,
            date,
            interval,
            quantity,
            name,
            email,
            phone,
            total,
            status: 'pending',
            paymentMethod
        });

        await reservation.save();

        // Handle payment
        if (paymentMethod === 'card') {
            if (!stripePriceId) {
                return res.status(400).json({ message: 'Stripe price ID is required for card payments' });
            }
            // Create Stripe Checkout Session
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [
                    {
                        price: stripePriceId,
                        quantity: quantity,
                    },
                ],
                mode: 'payment',
                success_url: `${process.env.SITE_URL}/booking-confirmation/${reservation._id}`,
                cancel_url: `${process.env.SITE_URL}/rentals`,
                metadata: {
                    reservationId: reservation._id.toString()
                }
            });

            // Update reservation with payment info
            reservation.stripeSessionId = session.id;
            reservation.status = 'pending';
            await reservation.save();

            return res.json({
                bookingId: reservation._id,
                sessionId: session.id,
                checkoutUrl: session.url
            });
        } else {
            // For cash payments, just return the booking ID
            return res.json({
                bookingId: reservation._id
            });
        }
    } catch (error) {
        console.error('Error creating booking:', error);
        res.status(500).json({ message: 'Error creating booking', error: error.message });
    }
});

// Get booking confirmation
router.get('/booking-confirmation/:bookingId', async (req, res) => {
    try {
        const reservation = await Reservation.findById(req.params.bookingId)
            .populate('rentalItem')
            .populate('location');

        if (!reservation) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        const formattedDate = reservation.date.toISOString().split('T')[0];
        res.render('booking_confirmation', {
            reservation,
            user: req.session.user,
            formattedDate
        });
    } catch (error) {
        console.error('Error getting booking confirmation:', error);
        res.status(500).json({ message: 'Error getting booking confirmation' });
    }
});

// Render equipment selection form for a location
router.get('/book/:locationId', async (req, res) => {
    const location = await RentalLocation.findById(req.params.locationId);
    if (!location) {
        return res.status(404).render('error', { title: 'Error', message: 'Location not found' });
    }
    const rentalItems = await RentalItem.find({ isActive: true });
    res.render('booking_info', {
        location,
        rentalItems,
        locationName: location.name
    });
});

// Render calendar page for a location and equipment (RESTORED)
router.post('/calendar/:locationId', async (req, res) => {
    const location = await RentalLocation.findById(req.params.locationId);
    if (!location) {
        return res.status(404).render('error', { title: 'Error', message: 'Location not found.' });
    }
    const { equipment, quantity, interval, timeBlock, name, email, phone, paymentMethod } = req.body;
    const rentalItem = await RentalItem.findById(equipment);
    if (!rentalItem) {
        return res.status(404).render('error', { title: 'Error', message: 'Equipment not found.' });
    }
    
    // Create bookingInfo object for the calendar template
    const bookingInfo = {
        location: location._id,
        equipment: rentalItem._id,
        quantity,
        interval,
        timeBlock,
        name,
        email,
        phone,
        paymentMethod,
        locationName: location.name,
        equipmentType: rentalItem.type
    };

    res.render('booking_calendar', {
        title: 'Select Date',
        location,
        rentalItem,
        quantity,
        interval,
        timeBlock,
        name,
        email,
        phone,
        paymentMethod,
        bookingInfo,
        locationName: location.name,
        equipmentType: rentalItem.type
    });
});

// API endpoint to get unavailable dates for a given location, equipment, quantity, and interval
router.get('/unavailable-dates', async (req, res) => {
    try {
        // --- Original logic commented out for step-by-step debugging ---
        /*
        const { equipment, quantity } = req.query;
        if (!equipment || !quantity) {
            return res.status(400).json({ error: 'Equipment and quantity are required' });
        }
        // 1. Get the rental item to check its maximum quantity
        const rentalItem = await RentalItem.findById(equipment);
        if (!rentalItem) {
            return res.status(404).json({ error: 'Rental item not found' });
        }
        const maxInventory = rentalItem.quantity;
        console.log('equipment:', equipment, 'quantity:', quantity);
        console.log('maxInventory:', maxInventory);
        // 2. Find all reservations for this rental item
        const reservations = await Reservation.find({
            rentalItem: equipment,
            status: { $in: ['confirmed', 'pending'] }
        });
        console.log('reservations:', reservations.map(r => ({ date: r.date, quantity: r.quantity })));
        // 3. Group reservations by date and sum quantities
        const dateQuantities = {};
        reservations.forEach(res => {
            const dateStr = res.date.toISOString().split('T')[0];
            dateQuantities[dateStr] = (dateQuantities[dateStr] || 0) + res.quantity;
        });
        // 4. Find dates where maxInventory - reserved < requested quantity
        const unavailableDates = Object.entries(dateQuantities)
            .filter(([_, reserved]) => maxInventory - reserved < parseInt(quantity))
            .map(([date]) => date);
        console.log('Unavailable dates for calendar:', unavailableDates);
        res.json(unavailableDates);
        */
        // --- Step 3: Quantity-based blocking per equipment _id ---
        /**
         * Logic:
         * 1. Get the max inventory for the equipment (from RentalItem.quantity)
         * 2. Find all reservations for this equipment
         * 3. Group reservations by date and sum reserved quantities
         * 4. For each date, if (maxInventory - reserved) < requestedQuantity, block that date
         */
        const { equipment, quantity } = req.query;
        if (!equipment || !quantity) {
            return res.status(400).json({ error: 'Equipment and quantity are required' });
        }
        const rentalItem = await RentalItem.findById(equipment);
        if (!rentalItem) {
            return res.status(404).json({ error: 'Rental item not found' });
        }
        const rentalItemObj = rentalItem._doc ? rentalItem._doc : rentalItem;
        console.log('rentalItemObj:', rentalItemObj);
        const maxInventory = parseInt(rentalItemObj.quantity, 10);
        console.log('maxInventory:', maxInventory, 'for equipment:', equipment);

        if (isNaN(maxInventory)) {
            console.error('Invalid maxInventory for equipment:', equipment, 'rentalItem:', rentalItem);
            return res.status(500).json({ error: 'Invalid inventory configuration for this equipment.' });
        }
        const reservations = await Reservation.find({ rentalItem: equipment, status: { $in: ['confirmed', 'pending'] } });
        // Group reservations by date and sum quantities
        const dateQuantities = {};
        reservations.forEach(res => {
            const dateStr = res.date.toISOString().split('T')[0];
            dateQuantities[dateStr] = (dateQuantities[dateStr] || 0) + res.quantity;
        });
        // Find dates where maxInventory - reserved < requested quantity
        const unavailableDates = Object.entries(dateQuantities)
            .filter(([date, reserved]) => {
                const available = maxInventory - reserved;
                const block = available < parseInt(quantity);
                console.log(`Date: ${date}, Reserved: ${reserved}, Available: ${available}, Requested: ${quantity}, Block: ${block}`);
                return block;
            })
            .map(([date]) => date);
        console.log('Step 3 unavailable dates for equipment', equipment, ':', unavailableDates);
        res.json(unavailableDates);
    } catch (err) {
        console.error('Error fetching unavailable dates:', err);
        res.status(500).json([]);
    }
});

// Render the main rentals page
router.get('/', (req, res) => {
  res.render('rentals', { title: 'Rentals', user: req.session.user });
});

// Render waiver page using reservationId
router.get('/waiver/:reservationId', async (req, res) => {
    try {
        const reservation = await Reservation.findById(req.params.reservationId).populate('rentalItem').populate('location');
        if (!reservation) {
            return res.status(404).render('error', { title: 'Error', message: 'Reservation not found' });
        }
        res.render('rental_waiver', {
            reservation,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error loading waiver:', error);
        return res.status(500).render('error', { title: 'Error', message: 'Error loading waiver' });
    }
});

// Process waiver acceptance and redirect to payment or confirmation
router.post('/process-waiver', async (req, res) => {
    try {
        const { reservationId } = req.body;
        if (!reservationId) {
            return res.status(400).render('error', { title: 'Error', message: 'Missing reservationId.' });
        }
        const reservation = await Reservation.findById(reservationId);
        if (!reservation) {
            return res.status(404).render('error', { title: 'Error', message: 'Reservation not found' });
        }
        // Mark waiver as accepted (add a field if needed)
        reservation.waiverAccepted = true;
        await reservation.save();
        // Redirect based on payment method
        if (reservation.paymentMethod === 'stripe') {
            return res.redirect(`/rentals/create-checkout-session?reservationId=${reservation._id}`);
        } else if (reservation.paymentMethod === 'cash') {
            reservation.status = 'confirmed';
            reservation.paymentStatus = 'unpaid';
            await reservation.save();
            return res.redirect(`/rentals/booking-confirmation/${reservation._id}`);
        } else {
            return res.status(400).render('error', { title: 'Error', message: 'Invalid payment method.' });
        }
    } catch (error) {
        console.error('Error processing waiver:', error);
        return res.status(500).render('error', { title: 'Error', message: 'Error processing waiver' });
    }
});

// Render payment page
router.get('/payment/:reservationId', async (req, res) => {
    try {
        const reservation = await Reservation.findById(req.params.reservationId)
            .populate('rentalItem')
            .populate('location');

        if (!reservation) {
            return res.status(404).render('error', { message: 'Reservation not found' });
        }

        // Calculate total price
        const basePrice = reservation.interval === 'half-day' ? reservation.rentalItem.priceHalfDay || reservation.rentalItem.halfDayPrice : reservation.rentalItem.priceFullDay || reservation.rentalItem.fullDayPrice;
        const total = basePrice * parseInt(reservation.quantity);
        // Construct a reservation-like object for the template
        const reservationObj = {
            rentalItem: reservation.rentalItem,
            location: reservation.location,
            quantity: reservation.quantity,
            interval: reservation.interval,
            name: reservation.name,
            email: reservation.email,
            phone: reservation.phone,
            paymentMethod: reservation.paymentMethod,
            date: reservation.date,
            total
        };
        res.render('rental_payment', { reservation: reservationObj });
    } catch (error) {
        console.error('Error loading payment page:', error);
        res.status(500).render('error', { message: 'Error loading payment page' });
    }
});

// Create Stripe Checkout session for rental
router.get('/create-checkout-session', async (req, res) => {
    try {
        const { reservationId } = req.query;
        if (!reservationId) {
            return res.status(400).render('error', { title: 'Error', message: 'Reservation ID is required' });
        }

        const reservation = await Reservation.findById(reservationId).populate('rentalItem');
        if (!reservation) {
            return res.status(404).render('error', { title: 'Error', message: 'Reservation not found' });
        }

        // Get the correct Stripe price ID based on interval
        let stripePriceId;
        if (reservation.interval === 'half-day') {
            stripePriceId = reservation.rentalItem.stripePriceIdHalfDay;
        } else {
            stripePriceId = reservation.rentalItem.stripePriceIdFullDay;
        }
        if (!stripePriceId) {
            return res.status(400).render('error', { title: 'Error', message: 'Stripe price ID not found for this rental item and interval.' });
        }

        // Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price: stripePriceId,
                    quantity: reservation.quantity,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.SITE_URL}/rentals/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.SITE_URL}/rentals/payment-cancelled`,
            metadata: {
                reservationId: reservation._id.toString()
            }
        });

        // Redirect user to Stripe Checkout
        return res.redirect(303, session.url);
    } catch (error) {
        console.error('Error creating checkout session:', error);
        return res.status(500).render('error', { title: 'Error', message: 'Error creating checkout session' });
    }
});

// Process cash payment
router.post('/process-payment', async (req, res) => {
    const { reservationId, amount, paymentMethod } = req.body;
    // Dummy product logic: if the rental item is the dummy test item, use the test Stripe price ID
    // (Remove this block after setup)
    if (paymentMethod === 'cash') {
        // For cash, create the reservation immediately and mark as unpaid
        // ... create reservation logic ...
        return res.redirect(`/rentals/booking-confirmation/${reservation._id}`);
    } else {
        // For card, create Stripe Checkout session, and only create reservation after payment success
        // ... Stripe logic ...
        // On webhook/payment success, create reservation and redirect to confirmation
    }
});

// Handle payment success
router.get('/payment-success', async (req, res) => {
    try {
        const { session_id } = req.query;
        if (!session_id) {
            return res.status(400).render('error', { title: 'Error', message: 'No session ID provided' });
        }

        const session = await stripe.checkout.sessions.retrieve(session_id);
        // Try to get reservationId from metadata (old flow)
        let reservationId = session.metadata && session.metadata.reservationId;
        let reservation;
        if (reservationId) {
            reservation = await Reservation.findById(reservationId);
        }
        // If reservation does not exist, create it from metadata (new flow)
        if (!reservation) {
            // Get all booking data from session.metadata
            const { location, equipment, quantity, interval, name, email, phone, date, locationName, equipmentType } = session.metadata;
            // Fetch rental item and location
            const rentalItem = await RentalItem.findById(equipment);
            const locationObj = await RentalLocation.findById(location);
            // Calculate total price
            const basePrice = interval === 'half-day' ? rentalItem.priceHalfDay || rentalItem.halfDayPrice : rentalItem.priceFullDay || rentalItem.fullDayPrice;
            const total = basePrice * parseInt(quantity);
            reservation = new Reservation({
                location,
                rentalItem: equipment,
                date: new Date(date),
                interval,
                quantity: parseInt(quantity),
                name,
                email,
                phone,
                total,
                paymentStatus: 'paid',
                paymentMethod: 'stripe',
                status: 'confirmed',
                locationName: locationName || (locationObj && locationObj.name),
                equipmentType: equipmentType || (rentalItem && rentalItem.type)
            });
            await reservation.save();
        }
        // Populate the references
        await reservation.populate([
            { path: 'rentalItem' },
            { path: 'location' }
        ]);

        // Send admin notification
        try {
            await sendRentalNotification(reservation);
            console.log('Rental admin notification sent successfully');
        } catch (emailError) {
            console.error('Error sending rental admin notification:', emailError);
        }

        // Redirect to booking confirmation
        return res.redirect(`/rentals/booking-confirmation/${reservation._id}`);
    } catch (error) {
        console.error('Error processing payment success:', error);
        res.status(500).render('error', { title: 'Error', message: 'Error processing payment' });
    }
});

// Render booking confirmation page for a reservation (for all flows)
router.get('/booking-confirmation/:reservationId', async (req, res) => {
    try {
        const reservation = await Reservation.findById(req.params.reservationId)
            .populate('rentalItem')
            .populate('location');

        if (!reservation) {
            return res.status(404).render('error', { title: 'Error', message: 'Reservation not found' });
        }

        // Send confirmation email
        try {
            await sendEmail(reservation.email, 'rentalConfirmation', reservation);
            console.log('Rental confirmation email sent successfully');
        } catch (emailError) {
            console.error('Error sending rental confirmation email:', emailError);
            // Don't return error to user, just log it
        }

        const formattedDate = reservation.date.toISOString().split('T')[0];
        res.render('booking_confirmation', {
            reservation,
            user: req.session.user,
            formattedDate
        });
    } catch (error) {
        console.error('Error loading booking confirmation:', error);
        return res.status(500).render('error', { title: 'Error', message: 'Error loading booking confirmation' });
    }
});

// Create a new reservation as soon as booking info and date are submitted
router.post('/create-reservation', async (req, res) => {
    try {
        const {
            location,
            equipment,
            quantity,
            interval,
            name,
            email,
            phone,
            paymentMethod,
            date,
            locationName,
            equipmentType
        } = req.body;

        // Validate required fields
        if (!location || !equipment || !quantity || !interval || !name || !email || !phone || !paymentMethod || !date) {
            return res.json({ success: false, message: 'All fields are required' });
        }

        // Get rental item details
        const rentalItem = await RentalItem.findById(equipment);
        if (!rentalItem) {
            return res.json({ success: false, message: 'Rental item not found' });
        }

        // Get location details
        const locationObj = await RentalLocation.findById(location);
        if (!locationObj) {
            return res.json({ success: false, message: 'Location not found' });
        }

        // Calculate total price
        const basePrice = interval === 'half-day' ? rentalItem.priceHalfDay : rentalItem.priceFullDay;
        const total = basePrice * parseInt(quantity);

        // Map card to stripe for DB
        const normalizedPaymentMethod = paymentMethod === 'card' ? 'stripe' : paymentMethod;

        // Create reservation
        const reservation = new Reservation({
            location,
            rentalItem: equipment,
            date: new Date(date),
            interval,
            quantity: parseInt(quantity),
            name,
            email,
            phone,
            total,
            paymentStatus: 'unpaid',
            paymentMethod: normalizedPaymentMethod,
            status: 'in-progress',
            locationName: locationName || locationObj.name,
            equipmentType: equipmentType || rentalItem.type
        });
        await reservation.save();
        // Respond with reservationId
        return res.json({ success: true, reservationId: reservation._id });
    } catch (error) {
        console.error('Error creating reservation:', error);
        return res.json({ success: false, message: 'Error creating reservation' });
    }
});

// Update reservation date after calendar selection
router.post('/update-reservation-date', async (req, res) => {
    try {
        const { reservationId, date } = req.body;
        if (!reservationId || !date) {
            return res.json({ success: false, message: 'Missing reservationId or date.' });
        }
        const reservation = await Reservation.findById(reservationId);
        if (!reservation) {
            return res.json({ success: false, message: 'Reservation not found.' });
        }
        reservation.date = new Date(date);
        await reservation.save();
        return res.json({ success: true });
    } catch (error) {
        console.error('Error updating reservation date:', error);
        return res.json({ success: false, message: 'Error updating reservation.' });
    }
});

// NEW: Render booking review page after calendar selection
router.post('/review', async (req, res) => {
    const { location, equipment, quantity, interval, name, email, phone, paymentMethod, date, locationName, equipmentType, timeBlock } = req.body;
    const locationObj = await RentalLocation.findById(location);
    const rentalItem = await RentalItem.findById(equipment);
    res.render('booking_review', {
        location: locationObj,
        rentalItem,
        quantity,
        interval,
        name,
        email,
        phone,
        paymentMethod,
        date,
        timeBlock,
        locationName: locationName || (locationObj && locationObj.name),
        equipmentType: equipmentType || (rentalItem && rentalItem.type)
    });
});

// NEW: Render waiver page after review
router.post('/waiver', async (req, res) => {
    try {
        const { location } = req.body;
        const locationObj = await RentalLocation.findById(location);
        if (!locationObj) {
            return res.status(404).render('error', { title: 'Error', message: 'Location not found' });
        }
        res.render('rental_waiver', { ...req.body, location: locationObj });
    } catch (error) {
        console.error('Error in waiver route:', error);
        res.status(500).render('error', { title: 'Error', message: 'Error loading waiver page' });
    }
});

// NEW: Render payment page after waiver (if card)
router.post('/payment', async (req, res) => {
    try {
        const { location, equipment, quantity, interval, name, email, phone, paymentMethod, date, timeBlock } = req.body;
        
        const rentalItem = await RentalItem.findById(equipment);
        const locationObj = await RentalLocation.findById(location);
        
        if (!rentalItem || !locationObj) {
            return res.status(404).render('error', { title: 'Error', message: 'Rental item or location not found' });
        }

        const basePrice = interval === 'half-day' ? rentalItem.priceHalfDay || rentalItem.halfDayPrice : rentalItem.priceFullDay || rentalItem.fullDayPrice;
        const total = basePrice * parseInt(quantity);

        if (paymentMethod === 'card' || paymentMethod === 'stripe') {
            let stripePriceId;
            if (interval === 'half-day') {
                stripePriceId = rentalItem.stripePriceIdHalfDay;
            } else {
                stripePriceId = rentalItem.stripePriceIdFullDay;
            }
            if (!stripePriceId) {
                return res.status(400).render('error', { title: 'Error', message: 'Stripe price ID not found for this rental item and interval.' });
            }
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [
                    {
                        price: stripePriceId,
                        quantity: parseInt(quantity),
                    },
                ],
                mode: 'payment',
                success_url: `${process.env.SITE_URL}/rentals/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_URL}/rentals`,
                metadata: {
                    location,
                    equipment,
                    quantity,
                    interval,
                    name,
                    email,
                    phone,
                    date,
                    locationName: locationObj.name,
                    equipmentType: rentalItem.type,
                    timeBlock
                }
            });
            return res.redirect(303, session.url);
        } else if (paymentMethod === 'cash') {
            // For cash payments, redirect directly to confirmation
            return res.redirect('/rentals/confirm');
        }

        res.render('rental_payment', {
            reservation: {
                rentalItem,
                location: locationObj,
                quantity,
                interval,
                name,
                email,
                phone,
                paymentMethod,
                date: new Date(date),
                total,
                locationName: locationObj.name,
                equipmentType: rentalItem.type,
                timeBlock
            }
        });
    } catch (error) {
        console.error('Error in payment route:', error);
        res.status(500).render('error', { title: 'Error', message: 'Error processing payment' });
    }
});

// NEW: Final confirmation and reservation creation
router.post('/confirm', async (req, res) => {
    try {
        // All booking data is in req.body
        const { location, equipment, quantity, interval, name, email, phone, paymentMethod, date, timeBlock } = req.body;
        const rentalItem = await RentalItem.findById(equipment);
        const locationObj = await RentalLocation.findById(location);
        
        if (!rentalItem || !locationObj) {
            return res.status(404).render('error', { title: 'Error', message: 'Rental item or location not found' });
        }

        // Check availability one final time
        const existingReservations = await Reservation.find({
            rentalItem: equipment,
            date: new Date(date),
            status: { $in: ['confirmed', 'pending'] }
        });

        const totalReserved = existingReservations.reduce((sum, res) => sum + res.quantity, 0);
        if (totalReserved + parseInt(quantity) > rentalItem.quantityAvailable) {
            return res.status(400).render('error', { 
                title: 'Error', 
                message: 'Sorry, this equipment is no longer available for the selected date. Please try another date or equipment type.' 
            });
        }

        const basePrice = interval === 'half-day' ? rentalItem.priceHalfDay : rentalItem.priceFullDay;
        const total = basePrice * parseInt(quantity);

        // Create reservation
        const reservation = new Reservation({
            location,
            rentalItem: equipment,
            date: new Date(date),
            interval,
            quantity: parseInt(quantity),
            name,
            email,
            phone,
            total,
            paymentStatus: paymentMethod === 'cash' ? 'unpaid' : 'paid',
            paymentMethod,
            status: 'confirmed',
            locationName: locationObj.name,
            equipmentType: rentalItem.type,
            timeBlock
        });

        await reservation.save();
        
        // Populate the references
        await reservation.populate([
            { path: 'rentalItem' },
            { path: 'location' }
        ]);

        // Send confirmation email
        try {
            await sendEmail(reservation.email, 'rentalConfirmation', reservation);
            console.log('Rental confirmation email sent successfully to:', reservation.email);
        } catch (emailError) {
            console.error('Error sending rental confirmation email:', emailError);
        }

        // Send admin notification
        try {
            await sendRentalNotification(reservation);
            console.log('Rental admin notification sent successfully');
        } catch (emailError) {
            console.error('Error sending rental admin notification:', emailError);
        }

        const formattedDate = reservation.date.toISOString().split('T')[0];
        res.render('booking_confirmation', {
            reservation,
            user: req.session.user,
            formattedDate
        });
    } catch (error) {
        console.error('Error confirming reservation:', error);
        res.status(500).render('error', { title: 'Error', message: 'Error confirming reservation' });
    }
});

// Catch-all for debugging
router.use((req, res, next) => {
    console.log('rentalRoutes catch-all:', req.originalUrl);
    next();
});

module.exports = router; 