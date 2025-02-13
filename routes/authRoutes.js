const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../config/db'); // PostgreSQL connection
const router = express.Router();

// User Registration Route
router.post('/register', async (req, res) => {
    const { name, email, phone, password, auth_type } = req.body;

    try {
        const userCheckQuery = 'SELECT id FROM customers WHERE email = $1 OR phone_primary = $2';
        const userCheckResult = await pool.query(userCheckQuery, [email, phone]);

        if (userCheckResult.rows.length > 0) {
            return res.status(400).json({ message: 'User already exists with this email or phone' });
        }

        const hashedPassword = auth_type === 'Email' ? await bcrypt.hash(password, 10) : null;

        const insertCustomerQuery = `
            INSERT INTO customers (name, email, phone_primary, status)
            VALUES ($1, $2, $3, 'active') RETURNING id;
        `;
        const customerResult = await pool.query(insertCustomerQuery, [name, email, phone]);
        const customerId = customerResult.rows[0].id;

        const insertAuthQuery = `
            INSERT INTO user_auth (customer_id, auth_type, auth_data, password_hash, email_verified)
            VALUES ($1, $2, $3, $4, $5) RETURNING id;
        `;
        await pool.query(insertAuthQuery, [
            customerId,
            auth_type,
            email || phone,
            hashedPassword,
            auth_type === 'Email' ? true : false // Email is verified automatically upon registration
        ]);

        res.status(201).json({
            message: 'User registered successfully',
            user: { id: customerId, name, email, phone, auth_type }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// OTP Generation for Phone Login
router.post('/otp/generate', async (req, res) => {
    const { phone } = req.body;

    try {
        const userQuery = 'SELECT id FROM customers WHERE phone_primary = $1';
        const userResult = await pool.query(userQuery, [phone]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found with this phone number' });
        }

        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // OTP valid for 15 minutes

        await pool.query(
            'UPDATE user_auth SET otp_code = $1, otp_expiry = $2 WHERE auth_data = $3 AND auth_type = $4',
            [otpCode, otpExpiry, phone, 'Phone']
        );

        // For now, log OTP to console (In future, send OTP via SMS API)
        console.log(`Generated OTP for ${phone}: ${otpCode}`);

        res.status(200).json({ message: 'OTP generated successfully', otpCode }); 
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Phone Login with OTP
router.post('/otp/verify', async (req, res) => {
    const { phone, otp } = req.body;

    try {
        const userAuthQuery = `
            SELECT * FROM user_auth 
            WHERE auth_data = $1 AND auth_type = 'Phone'
        `;
        const authResult = await pool.query(userAuthQuery, [phone]);

        if (authResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const userAuth = authResult.rows[0];

        if (userAuth.otp_code !== otp) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }
        if (new Date() > new Date(userAuth.otp_expiry)) {
            return res.status(400).json({ message: 'OTP has expired' });
        }        

        await pool.query(
            'UPDATE user_auth SET otp_verified = $1 WHERE id = $2',
            [true, userAuth.id]
        );

        res.status(200).json({ message: 'OTP verified successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Email Login with Password
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const userAuthQuery = `
            SELECT * FROM user_auth 
            WHERE auth_data = $1 AND auth_type = 'Email'
        `;
        const authResult = await pool.query(userAuthQuery, [email]);

        if (authResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const userAuth = authResult.rows[0];
        const passwordMatch = await bcrypt.compare(password, userAuth.password_hash);

        if (!passwordMatch) {
            return res.status(401).json({ message: 'Invalid password' });
        }

        res.status(200).json({ message: 'Login successful', userId: userAuth.customer_id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
