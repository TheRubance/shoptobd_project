const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../config/db'); // Database connection

const router = express.Router();
const SECRET_KEY = 'your_secret_key'; // Use environment variables in production

// ✅ Google Login Route
router.post('/login', async (req, res) => {
    const { googleId, name, email } = req.body;  // Simulating Google login payload

    console.log('Google Login Route Hit');
    console.log('Request Data:', { googleId, name, email });

    try {
        console.log('Checking database connection...');

        // Check if the user already exists
        let user = await pool.query('SELECT id, name, email FROM customers WHERE email = $1', [email]);
        console.log('User Query Result:', user.rows);

        if (user.rows.length === 0) {
            console.log('User not found, creating new user...');
            const newUser = await pool.query(
                `INSERT INTO customers (name, email, phone_primary, status) 
                 VALUES ($1, $2, NULL, 'active') RETURNING id, name, email`,
                [name, email]
            );
            console.log('New User Created:', newUser.rows[0]);

            user = newUser;
            await pool.query(
                `INSERT INTO user_auth (customer_id, auth_type, auth_data, email_verified) 
                 VALUES ($1, 'Google', $2, true)`,
                [newUser.rows[0].id, googleId]
            );
            console.log('New User Auth Record Created');
        } else {
            console.log('User already exists');
        }

        // Generate JWT Token
        const token = jwt.sign({ userId: user.rows[0].id, authType: 'Google' }, SECRET_KEY, { expiresIn: '1h' });

        console.log('JWT Token Generated:', token);
        res.json({ message: 'Google login successful', token, user: user.rows[0] });
    } catch (error) {
        console.error('🔥 Error in Google Auth:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
