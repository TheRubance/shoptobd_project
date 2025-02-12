const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const pool = require('../config/db'); // Ensure this points to your PostgreSQL connection
const authenticateAdmin = require('../middleware/authMiddleware'); // Middleware to extract admin ID and role

const router = express.Router();
const SECRET_KEY = 'your_secret_key'; // Change this to an environment variable in production

// ✅ Admin Login Route
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Check if admin exists
        const adminQuery = 'SELECT id, name, email, password_hash, role_id FROM admin_users WHERE email = $1';
        const adminResult = await pool.query(adminQuery, [email]);

        if (adminResult.rows.length === 0) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        const admin = adminResult.rows[0];

        // Verify password
        const passwordMatch = await bcrypt.compare(password, admin.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        // Generate JWT Token
        const token = jwt.sign(
            { adminId: admin.id, role: admin.role_id },
            SECRET_KEY,
            { expiresIn: '1h' }
        );

        res.json({ message: 'Login successful', token, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role_id } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// ✅ Admin Self-Registration Route
router.post('/register', async (req, res) => {
    const { name, email, password } = req.body;

    try {
        // Check if email already exists
        const emailCheckQuery = 'SELECT id FROM admin_users WHERE email = $1';
        const emailCheckResult = await pool.query(emailCheckQuery, [email]);

        if (emailCheckResult.rows.length > 0) {
            return res.status(400).json({ message: 'Admin with this email already exists' });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Assign the default "Admin" role (role_id = 2)
        const roleIdQuery = 'SELECT id FROM admin_roles WHERE role_name = $1';
        const roleIdResult = await pool.query(roleIdQuery, ['Admin']);

        if (roleIdResult.rows.length === 0) {
            return res.status(500).json({ message: 'Admin role not found' });
        }

        const roleId = roleIdResult.rows[0].id;

        // Insert new admin into the database
        const insertAdminQuery = `
            INSERT INTO admin_users (name, email, password_hash, role_id, status)
            VALUES ($1, $2, $3, $4, 'Active') RETURNING id, name, email, role_id;
        `;
        const newAdmin = await pool.query(insertAdminQuery, [name, email, hashedPassword, roleId]);

        res.status(201).json({
            message: 'Admin registered successfully',
            admin: newAdmin.rows[0]
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// ✅ Super Admin - Create New Admin Route
router.post('/create', authenticateAdmin, async (req, res) => {
    const { name, email, password } = req.body;

    try {
        // Extract admin ID and role from JWT token
        const requestingAdminId = req.adminId;
        const requestingAdminRole = req.adminRole;

        // Ensure the requester is a Super Admin (role_id = 1)
        if (requestingAdminRole !== 1) {
            return res.status(403).json({ message: 'Access Denied. Only Super Admins can create admins.' });
        }

        // Check if email already exists
        const emailCheckQuery = 'SELECT id FROM admin_users WHERE email = $1';
        const emailCheckResult = await pool.query(emailCheckQuery, [email]);

        if (emailCheckResult.rows.length > 0) {
            return res.status(400).json({ message: 'Admin with this email already exists' });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Assign the default "Admin" role
        const roleIdQuery = 'SELECT id FROM admin_roles WHERE role_name = $1';
        const roleIdResult = await pool.query(roleIdQuery, ['Admin']);

        if (roleIdResult.rows.length === 0) {
            return res.status(500).json({ message: 'Admin role not found' });
        }

        const roleId = roleIdResult.rows[0].id;

        // Insert new admin into the database
        const insertAdminQuery = `
            INSERT INTO admin_users (name, email, password_hash, role_id, status)
            VALUES ($1, $2, $3, $4, 'Active') RETURNING id, name, email, role_id;
        `;
        const newAdmin = await pool.query(insertAdminQuery, [name, email, hashedPassword, roleId]);

        res.status(201).json({
            message: 'Admin created successfully',
            admin: newAdmin.rows[0]
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
