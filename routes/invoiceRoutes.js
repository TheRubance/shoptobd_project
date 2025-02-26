const express = require('express');
const pool = require('../config/db'); // Database connection
const router = express.Router();

// ✅ Allow Admins to Update Invoice Fields
router.post('/update', async (req, res) => {
    const client = await pool.connect();
    try {
        const { invoice_id, updates } = req.body;

        if (!invoice_id || !updates || typeof updates !== 'object') {
            return res.status(400).json({ message: 'Invoice ID and updates are required' });
        }

        await client.query('BEGIN');

        // ✅ If weight_category is updated, recalculate weight_charge_bdt
        if (updates.weight_category) {
            const weightChargeResult = await client.query(
                `SELECT charge_per_gram FROM weight_charge_categories WHERE category_name = $1`,
                [updates.weight_category]
            );

            if (weightChargeResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'Invalid weight category' });
            }

            const weightChargePerGram = weightChargeResult.rows[0].charge_per_gram;

            // ✅ Fetch the total weight of the invoice
            const invoiceResult = await client.query(
                `SELECT total_weight_grams FROM invoices WHERE id = $1`,
                [invoice_id]
            );

            if (invoiceResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'Invoice not found' });
            }

            const totalWeightGrams = invoiceResult.rows[0].total_weight_grams;

            // ✅ Recalculate weight charge
            updates.weight_charge_bdt = weightChargePerGram * totalWeightGrams;
        }

        let updateQuery = 'UPDATE invoices SET ';
        const updateParams = [];
        let paramIndex = 1;

        for (const [column, value] of Object.entries(updates)) {
            updateQuery += `${column} = $${paramIndex}, `;
            updateParams.push(value);
            paramIndex++;
        }
        updateQuery = updateQuery.slice(0, -2) + ` WHERE id = $${paramIndex} RETURNING *`;
        updateParams.push(invoice_id);

        const result = await client.query(updateQuery, updateParams);

        await client.query('COMMIT');
        
        res.status(200).json({ message: 'Invoice updated successfully', invoice: result.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('🔥 Invoice Update Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

// ✅ Admin Approves Initial or Final Invoice
router.post('/approve', async (req, res) => {
    const client = await pool.connect();
    try {
        const { invoice_id, admin_id } = req.body;

        if (!invoice_id || !admin_id) {
            return res.status(400).json({ message: 'Invoice ID and Admin ID are required' });
        }

        await client.query('BEGIN');

        const invoiceCheck = await client.query(
            `SELECT invoice_type FROM invoices WHERE id = $1;`,
            [invoice_id]
        );

        if (invoiceCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const invoiceType = invoiceCheck.rows[0].invoice_type;

        await client.query(
            `UPDATE invoices 
            SET invoice_status = 'Approved', is_finalized = TRUE, updated_at = NOW() 
            WHERE id = $1;`,
            [invoice_id]
        );

        await client.query('COMMIT');

        res.status(200).json({ message: `Invoice (${invoiceType}) approved successfully` });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('🔥 Invoice Approval Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

// ✅ Fetch Invoice Details
router.get('/:invoice_id', async (req, res) => {
    const { invoice_id } = req.params;
    const client = await pool.connect();

    try {
        const invoice = await client.query(
            `SELECT * FROM invoices WHERE id = $1;`,
            [invoice_id]
        );

        if (invoice.rows.length === 0) {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        res.status(200).json(invoice.rows[0]);

    } catch (error) {
        console.error('🔥 Fetch Invoice Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

// ✅ Fetch All Invoices (Admin Panel)
router.get('/', async (req, res) => {
    const client = await pool.connect();

    try {
        const invoices = await client.query(
            `SELECT * FROM invoices ORDER BY created_at DESC;`
        );

        res.status(200).json(invoices.rows);

    } catch (error) {
        console.error('🔥 Fetch Invoices Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
