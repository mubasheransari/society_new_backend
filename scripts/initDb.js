require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await query(sql);
  await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'sub_admin'`);
  await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_unique ON admin_users(email)`);

  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS owner_name TEXT DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'UNPAID'`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS dues_status VARCHAR(50) DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS total_dues NUMERIC(12,2) DEFAULT 0`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) DEFAULT 0`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS remaining NUMERIC(12,2) DEFAULT 0`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS previous_dues NUMERIC(12,2) DEFAULT 0`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS installments_paid NUMERIC(12,2) DEFAULT 0`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS outstanding_amount NUMERIC(12,2) DEFAULT 0`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS payment_summary TEXT DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS po_no VARCHAR(100) DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS po_date TIMESTAMP NULL`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS address TEXT DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS contact VARCHAR(50) DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS clearance_month_year TEXT DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS charge_category VARCHAR(50) DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS charge_category_label VARCHAR(100) DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS current_charges NUMERIC(12,2) DEFAULT 0`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS charges_after_discount NUMERIC(12,2) DEFAULT 0`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS monthly_current_charges NUMERIC(12,2) DEFAULT 0`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS monthly_charges_after_discount NUMERIC(12,2) DEFAULT 0`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS per_month_discount NUMERIC(12,2) DEFAULT 0`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS monthly_discount NUMERIC(12,2) DEFAULT 0`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS current_resident_name TEXT DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS owner_number VARCHAR(50) DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS current_resident_number VARCHAR(50) DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS owner_cnic VARCHAR(30) DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS plot_measure_sq_yds VARCHAR(30) DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS relation_type VARCHAR(10) DEFAULT ''`);
  await query(`ALTER TABLE houses ADD COLUMN IF NOT EXISTS relation_name TEXT DEFAULT ''`);
  await query(`ALTER TABLE residents ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''`);
  await query(`ALTER TABLE residents ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT ''`);

  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS qr_image TEXT DEFAULT ''`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS plot_measure_sq_yds VARCHAR(50) DEFAULT ''`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS applicant_name TEXT NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS relation_type VARCHAR(10) DEFAULT ''`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS relation_name TEXT DEFAULT ''`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS owner_type VARCHAR(50) DEFAULT ''`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS cnic VARCHAR(30) DEFAULT ''`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS dues_cleared_up_to DATE NULL`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS building_type VARCHAR(100) DEFAULT ''`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS transferred_name TEXT DEFAULT ''`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS remarks TEXT DEFAULT ''`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS issued_by_admin_id INTEGER NULL`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS issued_at TIMESTAMP NOT NULL DEFAULT NOW()`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()`);
  await query(`ALTER TABLE nocs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`);
  
  await query(`CREATE TABLE IF NOT EXISTS residents (
    id SERIAL PRIMARY KEY,
    house_id INTEGER NULL REFERENCES houses(id) ON DELETE SET NULL,
    plot_no VARCHAR(50) UNIQUE NOT NULL,
    full_name TEXT NOT NULL DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    password_hash TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS posts (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
  await query(`CREATE TABLE IF NOT EXISTS complaints (
    id SERIAL PRIMARY KEY,
    resident_id INTEGER NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    admin_response TEXT DEFAULT '',
    image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    admin_response_images JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
  const bcrypt = require('bcryptjs');
  const residentPasswordHash = await bcrypt.hash(process.env.DEFAULT_RESIDENT_PASSWORD || '123456', 10);
  await query(`
    INSERT INTO residents (house_id, plot_no, full_name, phone, password_hash, is_active, created_at, updated_at)
    SELECT h.id, h.plot_no,
           COALESCE(NULLIF(h.current_resident_name,''), NULLIF(h.owner_name,''), 'Resident ' || h.plot_no),
           COALESCE(NULLIF(h.current_resident_number,''), NULLIF(h.owner_number,''), COALESCE(h.contact,'')),
           $1, TRUE, NOW(), NOW()
    FROM houses h
    ON CONFLICT (plot_no) DO UPDATE SET
      house_id = EXCLUDED.house_id,
      full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone,
      password_hash = EXCLUDED.password_hash,
      is_active = TRUE,
      updated_at = NOW()
  `, [residentPasswordHash]);


  await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb`);

await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'society'`);
await query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS updates JSONB NOT NULL DEFAULT '[]'::jsonb`);
await query(`CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_type TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link_url TEXT DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW()
)`);
await query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link_url TEXT DEFAULT ''`);
await query(`CREATE TABLE IF NOT EXISTS noc_requests (
  id SERIAL PRIMARY KEY,
  resident_id INTEGER NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  plot_no VARCHAR(50) NOT NULL,
  request_type VARCHAR(50) NOT NULL DEFAULT 'general',
  notes TEXT DEFAULT '',
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  admin_message TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)`);
await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS plot_no VARCHAR(50) DEFAULT ''`);
await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS request_type VARCHAR(50) NOT NULL DEFAULT 'general'`);
await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''`);
await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'PENDING'`);
await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS admin_message TEXT DEFAULT ''`);
await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
  await query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS admin_response_images JSONB NOT NULL DEFAULT '[]'::jsonb`);

  const { ensureSuperAdmin } = require('../routes/adminAuth');
  await ensureSuperAdmin();

  console.log('PostgreSQL schema initialized successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to initialize schema:', err);
  process.exit(1);
});
