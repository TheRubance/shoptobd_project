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

        // 🛒 Validate Input
        if (!customer_id || !items || items.length === 0) {
            return res.status(400).json({ message: 'Customer ID and at least one product are required' });
        }

        // 🧮 Fetch Exchange Rate & Tax Rate
        const rateResult = await pool.query('SELECT usd_to_bdt_rate, tax_rate FROM tax_rates LIMIT 1');
        if (rateResult.rows.length === 0) {
            return res.status(500).json({ message: 'Exchange rate and tax rate not found' });
        }
        const { usd_to_bdt_rate, tax_rate } = rateResult.rows[0];

        // 🎯 Calculate Product Prices
        let total_usd = 0;
        let total_bdt = 0;
        const orderItems = [];

        for (const product of items) {
            const { product_link, product_name, quantity, size, color, product_price_usd } = product;

            if (!product_link || !quantity || !product_price_usd) {
                return res.status(400).json({ message: 'Product details incomplete' });
            }

            const price_usd = product_price_usd * quantity;
            const price_bdt = Math.ceil(price_usd * usd_to_bdt_rate); // Rounded up as per rule
            total_usd += price_usd;
            total_bdt += price_bdt;

            orderItems.push({
                product_link, product_name, quantity, size, color,
                product_price_usd: product_price_usd.toFixed(2),
                product_price_bdt: Math.ceil(product_price_usd * usd_to_bdt_rate),
                total_price_usd: price_usd.toFixed(2),
                total_price_bdt: price_bdt
            });
        }

        // 📝 Calculate Tax
        const tax_usd = total_usd * (tax_rate / 100);
        const tax_bdt = Math.ceil(tax_usd * usd_to_bdt_rate);

        const final_usd = total_usd + tax_usd;
        const final_bdt = total_bdt + tax_bdt;

        // 🛒 Generate Unique Order Number
        const order_number = await generateOrderNumber();

        // 🛒 Insert Order
        await client.query('BEGIN');

        const orderInsertQuery = `
            INSERT INTO orders (order_number, customer_id, product_count, total_price_usd, total_price_bdt, tax_amount, status, payment_status)
            VALUES ($1, $2, $3, $4, $5, $6, 'Pending', 'Pending') RETURNING id;
        `;
        const orderResult = await client.query(orderInsertQuery, [
            order_number, customer_id, items.length, total_usd, total_bdt, tax_bdt
        ]);

        const order_id = orderResult.rows[0].id;

        // 🛒 Insert Products into `order_items`
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
                total_usd: final_usd.toFixed(2),
                total_bdt: final_bdt,
                tax_usd: tax_usd.toFixed(2),
                tax_bdt: tax_bdt
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

// ✅ Finalize Order - Auto Apply Delivery & Payment Charges
router.post('/finalize', async (req, res) => {
    const client = await pool.connect();

    try {
        const { order_id, delivery_method, payment_method } = req.body;

        // 🛒 Validate Input
        if (!order_id || !delivery_method || !payment_method) {
            return res.status(400).json({ message: 'Order ID, delivery method, and payment method are required' });
        }

        // 📦 Define Delivery Charges
        let delivery_cost = 0;
        if (delivery_method === 'Dhaka Delivery') {
            delivery_cost = 60;
        } else if (delivery_method === 'Outside Dhaka') {
            delivery_cost = 130;
        }

        // 🧮 Fetch Order Totals
        const orderQuery = await pool.query(`SELECT total_price_bdt FROM orders WHERE id = $1`, [order_id]);
        if (orderQuery.rows.length === 0) {
            return res.status(404).json({ message: 'Order not found' });
        }

        let order_total_bdt = parseFloat(orderQuery.rows[0].total_price_bdt);
        let cod_charge = 0;
        let bkash_charge = 0;

        // 🔄 Apply Payment Charges
        if (payment_method === 'bKash') {
            bkash_charge = Math.ceil(order_total_bdt * 0.02); // 2% bKash charge
        } else if (payment_method === 'Cash on Delivery' && delivery_method === 'Outside Dhaka') {
            cod_charge = Math.ceil(order_total_bdt * 0.01); // 1% COD charge
        }

        // 🏷 Update Order Totals
        const final_total_bdt = order_total_bdt + delivery_cost + cod_charge;
        
        await client.query('BEGIN');

        await client.query(`
            UPDATE orders
            SET delivery_cost_bdt = $1, cod_charge_bdt = $2, total_price_bdt = $3
            WHERE id = $4
        `, [delivery_cost, cod_charge, final_total_bdt, order_id]);

        // 💳 Insert Final Payment
        await client.query(`
            INSERT INTO payments (order_id, amount_bdt, payment_method, status, payment_charge_bdt, bkash_charge_bdt, payment_date)
            VALUES ($1, $2, $3, 'Pending', $4, $5, CURRENT_TIMESTAMP)
        `, [order_id, final_total_bdt, payment_method, cod_charge, bkash_charge]);

        await client.query('COMMIT');

        res.status(200).json({
            message: 'Order finalized successfully',
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
