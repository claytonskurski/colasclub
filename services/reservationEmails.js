const nodemailer = require('nodemailer');

// Initialize nodemailer transporter with Hostinger SMTP
const transporter = nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 465,
    secure: true, // use SSL
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Verify transporter
transporter.verify(function (error, success) {
    if (error) {
        console.error('Error verifying email configuration:', error);
        console.error('Email config used:', {
            host: 'smtp.hostinger.com',
            port: 465,
            user: process.env.EMAIL_USER,
            auth_provided: !!process.env.EMAIL_PASS
        });
    } else {
        console.log('Reservation email server is ready');
    }
});

// Rental confirmation email template
const rentalConfirmationTemplate = (reservation) => {
    // Determine equipment details based on type
    const equipmentDetails = reservation.equipmentType.toLowerCase().includes('kayak') 
        ? '(includes paddle, lifevest, and dry bag)'
        : reservation.equipmentType.toLowerCase().includes('tube')
            ? '(includes lifevest and dry bag)'
            : '';

    // Get address from location data
    const locationAddress = reservation.location && reservation.location.address 
        ? reservation.location.address 
        : 'Address not available';

    return {
        subject: 'Soda City Outdoors - Rental Confirmation',
        html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Rental Confirmation</title>
            </head>
            <body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8f9fa;">
            <div style="background:#fff;margin:0 auto;padding:20px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <div style="text-align:center;margin-bottom:20px;">
                    <img src='https://sodacityoutdoors.com/static/images/SCO%20Logo.png' alt='Soda City Outdoors Logo' style='max-width:200px;width:100%;height:auto;display:block;margin:0 auto;'>
                </div>
                <h2 style="color:#2c3e50;margin:0 0 20px 0;">Rental Confirmation</h2>
                <p style="margin:0 0 15px 0;">Thank you for your rental with Soda City Outdoors! Our goal is to make it as easy as possible for you to get on the water this summer!</p>
                <p style="margin:0 0 20px 0;">Please find your rental details below, and make sure they are correct. We will meet you at your selected location and provide you with all the equipment you need.</p>
                <div style="background-color:#f8f9fa;padding:15px;border-radius:5px;margin:20px 0;">
                    <h3 style="color:#2c3e50;margin:0 0 15px 0;">Rental Details:</h3>
                    <ul style="list-style:none;padding:0;margin:0;">
                        <li style="margin-bottom:10px;"><strong>Location:</strong> ${reservation.locationName}</li>
                        <li style="margin:0 0 10px 20px;color:#666;">${locationAddress}</li>
                        <li style="margin-bottom:10px;"><strong>Equipment:</strong> ${reservation.equipmentType} ${equipmentDetails}</li>
                        <li style="margin-bottom:10px;"><strong>Quantity:</strong> ${reservation.quantity}</li>
                        <li style="margin-bottom:10px;"><strong>Date:</strong> ${reservation.date.toISOString().split('T')[0]}</li>
                        <li style="margin-bottom:10px;"><strong>Time:</strong> ${reservation.interval === 'half-day' 
                            ? `Half Day (${reservation.timeBlock === 'AM' ? '10AM - 2PM' : reservation.timeBlock === 'PM' ? '2PM - 6PM' : ''})` 
                            : 'Full Day (10AM - 6PM)'}</li>
                        <li style="margin-bottom:10px;"><strong>Total Amount:</strong> $${reservation.total.toFixed(2)}</li>
                        <li style="margin-bottom:10px;"><strong>Payment Status:</strong> ${reservation.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}</li>
                        <li style="margin-bottom:0;"><strong>Payment Method:</strong> ${reservation.paymentMethod === 'stripe' ? 'Credit Card' : 'Cash'}</li>
                    </ul>
                </div>
                <p style="margin:20px 0;">If you have any questions, please contact us at <a href="mailto:scoadmin@sodacityoutdoors.com" style="color:#0e747c;text-decoration:none;">scoadmin@sodacityoutdoors.com</a></p>
                <div style="margin-top:30px;padding-top:20px;border-top:1px solid #eee;">
                    <p style="color:#666;font-size:12px;margin:0;">This is an automated message, please do not reply directly to this email.</p>
                </div>
            </div>
            </body>
            </html>
        `
    };
};

// Function to send rental confirmation email
const sendRentalConfirmationEmail = async (reservation) => {
    console.log('[RESERVATION EMAIL] Entered sendRentalConfirmationEmail for reservation:', reservation._id);
    try {
        const { subject, html } = rentalConfirmationTemplate(reservation);
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: reservation.email,
            subject,
            html
        });
        console.log('[RESERVATION EMAIL] Rental confirmation email sent to:', reservation.email);
        return true;
    } catch (error) {
        console.error('[RESERVATION EMAIL] Error sending rental confirmation email:', error);
        return false;
    }
};

module.exports = {
    sendRentalConfirmationEmail
}; 