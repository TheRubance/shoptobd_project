require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./config/db"); // Use shared database connection

const adminRoutes = require("./routes/adminRoutes"); 
const authRoutes = require('./routes/authRoutes');  // Added user authentication routes

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

// ✅ Authentication Routes (NEW)
app.use("/auth", authRoutes);

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
