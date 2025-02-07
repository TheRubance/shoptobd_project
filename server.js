require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

pool.connect()
  .then(() => console.log("✅ PostgreSQL Connected Successfully!"))
  .catch(err => console.error("❌ PostgreSQL Connection Error:", err));

app.get("/", (req, res) => {
  res.send("Shoptobd API is Running!");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
