// utils/calculationUtils.js - Handles price calculations
const pool = require('../config/db');

// Calculate tax, weight, and delivery costs
async function calculateOrderCosts(orderId, deliveryMethod, paymentMethod, totalWeightGrams) {
    try {
        // Fetch order items for the given order ID
        const items = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);

        let totalTax = 0;
        let totalWeightCost = 0;

        // Fetch tax rate and weight cost per gram
        const { rows: taxRateRows } = await pool.query('SELECT tax_rate_percentage, weight_rate_per_gram FROM tax_rates LIMIT 1');
        const taxRate = taxRateRows[0].tax_rate_percentage / 100;
        const weightRate = taxRateRows[0].weight_rate_per_gram;

        for (const item of items.rows) {
            // Calculate tax for each product
            const tax = item.product_price_bdt * taxRate;
            totalTax += tax;

            // Calculate weight cost
            const weightCost = item.quantity * totalWeightGrams * weightRate;
            totalWeightCost += weightCost;

            // Update item with weight cost
            await pool.query(
                'UPDATE order_items SET weight_cost_bdt = $1 WHERE id = $2',
                [weightCost, item.id]
            );
        }

        // Calculate delivery cost based on method
        let deliveryCost = 0;
        if (deliveryMethod === 'Outside Dhaka') {
            deliveryCost = 150;
        } else if (deliveryMethod === 'Dhaka Delivery') {
            deliveryCost = 100;
        }

        // Calculate payment charge based on method
        let paymentCharge = 0;
        if (paymentMethod === 'bKash') {
            paymentCharge = 2; // 2% for bKash
        } else if (paymentMethod === 'Cash' && deliveryMethod === 'Outside Dhaka') {
            paymentCharge = 1; // 1% for COD
        }

        // Calculate payment charges based on total order value
        const { rows: orderRows } = await pool.query('SELECT total_price_bdt FROM orders WHERE id = $1', [orderId]);
        const orderTotal = orderRows[0].total_price_bdt;
        const paymentChargeAmount = (orderTotal + deliveryCost) * (paymentCharge / 100);

        // Update order totals
        const finalTotal = orderTotal + totalTax + totalWeightCost + deliveryCost + paymentChargeAmount;

        await pool.query(
            'UPDATE orders SET tax_amount = $1, delivery_cost_bdt = $2, cod_charge_bdt = $3, total_price_bdt = $4 WHERE id = $5',
            [totalTax, deliveryCost, paymentChargeAmount, finalTotal, orderId]
        );

        // Insert payment record
        await pool.query(
            `INSERT INTO payments (order_id, amount_bdt, payment_method, payment_charge_bdt, bkash_charge_bdt, status) 
            VALUES ($1, $2, $3, $4, $5, 'Pending')`,
            [orderId, finalTotal, paymentMethod, paymentChargeAmount, paymentMethod === 'bKash' ? paymentChargeAmount : 0]
        );

        return {
            tax: totalTax.toFixed(2),
            weightCost: totalWeightCost.toFixed(2),
            deliveryCost: deliveryCost.toFixed(2),
            paymentCharge: paymentChargeAmount.toFixed(2),
            finalTotal: finalTotal.toFixed(2)
        };

    } catch (error) {
        console.error('🔥 Error calculating order costs:', error);
        throw error;
    }
}

module.exports = { calculateOrderCosts };
