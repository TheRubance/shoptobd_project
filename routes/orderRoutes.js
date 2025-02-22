const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// ✅ Generate Unique Order Number
const generateOrderNumber = async () => {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const result = await pool.query("SELECT COUNT(*) FROM orders");
    const count = parseInt(result.rows[0].count) + 1;
    return `ORD-${datePart}-${count.toString().padStart(4, '0')}`;
};

// ✅ Create New Order
router.post('/create', async (req, res) => {
    const client = await pool.connect();

    try {
        const { customer_id, items } = req.body;

        if (!customer_id || !items || items.length === 0) {
            return res.status(400).json({ message: 'Customer ID and at least one product are required' });
        }

        const rateResult = await pool.query('SELECT usd_to_bdt_rate, tax_rate FROM tax_rates LIMIT 1');
        if (rateResult.rows.length === 0) {
            return res.status(500).json({ message: 'Exchange rate and tax rate not found' });
        }
        const { usd_to_bdt_rate, tax_rate } = rateResult.rows[0];

        let total_usd = 0;
        let total_bdt = 0;
        const orderItems = [];

        for (const product of items) {
            const { product_link, product_name, quantity, size, color, product_price_usd, shipping_cost_usd = 0.00 } = product;

            if (!product_link || !quantity || !product_price_usd) {
                return res.status(400).json({ message: 'Product details incomplete' });
            }

            const subtotal_usd = (product_price_usd + shipping_cost_usd) * quantity;
            const tax_usd = subtotal_usd * (tax_rate / 100);
            const total_price_usd = subtotal_usd + tax_usd;

            const total_price_bdt = Math.ceil(total_price_usd * usd_to_bdt_rate);
            const product_price_bdt = Math.ceil(product_price_usd * usd_to_bdt_rate);

            total_usd += total_price_usd;
            total_bdt += total_price_bdt;

            orderItems.push({
                product_link, product_name, quantity, size, color,
                product_price_usd: product_price_usd.toFixed(2),
                product_price_bdt,
                total_price_usd: total_price_usd.toFixed(2),
                total_price_bdt
            });
        }

        const order_number = await generateOrderNumber();

        await client.query('BEGIN');

        const orderInsertQuery = `
            INSERT INTO orders (order_number, customer_id, product_count, total_price_usd, total_price_bdt, tax_amount, status, payment_status)
            VALUES ($1, $2, $3, $4, $5, $6, 'Pending', 'Pending') RETURNING id;
        `;
        const orderResult = await client.query(orderInsertQuery, [
            order_number, customer_id, items.length, total_usd, total_bdt, Math.ceil(total_usd * (tax_rate / 100) * usd_to_bdt_rate)
        ]);

        const order_id = orderResult.rows[0].id;

        const itemInsertQuery = `
            INSERT INTO order_items (order_id, product_link, product_name, quantity, size, color, product_price_usd, product_price_bdt, total_price_usd, total_price_bdt)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
        `;
        for (const item of orderItems) {
            const {
                product_link, product_name, quantity, size, color,
                product_price_usd, product_price_bdt, total_price_usd, total_price_bdt
            } = item;

            await client.query(itemInsertQuery, [
                order_id, product_link, product_name, quantity, size, color,
                product_price_usd, product_price_bdt, total_price_usd, total_price_bdt
            ]);
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Order created successfully',
            order_id,
            order_number,
            products: orderItems,
            totals: {
                total_usd: total_usd.toFixed(2),
                total_bdt,
                tax_usd: (total_usd - (total_usd / (1 + tax_rate / 100))).toFixed(2),
                tax_bdt: Math.ceil(total_usd * (tax_rate / 100) * usd_to_bdt_rate)
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('🔥 Order Creation Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

// ✅ Finalize Order & Update Sales Reports
router.post('/finalize', async (req, res) => {
    const client = await pool.connect();

    try {
        const { order_id, delivery_method, payment_method } = req.body;

        if (!order_id || !delivery_method || !payment_method) {
            return res.status(400).json({ message: 'Order ID, delivery method, and payment method are required' });
        }

        let delivery_cost = delivery_method === 'Dhaka Delivery' ? 60 : 130;

        const orderQuery = await pool.query(`SELECT total_price_bdt FROM orders WHERE id = $1`, [order_id]);
        if (orderQuery.rows.length === 0) {
            return res.status(404).json({ message: 'Order not found' });
        }

        let order_total_bdt = parseFloat(orderQuery.rows[0].total_price_bdt);
        let cod_charge = 0;
        let bkash_charge = 0;

        if (payment_method === 'bKash') {
            bkash_charge = Math.ceil(order_total_bdt * 0.02);
        } else if (payment_method === 'Cash on Delivery' && delivery_method === 'Outside Dhaka') {
            cod_charge = Math.ceil(order_total_bdt * 0.01);
        }

        const final_total_bdt = order_total_bdt + delivery_cost + cod_charge;

        await client.query('BEGIN');

        await client.query(`
            UPDATE orders
            SET delivery_cost_bdt = $1, cod_charge_bdt = $2, total_price_bdt = $3
            WHERE id = $4
        `, [delivery_cost, cod_charge, final_total_bdt, order_id]);

        const reportDate = new Date().toISOString().split("T")[0];

        const existingReport = await client.query(`SELECT * FROM sales_reports WHERE report_date = $1 AND report_type = 'Daily'`, [reportDate]);

        if (existingReport.rows.length === 0) {
            await client.query(`
                INSERT INTO sales_reports (report_type, report_date, total_sales_bdt, total_orders, total_refunds_bdt, total_profit_bdt, payment_method_breakdown)
                VALUES ('Daily', $1, $2, 1, 0, $3, $4);
            `, [reportDate, final_total_bdt, final_total_bdt, JSON.stringify({ [payment_method]: final_total_bdt })]);
        } else {
            await client.query(`
                UPDATE sales_reports
                SET total_sales_bdt = total_sales_bdt + $1,
                    total_orders = total_orders + 1,
                    total_profit_bdt = total_profit_bdt + $1,
                    payment_method_breakdown = payment_method_breakdown::jsonb || jsonb_build_object($2::TEXT, (COALESCE(payment_method_breakdown->$2, '0')::INTEGER + $1)::TEXT)
                WHERE report_date = $3 AND report_type = 'Daily';
            `, [final_total_bdt, payment_method, reportDate]);
        }

        await client.query('COMMIT');

        res.status(200).json({
            message: 'Order finalized successfully & sales reports updated',
            order_id,
            updated_totals: {
                total_bdt: final_total_bdt,
                delivery_cost,
                cod_charge,
                bkash_charge,
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('🔥 Order Finalization Error:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
