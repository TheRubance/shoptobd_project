require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./config/db"); // Shared database connection

// ✅ Import Routes
const adminRoutes = require("./routes/adminRoutes"); 
const authRoutes = require('./routes/authRoutes');  
const googleAuthRoutes = require('./routes/googleAuthRoutes');  // ✅ Google Auth
const facebookAuthRoutes = require('./routes/facebookAuthRoutes');  // ✅ Facebook Auth
const orderRoutes = require('./routes/orderRoutes'); // ✅ NEW Order Routes

// ✅ Import Calculation Logic
const calculationUtils = require('./utils/calculationUtils');

const app = express();
app.use(express.json());
app.use(cors());

// ✅ Debugging middleware to log all incoming requests
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.originalUrl}`);
  next();
});

// ✅ Root Route
app.get("/", (req, res) => {
  console.log("✅ API Root Accessed");
  res.send("Shoptobd API is Running!");
});

// ✅ Admin Routes
app.use("/admin", adminRoutes);

// ✅ Authentication Routes
app.use("/auth", authRoutes);

// ✅ Google Authentication Routes
app.use("/google-auth", googleAuthRoutes);

// ✅ Facebook Authentication Routes
app.use("/facebook-auth", facebookAuthRoutes);

// ✅ Order Routes (NEW)
app.use("/orders", orderRoutes);

// ✅ Calculation API (NEW)
app.post("/calculate-order-costs", async (req, res) => {
    const { orderId, deliveryMethod, paymentMethod, totalWeightGrams } = req.body;

    if (!orderId || !deliveryMethod || !paymentMethod || !totalWeightGrams) {
        return res.status(400).json({ message: "❌ Missing required fields" });
    }

    try {
        const result = await calculationUtils.calculateOrderCosts(orderId, deliveryMethod, paymentMethod, totalWeightGrams);
        res.status(200).json({
            message: "✅ Order costs calculated successfully",
            result
        });
    } catch (error) {
        console.error("🔥 Error calculating order costs:", error);
        res.status(500).json({ message: "❌ Failed to calculate order costs" });
    }
});

// ✅ Catch-All Route for Undefined Endpoints
app.use((req, res) => {
  res.status(404).json({ message: "❌ Endpoint Not Found" });
});

// ✅ Central Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("🔥 Server Error:", err);
  res.status(500).json({ message: "❌ Internal Server Error" });
});

// ✅ Start Express Server
const PORT = 5500; 
const HOST = "0.0.0.0"; 

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
});
