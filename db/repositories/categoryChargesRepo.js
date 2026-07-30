const { query, getClient } = require('../../config/db');

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const cleaned = String(value).replace(/,/g, '').trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function mapRow(row) {
  if (!row) return null;
  return {
    categoryCode: row.category_code,
    label: row.label || row.category_code,
    yard: toNumber(row.yard),
    ownerActualCharges: toNumber(row.owner_actual_charges),
    ownerDiscountedCharges: toNumber(row.owner_discounted_charges),
    ownerDiscount: Math.max(toNumber(row.owner_actual_charges) - toNumber(row.owner_discounted_charges), 0),
    rentalActualCharges: toNumber(row.rental_actual_charges),
    rentalDiscountedCharges: toNumber(row.rental_discounted_charges),
    rentalDiscount: Math.max(toNumber(row.rental_actual_charges) - toNumber(row.rental_discounted_charges), 0),
    monthlyCharges: toNumber(row.owner_discounted_charges),
  };
}

async function findAll() {
  const result = await query('SELECT * FROM category_charges ORDER BY category_code ASC');
  return result.rows.map(mapRow);
}

/**
 * Replace the full set of category charges in a single transaction.
 * Mirrors the previous "overwrite the whole JSON file" semantics of
 * db/maintenanceCharges.js so callers don't need to change behaviour.
 */
async function replaceAll(items = []) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM category_charges');
    for (const item of items) {
      await client.query(
        `INSERT INTO category_charges (
           category_code, label, yard,
           owner_actual_charges, owner_discounted_charges,
           rental_actual_charges, rental_discounted_charges,
           created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
         ON CONFLICT (category_code) DO UPDATE SET
           label = EXCLUDED.label,
           yard = EXCLUDED.yard,
           owner_actual_charges = EXCLUDED.owner_actual_charges,
           owner_discounted_charges = EXCLUDED.owner_discounted_charges,
           rental_actual_charges = EXCLUDED.rental_actual_charges,
           rental_discounted_charges = EXCLUDED.rental_discounted_charges,
           updated_at = NOW()`,
        [
          item.categoryCode,
          item.label || item.categoryCode,
          toNumber(item.yard),
          toNumber(item.ownerActualCharges),
          toNumber(item.ownerDiscountedCharges),
          toNumber(item.rentalActualCharges),
          toNumber(item.rentalDiscountedCharges),
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
  return findAll();
}

module.exports = { findAll, replaceAll };
