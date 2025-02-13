const express = require('express');
const pool = require('../config/db'); // PostgreSQL connection
const router = express.Router();

// OTP Generator
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ✅ OTP Generation Route
router.post('/generate-otp', async (req, res) => {
    const { email, phone } = req.body;

    try {
        let user;
        if (email) {
            const userQuery = 'SELECT id FROM customers WHERE email = $1';
            const result = await pool.query(userQuery, [email]);
            user = result.rows[0];
        } else if (phone) {
            const userQuery = 'SELECT id FROM customers WHERE phone_primary = $1';
            const result = await pool.query(userQuery, [phone]);
            user = result.rows[0];
        } else {
            return res.status(400).json({ message: 'Email or phone is required' });
        }

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const otp = generateOTP();
        const expiry = new Date();
        expiry.setMinutes(expiry.getMinutes() + 5); // OTP valid for 5 minutes

        const updateQuery = `
            UPDATE user_auth 
            SET otp_code = $1, otp_expiry = $2 
            WHERE customer_id = $3
        `;
        await pool.query(updateQuery, [otp, expiry, user.id]);

        // Simulate sending OTP (In production, integrate with an SMS/email service)
        console.log(`OTP for ${email || phone}: ${otp}`);

        res.json({ message: 'OTP sent successfully' });
    } catch (error) {
        console.error('Error generating OTP:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
