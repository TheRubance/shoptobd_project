require("dotenv").config();
const express = require("express");
const cors = require("cors");
const pool = require("./config/db"); // Use shared database connection
const adminRoutes = require("./routes/adminRoutes"); // Import Admin Routes

const app = express();
app.use(express.json());
app.use(cors());

// ✅ Debugging middleware to log all incoming requests (placed before routes)
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.originalUrl}`);
  next();
});

// ✅ Root Route (Basic API Check)
app.get("/", (req, res) => {
  console.log("✅ API Root Accessed");
  res.send("Shoptobd API is Running!");
});

// ✅ Admin Routes
app.use("/admin", adminRoutes);

// ✅ Catch-All Route for Undefined Endpoints
app.use((req, res) => {
  res.status(404).json({ message: "❌ Endpoint Not Found" });
});

// ✅ Central Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("🔥 Server Error:", err);
  res.status(500).json({ message: "❌ Internal Server Error" });
});

// ✅ Force Express to Listen on All Network Interfaces
const PORT = 5500; // Ensure this is set correctly
const HOST = "0.0.0.0"; // Allow all network interfaces

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
});

