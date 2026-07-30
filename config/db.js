const { Pool } = require('pg');
require('dotenv').config();

// Vercel Postgres (Neon-backed) exposes POSTGRES_URL; DATABASE_URL is the
// generic convention used elsewhere (Render, Railway, Supabase, etc).
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

// Hosted Postgres providers require SSL. Default to SSL on whenever a
// connection string is used, unless explicitly disabled with DB_SSL=false.
const sslEnabled = connectionString
  ? process.env.DB_SSL !== 'false'
  : process.env.DB_SSL === 'true';

const pool = new Pool(
  connectionString
    ? {
        connectionString,
        ssl: sslEnabled ? { rejectUnauthorized: false } : false,
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || 'society_management',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      }
);

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

module.exports = { pool, query, getClient };
