const express = require('express');
const pool = require('../config/db'); // Database connection
const router = express.Router();

// ✅ 1. Submit Refund Request
router.post('/request', async (req, res) => {
    const client = await pool.connect();
    try {
        const { invoice_id, customer_id, refund_type, refund_amount_bdt, refund_method, refund_reason } = req.body;

        if (!invoice_id || !customer_id || !refund_type || !refund_amount_bdt || !refund_reason) {
            return res.status(400).json({ message: 'All refund fields are required' });
        }

        await client.query('BEGIN');

        // ✅ Insert refund request into refunds table
        const refundResult = await client.query(`
            INSERT INTO refunds (invoice_id, customer_id, refund_type, refund_amount_bdt, refund_method, refund_status, refund_reason, created_at)
            VALUES ($1, $2, $3, $4, $5, 'Pending', $6, CURRENT_TIMESTAMP) RETURNING id;
        `, [invoice_id, customer_id, refund_type, refund_amount_bdt, refund_method, refund_reason]);

        const refund_id = refundResult.rows[0].id;

        // ✅ Log refund processing status
        await client.query(`
            INSERT INTO refund_processing (refund_id, status, reason, created_at)
            VALUES ($1, 'Pending', $2, CURRENT_TIMESTAMP);
        `, [refund_id, refund_reason]);

        await client.query('COMMIT');

        res.status(200).json({ message: 'Refund request submitted successfully', refund_id });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('🔥 Refund Request Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

// ✅ 2. Process Refund Request (Super Admin Only)
router.post('/process', async (req, res) => {
    const client = await pool.connect();

    try {
        const { refund_id, status, admin_id, transaction_reference, apply_as_credit } = req.body;

        if (!refund_id || !status || !admin_id) {
            return res.status(400).json({ message: 'Refund ID, status, and admin ID are required' });
        }

        // ✅ Check if Admin is a Super Admin
        const adminCheck = await client.query(`
            SELECT role_id FROM admin_users WHERE id = $1;
        `, [admin_id]);

        if (adminCheck.rows.length === 0 || adminCheck.rows[0].role_id !== 1) {
            return res.status(403).json({ message: 'Only Super Admins can approve refunds' });
        }

        await client.query('BEGIN');

        // ✅ Update Refund Processing Table
        await client.query(`
            UPDATE refund_processing
            SET status = $1, approved_by = $2, approval_date = CURRENT_TIMESTAMP, transaction_reference = $3
            WHERE refund_id = $4;
        `, [status, admin_id, transaction_reference || null, refund_id]);

        // ✅ Apply Refund as Credit or Direct Deduction
        if (status === 'Completed' || status === 'Approved') {
            await client.query(`
                UPDATE refunds
                SET refund_status = $1, processed_by_admin = $2, refund_date = CURRENT_DATE, refund_applied_as_credit = $3
                WHERE id = $4;
            `, [status, admin_id, apply_as_credit, refund_id]);

            if (!apply_as_credit) {
                await client.query(`
                    UPDATE invoices
                    SET due_amount_bdt = GREATEST(0, total_invoice_bdt - amount_paid_bdt 
                                                  - COALESCE(credit_applied_bdt, 0) 
                                                  - COALESCE((SELECT SUM(refund_amount_bdt) FROM refunds 
                                                              WHERE refunds.invoice_id = invoices.id 
                                                              AND refunds.refund_status IN ('Processed', 'Completed') 
                                                              AND refunds.refund_applied_as_credit = FALSE), 0))
                    WHERE refund_id = $1;
                `, [refund_id]);
            }
        }

        await client.query('COMMIT');

        res.status(200).json({ message: `Refund ${status} successfully`, refund_id });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('🔥 Refund Processing Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

// ✅ 3. Get Refund Details
router.get('/:refund_id', async (req, res) => {
    const { refund_id } = req.params;
    const client = await pool.connect();

    try {
        const refundDetails = await client.query(`
            SELECT r.*, rp.status AS processing_status, rp.approved_by, rp.approval_date, rp.transaction_reference 
            FROM refunds r
            LEFT JOIN refund_processing rp ON r.id = rp.refund_id
            WHERE r.id = $1;
        `, [refund_id]);

        if (refundDetails.rows.length === 0) {
            return res.status(404).json({ message: 'Refund not found' });
        }

        res.status(200).json(refundDetails.rows[0]);

    } catch (error) {
        console.error('🔥 Refund Fetch Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

// ✅ 4. List All Refunds (Admin Panel View)
router.get('/', async (req, res) => {
    const client = await pool.connect();

    try {
        const allRefunds = await client.query(`
            SELECT r.id, r.invoice_id, r.customer_id, r.refund_type, r.refund_amount_bdt, r.refund_status, 
                   r.refund_method, r.refund_reason, r.created_at, r.refund_applied_as_credit, rp.status AS processing_status, rp.approved_by 
            FROM refunds r
            LEFT JOIN refund_processing rp ON r.id = rp.refund_id
            ORDER BY r.created_at DESC;
        `);

        res.status(200).json(allRefunds.rows);

    } catch (error) {
        console.error('🔥 Refund List Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
