-- Run this once in PostgreSQL if your DB was created before the multiple-portions update.
-- Example: psql -U stranger -d society_management -f scripts/migrate_existing_portions.sql

CREATE TABLE IF NOT EXISTS house_portions (
  id SERIAL PRIMARY KEY,
  house_id INTEGER NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  plot_no VARCHAR(50),
  portion_name VARCHAR(100) NOT NULL,
  resident_name VARCHAR(150),
  resident_contact VARCHAR(50),
  resident_number VARCHAR(50),
  resident_type VARCHAR(50) DEFAULT 'owner',
  portion_type VARCHAR(50) DEFAULT 'owner',
  owner_name VARCHAR(255),
  category VARCHAR(50),
  charge_category VARCHAR(100),
  charge_category_label VARCHAR(255),
  house_category VARCHAR(100),
  category_label VARCHAR(255),
  actual_monthly_charges NUMERIC(12,2) DEFAULT 0,
  monthly_discount NUMERIC(12,2) DEFAULT 0,
  discounted_monthly_charges NUMERIC(12,2) DEFAULT 0,
  monthly_charges NUMERIC(12,2) DEFAULT 0,
  current_charges NUMERIC(12,2) DEFAULT 0,
  charges_after_discount NUMERIC(12,2) DEFAULT 0,
  actual_charges NUMERIC(12,2) DEFAULT 0,
  discounted_charges NUMERIC(12,2) DEFAULT 0,
  per_month_discount NUMERIC(12,2) DEFAULT 0,
  previous_dues NUMERIC(12,2) DEFAULT 0,
  opening_previous_dues NUMERIC(12,2) DEFAULT 0,
  total_dues NUMERIC(12,2) DEFAULT 0,
  amount_paid NUMERIC(12,2) DEFAULT 0,
  paid_amount NUMERIC(12,2) DEFAULT 0,
  remaining NUMERIC(12,2) DEFAULT 0,
  remaining_amount NUMERIC(12,2) DEFAULT 0,
  outstanding_amount NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'UNPAID',
  opening_month VARCHAR(20),
  opening_year INTEGER,
  last_billed_month VARCHAR(20),
  last_billed_year INTEGER,
  remarks TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE house_portions
  ADD COLUMN IF NOT EXISTS plot_no VARCHAR(50),
  ADD COLUMN IF NOT EXISTS resident_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS resident_type VARCHAR(50) DEFAULT 'owner',
  ADD COLUMN IF NOT EXISTS owner_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS charge_category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS charge_category_label VARCHAR(255),
  ADD COLUMN IF NOT EXISTS house_category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS category_label VARCHAR(255),
  ADD COLUMN IF NOT EXISTS monthly_charges NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_charges NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charges_after_discount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_charges NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discounted_charges NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_month_discount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_dues NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS opening_month VARCHAR(20),
  ADD COLUMN IF NOT EXISTS opening_year INTEGER,
  ADD COLUMN IF NOT EXISTS last_billed_month VARCHAR(20),
  ADD COLUMN IF NOT EXISTS last_billed_year INTEGER,
  ADD COLUMN IF NOT EXISTS opening_previous_dues NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remarks TEXT;

ALTER TABLE houses
  ADD COLUMN IF NOT EXISTS opening_month VARCHAR(20),
  ADD COLUMN IF NOT EXISTS opening_year INTEGER,
  ADD COLUMN IF NOT EXISTS last_billed_month VARCHAR(20),
  ADD COLUMN IF NOT EXISTS last_billed_year INTEGER,
  ADD COLUMN IF NOT EXISTS charge_category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS charge_category_label VARCHAR(255),
  ADD COLUMN IF NOT EXISTS current_charges NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charges_after_discount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_current_charges NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_charges_after_discount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_month_discount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_discount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_monthly_charges NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discounted_monthly_charges NUMERIC(12,2) DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_house_portion'
      AND conrelid = 'house_portions'::regclass
  ) THEN
    ALTER TABLE house_portions ADD CONSTRAINT uq_house_portion UNIQUE (house_id, portion_name);
  END IF;
END $$;

UPDATE house_portions
SET resident_number = COALESCE(resident_number, resident_contact),
    resident_type = COALESCE(resident_type, portion_type, 'owner'),
    charge_category = COALESCE(charge_category, category),
    charge_category_label = COALESCE(charge_category_label, charge_category, category),
    current_charges = COALESCE(NULLIF(current_charges, 0), monthly_charges, actual_monthly_charges, actual_charges, 0),
    charges_after_discount = COALESCE(NULLIF(charges_after_discount, 0), discounted_monthly_charges, discounted_charges, current_charges, 0),
    per_month_discount = COALESCE(NULLIF(per_month_discount, 0), monthly_discount, 0),
    total_dues = COALESCE(NULLIF(total_dues, 0), previous_dues, opening_previous_dues, 0),
    remaining = COALESCE(NULLIF(remaining, 0), remaining_amount, outstanding_amount, previous_dues, 0)
WHERE TRUE;
