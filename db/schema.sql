CREATE TABLE IF NOT EXISTS houses (
  id SERIAL PRIMARY KEY,
  plot_no VARCHAR(50) UNIQUE NOT NULL,
  owner_name TEXT DEFAULT '',
  category TEXT DEFAULT '',
  status VARCHAR(30) DEFAULT 'UNPAID',
  dues_status VARCHAR(50) DEFAULT '',
  total_dues NUMERIC(12,2) DEFAULT 0,
  amount_paid NUMERIC(12,2) DEFAULT 0,
  remaining NUMERIC(12,2) DEFAULT 0,
  previous_dues NUMERIC(12,2) DEFAULT 0,
  installments_paid NUMERIC(12,2) DEFAULT 0,
  outstanding_amount NUMERIC(12,2) DEFAULT 0,
  payment_summary TEXT DEFAULT '',
  po_no VARCHAR(100) DEFAULT '',
  po_date TIMESTAMP NULL,
  address TEXT DEFAULT '',
  contact VARCHAR(50) DEFAULT '',
  clearance_month_year TEXT DEFAULT '',
  charge_category VARCHAR(50) DEFAULT '',
  charge_category_label VARCHAR(100) DEFAULT '',
  current_charges NUMERIC(12,2) DEFAULT 0,
  charges_after_discount NUMERIC(12,2) DEFAULT 0,
  monthly_current_charges NUMERIC(12,2) DEFAULT 0,
  monthly_charges_after_discount NUMERIC(12,2) DEFAULT 0,
  per_month_discount NUMERIC(12,2) DEFAULT 0,
  monthly_discount NUMERIC(12,2) DEFAULT 0,
  owner_cnic VARCHAR(30) DEFAULT '',
  plot_measure_sq_yds VARCHAR(30) DEFAULT '',
  relation_type VARCHAR(10) DEFAULT '',
  relation_name TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monthly_invoices (
  id SERIAL PRIMARY KEY,
  house_id INTEGER NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  plot_no VARCHAR(50) NOT NULL,
  bill_month VARCHAR(7) NOT NULL,
  bill_month_label VARCHAR(30) NOT NULL,
  invoice_number VARCHAR(120) NOT NULL,
  current_charges NUMERIC(12,2) DEFAULT 0,
  per_month_discount NUMERIC(12,2) DEFAULT 0,
  charges_after_discount NUMERIC(12,2) DEFAULT 0,
  previous_dues NUMERIC(12,2) DEFAULT 0,
  installments_paid NUMERIC(12,2) DEFAULT 0,
  outstanding_amount NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'unpaid',
  generated_at TIMESTAMP DEFAULT NOW(),
  generated_by VARCHAR(120) DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_monthly_invoice_house_month UNIQUE (house_id, bill_month)
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES monthly_invoices(id) ON DELETE CASCADE,
  house_id INTEGER NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  plot_no VARCHAR(50) NOT NULL,
  bill_month VARCHAR(7) NOT NULL,
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_date TIMESTAMP NOT NULL DEFAULT NOW(),
  notes TEXT DEFAULT '',
  received_by VARCHAR(120) DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_houses_plot_no ON houses(plot_no);
CREATE INDEX IF NOT EXISTS idx_monthly_invoices_plot_no ON monthly_invoices(plot_no);
CREATE INDEX IF NOT EXISTS idx_monthly_invoices_house_month ON monthly_invoices(house_id, bill_month);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice_id ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_house_month ON invoice_payments(house_id, bill_month);


CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  role VARCHAR(20) NOT NULL DEFAULT 'sub_admin',
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);


CREATE TABLE IF NOT EXISTS nocs (
  id UUID PRIMARY KEY,
  noc_number VARCHAR(120) UNIQUE NOT NULL,
  qr_value VARCHAR(255) UNIQUE NOT NULL,
  qr_image TEXT DEFAULT '',
  noc_type VARCHAR(50) NOT NULL,
  plot_no VARCHAR(50) NOT NULL,
  plot_measure_sq_yds VARCHAR(50) DEFAULT '',
  applicant_name TEXT NOT NULL DEFAULT '',
  relation_type VARCHAR(10) DEFAULT '',
  relation_name TEXT DEFAULT '',
  owner_type VARCHAR(50) DEFAULT '',
  cnic VARCHAR(30) DEFAULT '',
  dues_cleared_up_to DATE NULL,
  building_type VARCHAR(100) DEFAULT '',
  transferred_name TEXT DEFAULT '',
  remarks TEXT DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  issued_by_admin_id INTEGER NULL,
  issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nocs_noc_number ON nocs(noc_number);
CREATE INDEX IF NOT EXISTS idx_nocs_plot_no ON nocs(plot_no);
CREATE INDEX IF NOT EXISTS idx_nocs_status ON nocs(status);


CREATE TABLE IF NOT EXISTS residents (
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
);
CREATE INDEX IF NOT EXISTS idx_residents_plot_no ON residents(plot_no);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT DEFAULT '',
  image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  category TEXT NOT NULL DEFAULT 'society',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaints (
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
);
CREATE INDEX IF NOT EXISTS idx_complaints_resident_id ON complaints(resident_id);


CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_type TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link_url TEXT DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_type, user_id, is_read);

CREATE TABLE IF NOT EXISTS noc_requests (
  id SERIAL PRIMARY KEY,
  resident_id INTEGER NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  plot_no VARCHAR(50) NOT NULL,
  request_type VARCHAR(50) NOT NULL DEFAULT 'general',
  notes TEXT DEFAULT '',
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  admin_message TEXT DEFAULT '',
  updates JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS plot_no VARCHAR(50) DEFAULT '';
ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS request_type VARCHAR(50) NOT NULL DEFAULT 'general';
ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'PENDING';
ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS admin_message TEXT DEFAULT '';
ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS updates JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Multiple portions per house support
ALTER TABLE houses ADD COLUMN IF NOT EXISTS opening_month VARCHAR(7) DEFAULT '';
ALTER TABLE houses ADD COLUMN IF NOT EXISTS last_billed_month VARCHAR(7) DEFAULT '';

CREATE TABLE IF NOT EXISTS house_portions (
  id SERIAL PRIMARY KEY,
  house_id INTEGER NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  plot_no VARCHAR(50) NOT NULL,
  portion_name VARCHAR(120) NOT NULL,
  resident_name TEXT DEFAULT '',
  resident_number VARCHAR(50) DEFAULT '',
  resident_type VARCHAR(20) DEFAULT 'owner',
  charge_category VARCHAR(50) DEFAULT '',
  charge_category_label VARCHAR(100) DEFAULT '',
  current_charges NUMERIC(12,2) DEFAULT 0,
  charges_after_discount NUMERIC(12,2) DEFAULT 0,
  per_month_discount NUMERIC(12,2) DEFAULT 0,
  previous_dues NUMERIC(12,2) DEFAULT 0,
  total_dues NUMERIC(12,2) DEFAULT 0,
  amount_paid NUMERIC(12,2) DEFAULT 0,
  remaining NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(30) DEFAULT 'UNPAID',
  opening_month VARCHAR(7) DEFAULT '',
  last_billed_month VARCHAR(7) DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_house_portion_name UNIQUE (house_id, portion_name)
);
CREATE INDEX IF NOT EXISTS idx_house_portions_house_id ON house_portions(house_id);
CREATE INDEX IF NOT EXISTS idx_house_portions_plot_no ON house_portions(plot_no);

ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS portion_id INTEGER NULL REFERENCES house_portions(id) ON DELETE CASCADE;
ALTER TABLE monthly_invoices ADD COLUMN IF NOT EXISTS portion_name VARCHAR(120) DEFAULT '';
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS portion_id INTEGER NULL REFERENCES house_portions(id) ON DELETE CASCADE;
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS portion_name VARCHAR(120) DEFAULT '';
ALTER TABLE monthly_invoices DROP CONSTRAINT IF EXISTS uq_monthly_invoice_house_month;
CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_invoice_house_portion_month ON monthly_invoices (house_id, COALESCE(portion_id, 0), bill_month);

-- Contact/current resident compatibility columns
ALTER TABLE houses ADD COLUMN IF NOT EXISTS current_resident_name TEXT DEFAULT '';
ALTER TABLE houses ADD COLUMN IF NOT EXISTS owner_number VARCHAR(50) DEFAULT '';
ALTER TABLE houses ADD COLUMN IF NOT EXISTS current_resident_number VARCHAR(50) DEFAULT '';
ALTER TABLE houses ADD COLUMN IF NOT EXISTS owner_cnic VARCHAR(30) DEFAULT '';
ALTER TABLE houses ADD COLUMN IF NOT EXISTS plot_measure_sq_yds VARCHAR(30) DEFAULT '';
ALTER TABLE houses ADD COLUMN IF NOT EXISTS relation_type VARCHAR(10) DEFAULT '';
ALTER TABLE houses ADD COLUMN IF NOT EXISTS relation_name TEXT DEFAULT '';

-- Category charges (moved off local categoryCharges.json so it persists on
-- serverless/read-only filesystems such as Vercel)
CREATE TABLE IF NOT EXISTS category_charges (
  category_code VARCHAR(20) PRIMARY KEY,
  label VARCHAR(50) NOT NULL,
  yard NUMERIC(10,2) DEFAULT 0,
  owner_actual_charges NUMERIC(12,2) DEFAULT 0,
  owner_discounted_charges NUMERIC(12,2) DEFAULT 0,
  rental_actual_charges NUMERIC(12,2) DEFAULT 0,
  rental_discounted_charges NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
