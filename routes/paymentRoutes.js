const express = require('express');
const pool = require('../config/db'); // Database connection
const router = express.Router();

// ✅ Add a new payment
router.post('/add', async (req, res) => {
    const client = await pool.connect();
    try {
        const { invoice_id, payment_method, amount_bdt, transaction_reference, is_partial } = req.body;

        if (!invoice_id || !payment_method || !amount_bdt) {
            return res.status(400).json({ message: 'Invoice ID, payment method, and amount are required' });
        }

        // Ensure valid payment method
        if (!['bKash', 'Bank Transfer', 'Card', 'Cash'].includes(payment_method)) {
            return res.status(400).json({ message: 'Invalid payment method' });
        }

        let payment_charge = 0;

        // ✅ Apply processing fees based on the payment method
        if (payment_method === 'bKash') {
            payment_charge = amount_bdt * 0.02; // 2% charge
        } else if (payment_method === 'Card') {
            payment_charge = amount_bdt * 0.025; // 2.5% charge
        }

        await client.query('BEGIN');

        // ✅ Insert the payment record
        const result = await client.query(
            `INSERT INTO payments (invoice_id, payment_method, amount_bdt, payment_charge_bdt, transaction_reference, is_partial)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [invoice_id, payment_method, amount_bdt, payment_charge, transaction_reference || null, is_partial || false]
        );

        await client.query('COMMIT');
        res.status(201).json({ message: 'Payment added successfully', payment: result.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('🔥 Payment Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

// ✅ Confirm or Reject Payment (Admin Only)
router.post('/confirm', async (req, res) => {
    const client = await pool.connect();
    try {
        const { payment_id, admin_id, action } = req.body;

        if (!payment_id || !admin_id || !['Confirmed', 'Rejected'].includes(action)) {
            return res.status(400).json({ message: 'Invalid request data' });
        }

        await client.query('BEGIN');

        // ✅ Get payment details
        const paymentResult = await client.query(`SELECT * FROM payments WHERE id = $1`, [payment_id]);

        if (paymentResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Payment not found' });
        }

        const payment = paymentResult.rows[0];

        // ✅ Update payment status
        await client.query(
            `UPDATE payments SET status = $1, confirmed_by_admin_id = $2 WHERE id = $3`,
            [action, admin_id, payment_id]
        );

        // ✅ If payment is confirmed, update invoice `amount_paid_bdt` and `due_amount_bdt`
        if (action === 'Confirmed' && payment.invoice_id) {
            await client.query(
                `UPDATE invoices 
                 SET amount_paid_bdt = COALESCE(amount_paid_bdt, 0) + $1,
                     due_amount_bdt = GREATEST(0, total_invoice_bdt - 
                                              (SELECT SUM(amount_bdt) FROM payments 
                                               WHERE invoice_id = $2 AND status = 'Confirmed') 
                                              - COALESCE(credit_applied_bdt, 0))
                 WHERE id = $2`,
                [payment.amount_bdt, payment.invoice_id]
            );
        }

        await client.query('COMMIT');
        res.status(200).json({ message: `Payment ${action} successfully` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('🔥 Payment Approval Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

// ✅ Fetch all payments
router.get('/', async (req, res) => {
    const client = await pool.connect();
    try {
        const payments = await client.query(`SELECT * FROM payments ORDER BY created_at DESC`);
        res.status(200).json(payments.rows);
    } catch (error) {
        console.error('🔥 Fetch Payments Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
