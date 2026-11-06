const express = require("express");
const { Pool } = require("pg");
const Redis = require("ioredis");

const app = express();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: "postgres",
  password: "postgres",
  database: "postgres",
  port: 5432,
});

const redis = new Redis({ host: process.env.REDIS_HOST, port: 6379 });

app.get("/api/users", async (req, res) => {
  let db;
  try {
    db = await pool.connect();
    const result = await db.query("SELECT NOW()");
    await redis.set("last_call", Date.now());
    res.json({ ok: true, time: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    db?.release();
  }
});

app.get("/status", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/health", async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    await redis.ping();
    res.status(200).json({ status: "ok" });
  } catch (err) {
    res.status(503).json({ status: "unhealthy", error: err.message });
  }
});

async function waitForConnections() {
  const maxAttempts = 30;
  const delayMs = 1000;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const client = await pool.connect();
      client.release();
      await redis.ping();
      return;
    } catch (err) {
      if (i === 0) console.log("Waiting for postgres and redis...");
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("Could not connect to postgres or redis");
}

waitForConnections()
  .then(() => {
    app.listen(3000, () => console.log("API running on 3000"));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
