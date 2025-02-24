const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// ✅ Create New Refund Request
router.post('/request', async (req, res) => {
    const client = await pool.connect();
    try {
        const { invoice_id, customer_id, refund_type, refund_amount_bdt, refund_method, refund_reason, admin_id } = req.body;

        if (!invoice_id || !customer_id || !refund_type || !refund_amount_bdt || !refund_reason) {
            return res.status(400).json({ message: 'All required fields must be provided' });
        }

        await client.query('BEGIN');

        const refundResult = await client.query(`
            INSERT INTO refunds (invoice_id, customer_id, refund_type, refund_amount_bdt, refund_method, refund_status, refund_reason, processed_by_admin)
            VALUES ($1, $2, $3, $4, $5, 'Pending', $6, $7) RETURNING id;
        `, [invoice_id, customer_id, refund_type, refund_amount_bdt, refund_method || null, refund_reason, admin_id || null]);

        const refund_id = refundResult.rows[0].id;

        await client.query(`
            INSERT INTO refund_processing (refund_id, status, reason)
            VALUES ($1, 'Pending', $2);
        `, [refund_id, refund_reason]);

        await client.query('COMMIT');

        res.status(201).json({ message: 'Refund request submitted successfully', refund_id });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('🔥 Refund Request Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

// ✅ Process Refund Request (Admin Only) + Update Sales Report on Completion
router.post('/process', async (req, res) => {
    const client = await pool.connect();
    try {
        const { refund_id, status, admin_id, transaction_reference } = req.body;

        if (!refund_id || !status || !admin_id) {
            return res.status(400).json({ message: 'Refund ID, status, and admin ID are required' });
        }

        const validStatuses = ['Approved', 'Rejected', 'Completed'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: 'Invalid refund status' });
        }

        await client.query('BEGIN');

        await client.query(`
            UPDATE refund_processing
            SET status = $1, approved_by = $2, approval_date = CURRENT_TIMESTAMP, transaction_reference = $3
            WHERE refund_id = $4;
        `, [status, admin_id, transaction_reference || null, refund_id]);

        if (status === 'Completed') {
            await client.query(`
                UPDATE refunds
                SET refund_status = 'Completed', processed_by_admin = $1, refund_date = CURRENT_DATE
                WHERE id = $2;
            `, [admin_id, refund_id]);

            // 🟢✅ NEW: Update Sales Reports to reflect refund
            const refundData = await client.query(`SELECT refund_amount_bdt, refund_method FROM refunds WHERE id = $1`, [refund_id]);
            const { refund_amount_bdt, refund_method } = refundData.rows[0];

            const reportDate = new Date().toISOString().split("T")[0];

            const existingReport = await client.query(`
                SELECT * FROM sales_reports WHERE report_date = $1 AND report_type = 'Daily'
            `, [reportDate]);

            if (existingReport.rows.length === 0) {
                await client.query(`
                    INSERT INTO sales_reports (report_type, report_date, total_sales_bdt, total_orders, total_refunds_bdt, total_profit_bdt, payment_method_breakdown)
                    VALUES ('Daily', $1, 0, 0, $2, -$2, $3);
                `, [reportDate, refund_amount_bdt, JSON.stringify({ [refund_method]: -refund_amount_bdt })]);
            } else {
                await client.query(`
                    UPDATE sales_reports
                    SET total_sales_bdt = total_sales_bdt - $1,
                        total_refunds_bdt = total_refunds_bdt + $1,
                        total_profit_bdt = total_profit_bdt - $1,
                        payment_method_breakdown = payment_method_breakdown::jsonb || jsonb_build_object($2, (COALESCE(payment_method_breakdown->>$2, '0')::INTEGER - $1)::TEXT)
                    WHERE report_date = $3 AND report_type = 'Daily';
                `, [refund_amount_bdt, refund_method, reportDate]);
            }
            // 🟢✅ END OF NEW CODE
        } else {
            await client.query(`
                UPDATE refunds
                SET refund_status = $1, processed_by_admin = $2
                WHERE id = $3;
            `, [status, admin_id, refund_id]);
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

// ✅ Get Refund Details
router.get('/:refund_id', async (req, res) => {
    const { refund_id } = req.params;

    try {
        const refundQuery = await pool.query(`
            SELECT * FROM refunds WHERE id = $1;
        `, [refund_id]);

        if (refundQuery.rows.length === 0) {
            return res.status(404).json({ message: 'Refund not found' });
        }

        res.status(200).json(refundQuery.rows[0]);

    } catch (error) {
        console.error('🔥 Refund Fetch Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// ✅ Get All Refunds (Admin Only)
router.get('/', async (req, res) => {
    try {
        const refundQuery = await pool.query('SELECT * FROM refunds ORDER BY created_at DESC;');
        res.status(200).json(refundQuery.rows);
    } catch (error) {
        console.error('🔥 Refund List Fetch Error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
