const { query, getClient } = require('../../config/db');
const bcrypt = require('bcryptjs');

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const cleaned = String(value).replace(/,/g, '').trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function normalizeUiStatus(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (raw === 'paid') return 'PAID';
  if (raw === 'partially_paid' || raw === 'partial' || raw === 'partially paid') return 'PARTIALLY PAID';
  return 'UNPAID';
}

function mapHouse(row) {
  if (!row) return null;
  return {
    id: row.id,
    plotNo: row.plot_no,
    ownerName: row.owner_name || '',
    currentResidentName: row.current_resident_name || '',
    ownerNumber: row.owner_number || '',
    currentResidentNumber: row.current_resident_number || '',
    ownerCnic: row.owner_cnic || '',
    plotMeasureSqYds: row.plot_measure_sq_yds || '',
    relationType: row.relation_type || '',
    relationName: row.relation_name || '',
    category: row.category || '',
    status: row.status || 'UNPAID',
    duesStatus: row.dues_status || '',
    totalDues: toNumber(row.total_dues),
    amountPaid: toNumber(row.amount_paid),
    remaining: toNumber(row.remaining),
    previousDues: toNumber(row.previous_dues),
    installmentsPaid: toNumber(row.installments_paid),
    outstandingAmount: toNumber(row.outstanding_amount),
    paymentSummary: row.payment_summary || '',
    poNo: row.po_no || '',
    poDate: row.po_date ? new Date(row.po_date).toISOString() : null,
    address: row.address || '',
    contact: row.contact || '',
    clearanceMonthYear: row.clearance_month_year || '',
    chargeCategory: row.charge_category || '',
    chargeCategoryLabel: row.charge_category_label || '',
    currentCharges: toNumber(row.current_charges),
    chargesAfterDiscount: toNumber(row.charges_after_discount),
    monthlyCurrentCharges: toNumber(row.monthly_current_charges),
    monthlyChargesAfterDiscount: toNumber(row.monthly_charges_after_discount),
    perMonthDiscount: toNumber(row.per_month_discount),
    monthlyDiscount: toNumber(row.monthly_discount),
    openingMonth: row.opening_month || '',
    lastBilledMonth: row.last_billed_month || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function findAll(search = '') {
  const q = String(search || '').trim().toLowerCase();
  const params = [];
  let sql = `SELECT * FROM houses`;
  if (q) {
    params.push(`%${q}%`);
    sql += ` WHERE LOWER(plot_no) LIKE $1 OR LOWER(owner_name) LIKE $1 OR LOWER(current_resident_name) LIKE $1 OR LOWER(owner_number) LIKE $1 OR LOWER(current_resident_number) LIKE $1`;
  }
  sql += ` ORDER BY id DESC LIMIT 500`;
  const result = await query(sql, params);
  return result.rows.map(mapHouse);
}

async function findByPlotNo(plotNo) {
  const result = await query(`SELECT * FROM houses WHERE LOWER(plot_no) = LOWER($1) LIMIT 1`, [plotNo]);
  return mapHouse(result.rows[0]);
}

async function deleteByPlotNo(plotNo) {
  const result = await query(`DELETE FROM houses WHERE LOWER(plot_no) = LOWER($1) RETURNING id`, [plotNo]);
  return result.rowCount > 0;
}

async function syncResident(client, savedHouse) {
  const defaultPassword = process.env.DEFAULT_RESIDENT_PASSWORD || '123456';
  const passwordHash = await bcrypt.hash(defaultPassword, 10);
  const fullName = String(savedHouse.current_resident_name || savedHouse.owner_name || '').trim() || `Resident ${savedHouse.plot_no}`;
  const phone = String(savedHouse.current_resident_number || savedHouse.owner_number || savedHouse.contact || '').trim();

  await client.query(
    `INSERT INTO residents (house_id, plot_no, full_name, phone, password_hash, is_active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,TRUE,NOW(),NOW())
     ON CONFLICT (plot_no) DO UPDATE SET
       house_id = EXCLUDED.house_id,
       full_name = EXCLUDED.full_name,
       phone = EXCLUDED.phone,
       password_hash = EXCLUDED.password_hash,
       is_active = TRUE,
       updated_at = NOW()`,
    [savedHouse.id, savedHouse.plot_no, fullName, phone, passwordHash],
  );
}

async function upsertHouse(input) {
  const client = await getClient();
  try {
    const previousDues = toNumber(input.previousDues ?? input.totalDues);
    const amountPaid = toNumber(input.amountPaid ?? input.installmentsPaid);
    const remaining = input.remaining !== undefined && input.remaining !== null && input.remaining !== ''
      ? toNumber(input.remaining)
      : Math.max(previousDues - amountPaid, 0);

    const installmentsPaid = toNumber(input.installmentsPaid ?? amountPaid);
    const outstandingAmount = toNumber(input.outstandingAmount ?? remaining);
    const currentCharges = toNumber(input.currentCharges ?? input.monthlyCurrentCharges);
    const chargesAfterDiscount = toNumber(input.chargesAfterDiscount ?? input.monthlyChargesAfterDiscount ?? currentCharges);
    const perMonthDiscount = toNumber(input.perMonthDiscount);
    const monthlyDiscount = toNumber(input.monthlyDiscount ?? perMonthDiscount);

    const resolvedStatus = normalizeUiStatus(
      input.status || (previousDues <= 0 || remaining <= 0 ? 'paid' : amountPaid > 0 ? 'partially_paid' : 'unpaid')
    );
    const duesStatus = String(input.duesStatus || resolvedStatus).trim().toLowerCase().replace(/\s+/g, '_');

    const paymentSummary = input.paymentSummary || (
      previousDues > 0 || amountPaid > 0
        ? `Rs ${amountPaid.toFixed(2)} dues paid out of Rs ${previousDues.toFixed(2)}`
        : 'No dues pending'
    );

    const sql = `
      INSERT INTO houses (
        plot_no, owner_name, current_resident_name, owner_number, current_resident_number,
        category, status, dues_status, total_dues, amount_paid, remaining,
        previous_dues, installments_paid, outstanding_amount, payment_summary,
        po_no, po_date, address, contact, clearance_month_year,
        charge_category, charge_category_label,
        current_charges, charges_after_discount,
        monthly_current_charges, monthly_charges_after_discount,
        per_month_discount, monthly_discount, opening_month, last_billed_month,
        owner_cnic, plot_measure_sq_yds, relation_type, relation_name,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,$11,
        $12,$13,$14,$15,
        $16,$17,$18,$19,$20,
        $21,$22,
        $23,$24,
        $25,$26,
        $27,$28,$29,$30,
        $31,$32,$33,$34,
        NOW(), NOW()
      )
      ON CONFLICT (plot_no) DO UPDATE SET
        owner_name = EXCLUDED.owner_name,
        current_resident_name = EXCLUDED.current_resident_name,
        owner_number = EXCLUDED.owner_number,
        current_resident_number = EXCLUDED.current_resident_number,
        category = EXCLUDED.category,
        status = EXCLUDED.status,
        dues_status = EXCLUDED.dues_status,
        total_dues = EXCLUDED.total_dues,
        amount_paid = EXCLUDED.amount_paid,
        remaining = EXCLUDED.remaining,
        previous_dues = EXCLUDED.previous_dues,
        installments_paid = EXCLUDED.installments_paid,
        outstanding_amount = EXCLUDED.outstanding_amount,
        payment_summary = EXCLUDED.payment_summary,
        po_no = EXCLUDED.po_no,
        po_date = EXCLUDED.po_date,
        address = EXCLUDED.address,
        contact = EXCLUDED.contact,
        clearance_month_year = EXCLUDED.clearance_month_year,
        charge_category = EXCLUDED.charge_category,
        charge_category_label = EXCLUDED.charge_category_label,
        current_charges = EXCLUDED.current_charges,
        charges_after_discount = EXCLUDED.charges_after_discount,
        monthly_current_charges = EXCLUDED.monthly_current_charges,
        monthly_charges_after_discount = EXCLUDED.monthly_charges_after_discount,
        per_month_discount = EXCLUDED.per_month_discount,
        monthly_discount = EXCLUDED.monthly_discount,
        opening_month = EXCLUDED.opening_month,
        last_billed_month = EXCLUDED.last_billed_month,
        owner_cnic = EXCLUDED.owner_cnic,
        plot_measure_sq_yds = EXCLUDED.plot_measure_sq_yds,
        relation_type = EXCLUDED.relation_type,
        relation_name = EXCLUDED.relation_name,
        updated_at = NOW()
      RETURNING *;
    `;

    const params = [
      input.plotNo,
      input.ownerName || '',
      input.currentResidentName || '',
      input.ownerNumber || '',
      input.currentResidentNumber || '',
      input.category || '',
      resolvedStatus,
      duesStatus,
      previousDues,
      amountPaid,
      remaining,
      previousDues,
      installmentsPaid,
      outstandingAmount,
      paymentSummary,
      input.poNo || '',
      input.poDate || null,
      input.address || '',
      input.contact || input.currentResidentNumber || input.ownerNumber || '',
      input.clearanceMonthYear || '',
      input.chargeCategory || '',
      input.chargeCategoryLabel || '',
      currentCharges,
      chargesAfterDiscount,
      toNumber(input.monthlyCurrentCharges ?? currentCharges),
      toNumber(input.monthlyChargesAfterDiscount ?? chargesAfterDiscount),
      perMonthDiscount,
      monthlyDiscount,
      input.openingMonth || '',
      input.lastBilledMonth || input.openingMonth || '',
      input.ownerCnic || input.cnic || '',
      input.plotMeasureSqYds || input.plotMeasure || '',
      input.relationType || '',
      input.relationName || '',
    ];

    await client.query('BEGIN');
    const result = await client.query(sql, params);
    await syncResident(client, result.rows[0]);
    await client.query('COMMIT');
    return mapHouse(result.rows[0]);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}


function mapPortion(row) {
  if (!row) return null;
  return {
    id: row.id,
    houseId: row.house_id,
    plotNo: row.plot_no,
    portionName: row.portion_name || '',
    residentName: row.resident_name || '',
    residentNumber: row.resident_number || '',
    residentType: row.resident_type || 'owner',
    chargeCategory: row.charge_category || '',
    chargeCategoryLabel: row.charge_category_label || '',
    currentCharges: toNumber(row.current_charges),
    chargesAfterDiscount: toNumber(row.charges_after_discount),
    perMonthDiscount: toNumber(row.per_month_discount),
    previousDues: toNumber(row.previous_dues),
    totalDues: toNumber(row.total_dues),
    amountPaid: toNumber(row.amount_paid),
    remaining: toNumber(row.remaining),
    status: row.status || 'UNPAID',
    openingMonth: row.opening_month || '',
    lastBilledMonth: row.last_billed_month || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function findPortionsByHouseId(houseId) {
  const result = await query(`SELECT * FROM house_portions WHERE house_id = $1 ORDER BY id ASC`, [houseId]);
  return result.rows.map(mapPortion);
}

async function findPortionById(portionId) {
  const result = await query(`SELECT * FROM house_portions WHERE id = $1 LIMIT 1`, [portionId]);
  return mapPortion(result.rows[0]);
}

async function findPortionsByPlotNo(plotNo) {
  const house = await findByPlotNo(plotNo);
  if (!house) return [];
  return findPortionsByHouseId(house.id);
}

async function upsertPortion(input) {
  const house = input.houseId ? { id: input.houseId, plotNo: input.plotNo } : await findByPlotNo(input.plotNo);
  if (!house) throw new Error('House not found');
  const portionName = String(input.portionName || input.name || '').trim();
  if (!portionName) throw new Error('Portion name is required');
  const previousDues = toNumber(input.previousDues ?? input.totalDues);
  const amountPaid = toNumber(input.amountPaid);
  const remaining = input.remaining !== undefined ? toNumber(input.remaining) : Math.max(previousDues - amountPaid, 0);
  const status = normalizeUiStatus(input.status || (remaining <= 0 ? 'paid' : amountPaid > 0 ? 'partially_paid' : 'unpaid'));
  const result = await query(`
    INSERT INTO house_portions (
      house_id, plot_no, portion_name, resident_name, resident_number, resident_type,
      charge_category, charge_category_label, current_charges, charges_after_discount, per_month_discount,
      previous_dues, total_dues, amount_paid, remaining, status, opening_month, last_billed_month, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())
    ON CONFLICT (house_id, portion_name) DO UPDATE SET
      resident_name = EXCLUDED.resident_name, resident_number = EXCLUDED.resident_number, resident_type = EXCLUDED.resident_type,
      charge_category = EXCLUDED.charge_category, charge_category_label = EXCLUDED.charge_category_label,
      current_charges = EXCLUDED.current_charges, charges_after_discount = EXCLUDED.charges_after_discount, per_month_discount = EXCLUDED.per_month_discount,
      previous_dues = EXCLUDED.previous_dues, total_dues = EXCLUDED.total_dues, amount_paid = EXCLUDED.amount_paid, remaining = EXCLUDED.remaining, status = EXCLUDED.status,
      opening_month = EXCLUDED.opening_month, last_billed_month = EXCLUDED.last_billed_month, updated_at = NOW()
    RETURNING *`, [
      house.id, input.plotNo || house.plotNo, portionName, input.residentName || '', input.residentNumber || '', input.residentType || 'owner',
      input.chargeCategory || '', input.chargeCategoryLabel || '', toNumber(input.currentCharges), toNumber(input.chargesAfterDiscount), toNumber(input.perMonthDiscount),
      previousDues, previousDues, amountPaid, remaining, status, input.openingMonth || '', input.lastBilledMonth || input.openingMonth || '',
    ]);
  return mapPortion(result.rows[0]);
}

async function deletePortion(portionId) {
  const result = await query(`DELETE FROM house_portions WHERE id = $1 RETURNING id`, [portionId]);
  return result.rowCount > 0;
}

module.exports = {
  mapHouse,
  findAll,
  findByPlotNo,
  deleteByPlotNo,
  upsertHouse,
  mapPortion,
  findPortionsByHouseId,
  findPortionsByPlotNo,
  findPortionById,
  upsertPortion,
  deletePortion,
};
