const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:0007@localhost:5432/shoptobd",
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost") 
    ? { rejectUnauthorized: false } 
    : false,
});

pool.connect()
  .then(() => console.log("✅ PostgreSQL Connected Successfully!"))
  .catch(err => console.error("❌ PostgreSQL Connection Error:", err));

module.exports = pool;
