const { query, getClient } = require('../../config/db');

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const cleaned = String(value).replace(/,/g, '').trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (['paid', 'cleared'].includes(value)) return 'paid';
  if (['partially_paid', 'partial', 'partially-paid', 'partially paid'].includes(value)) return 'partially_paid';
  return 'unpaid';
}

function uppercaseStatus(status) {
  const n = normalizeStatus(status);
  if (n === 'paid') return 'PAID';
  if (n === 'partially_paid') return 'PARTIALLY_PAID';
  return 'UNPAID';
}

function duesText(status) {
  const n = normalizeStatus(status);
  if (n === 'paid') return 'paid';
  if (n === 'partially_paid') return 'partially paid';
  return 'unpaid';
}

function mapInvoice(row) {
  if (!row) return null;
  return {
    id: row.id,
    houseId: row.house_id,
    plotNo: row.plot_no,
    billMonth: row.bill_month,
    portionId: row.portion_id || null,
    portionName: row.portion_name || '',
    billMonthLabel: row.bill_month_label,
    invoiceNumber: row.invoice_number,
    currentCharges: toNumber(row.current_charges),
    perMonthDiscount: toNumber(row.per_month_discount),
    chargesAfterDiscount: toNumber(row.charges_after_discount),
    previousDues: toNumber(row.previous_dues),
    installmentsPaid: toNumber(row.installments_paid),
    outstandingAmount: toNumber(row.outstanding_amount),
    status: normalizeStatus(row.status),
    generatedAt: row.generated_at ? new Date(row.generated_at).toISOString() : null,
    generatedBy: row.generated_by || '',
    notes: row.notes || '',
  };
}

function mapPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    houseId: row.house_id,
    plotNo: row.plot_no,
    billMonth: row.bill_month,
    portionId: row.portion_id || null,
    portionName: row.portion_name || '',
    amountPaid: toNumber(row.amount_paid),
    paymentDate: row.payment_date ? new Date(row.payment_date).toISOString() : null,
    notes: row.notes || '',
    receivedBy: row.received_by || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

async function findByHouseId(houseId, portionId = undefined) {
  const params = [houseId];
  let sql = `SELECT * FROM monthly_invoices WHERE house_id = $1`;
  if (portionId !== undefined && portionId !== null && portionId !== '') {
    params.push(Number(portionId));
    sql += ` AND portion_id = $2`;
  } else if (portionId === null) {
    sql += ` AND portion_id IS NULL`;
  }
  sql += ` ORDER BY bill_month DESC, id DESC`;
  const result = await query(sql, params);
  return result.rows.map(mapInvoice);
}

async function findByHouseIdAndBillMonth(houseId, billMonth, portionId = null) {
  const result = await query(
    `SELECT * FROM monthly_invoices WHERE house_id = $1 AND bill_month = $2 AND COALESCE(portion_id, 0) = COALESCE($3, 0) LIMIT 1`,
    [houseId, billMonth, portionId ? Number(portionId) : null]
  );
  return mapInvoice(result.rows[0]);
}

async function findPaymentsByInvoiceId(invoiceId) {
  const result = await query(
    `SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY payment_date DESC, id DESC`,
    [invoiceId]
  );
  return result.rows.map(mapPayment);
}

async function upsertInvoice(input) {
  const currentCharges = toNumber(input.currentCharges);
  const perMonthDiscount = toNumber(input.perMonthDiscount);
  const chargesAfterDiscount = toNumber(input.chargesAfterDiscount);
  const previousDues = toNumber(input.previousDues);
  const installmentsPaid = toNumber(input.installmentsPaid);
  const totalDue = previousDues + chargesAfterDiscount;
  const outstandingAmount = input.outstandingAmount !== undefined && input.outstandingAmount !== null && input.outstandingAmount !== ''
    ? Math.max(toNumber(input.outstandingAmount), 0)
    : Math.max(totalDue - installmentsPaid, 0);

  let status = normalizeStatus(input.status);
  if (!input.status) {
    if (outstandingAmount <= 0 && totalDue > 0) status = 'paid';
    else if (installmentsPaid > 0) status = 'partially_paid';
    else status = 'unpaid';
  }

  const result = await query(
    `INSERT INTO monthly_invoices (
      house_id, plot_no, bill_month, bill_month_label, invoice_number, portion_id, portion_name,
      current_charges, per_month_discount, charges_after_discount,
      previous_dues, installments_paid, outstanding_amount,
      status, generated_at, generated_by, notes, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,
      $8,$9,$10,
      $11,$12,$13,
      $14,NOW(),$15,$16,NOW(),NOW()
    )
    ON CONFLICT (house_id, COALESCE(portion_id, 0), bill_month) DO UPDATE SET
      invoice_number = EXCLUDED.invoice_number,
      portion_id = EXCLUDED.portion_id,
      portion_name = EXCLUDED.portion_name,
      current_charges = EXCLUDED.current_charges,
      per_month_discount = EXCLUDED.per_month_discount,
      charges_after_discount = EXCLUDED.charges_after_discount,
      previous_dues = EXCLUDED.previous_dues,
      installments_paid = EXCLUDED.installments_paid,
      outstanding_amount = EXCLUDED.outstanding_amount,
      status = EXCLUDED.status,
      generated_at = NOW(),
      generated_by = EXCLUDED.generated_by,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING *`,
    [
      input.houseId,
      input.plotNo,
      input.billMonth,
      input.billMonthLabel,
      input.invoiceNumber,
      input.portionId ? Number(input.portionId) : null,
      input.portionName || '',
      currentCharges,
      perMonthDiscount,
      chargesAfterDiscount,
      previousDues,
      installmentsPaid,
      outstandingAmount,
      status,
      input.generatedBy || '',
      input.notes || '',
    ]
  );

  if (input.portionId) {
    await query(
      `UPDATE house_portions
         SET total_dues = $2, amount_paid = $3, remaining = $4, previous_dues = $5,
             current_charges = $6, charges_after_discount = $7, per_month_discount = $8,
             status = $9, last_billed_month = $10, updated_at = NOW()
       WHERE id = $1`,
      [input.portionId, totalDue, installmentsPaid, outstandingAmount, previousDues, currentCharges, chargesAfterDiscount, perMonthDiscount, uppercaseStatus(status), input.billMonth]
    );
    return mapInvoice(result.rows[0]);
  }

  await query(
    `UPDATE houses
       SET total_dues = $2,
           amount_paid = $3,
           remaining = $4,
           previous_dues = $5,
           installments_paid = $3,
           outstanding_amount = $4,
           current_charges = $6,
           charges_after_discount = $7,
           per_month_discount = $8,
           status = $9,
           dues_status = $10,
           payment_summary = $11,
           updated_at = NOW()
     WHERE id = $1`,
    [
      input.houseId,
      totalDue,
      installmentsPaid,
      outstandingAmount,
      previousDues,
      currentCharges,
      chargesAfterDiscount,
      perMonthDiscount,
      uppercaseStatus(status),
      duesText(status),
      `Rs ${installmentsPaid.toFixed(2)} dues paid out of Rs ${totalDue.toFixed(2)}`,
    ]
  );

  return mapInvoice(result.rows[0]);
}

async function updateInvoiceStatus(houseId, billMonth, status) {
  const normalized = normalizeStatus(status);
  const result = await query(
    `UPDATE monthly_invoices
      SET status = $3, updated_at = NOW()
      WHERE house_id = $1 AND bill_month = $2
      RETURNING *`,
    [houseId, billMonth, normalized]
  );

  if (result.rowCount > 0) {
    await query(
      `UPDATE houses SET status = $2, dues_status = $3, updated_at = NOW() WHERE id = $1`,
      [houseId, uppercaseStatus(normalized), duesText(normalized)]
    );
  }

  return mapInvoice(result.rows[0]);
}

async function addPayment({ houseId, plotNo, billMonth, invoiceId, amountPaid, notes, receivedBy, portionId = null, portionName = '' }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const invoiceResult = await client.query(
      `SELECT * FROM monthly_invoices WHERE id = $1 AND house_id = $2 AND bill_month = $3 LIMIT 1`,
      [invoiceId, houseId, billMonth]
    );
    const invoiceRow = invoiceResult.rows[0];
    if (!invoiceRow) {
      throw new Error('Invoice not found for selected month');
    }

    const amount = toNumber(amountPaid);
    if (!(amount > 0)) {
      throw new Error('Paid amount must be greater than zero');
    }

    const totalDue = toNumber(invoiceRow.previous_dues) + toNumber(invoiceRow.charges_after_discount);
    const currentPaid = toNumber(invoiceRow.installments_paid);
    const currentOutstanding = toNumber(invoiceRow.outstanding_amount);

    if (amount > currentOutstanding) {
      throw new Error('Paid amount cannot be greater than remaining outstanding amount');
    }

    const paymentInsert = await client.query(
      `INSERT INTO invoice_payments (
        invoice_id, house_id, plot_no, bill_month, amount_paid, payment_date, notes, received_by, portion_id, portion_name, created_at
      ) VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8,$9,NOW()) RETURNING *`,
      [invoiceId, houseId, plotNo, billMonth, amount, notes || '', receivedBy || '', portionId ? Number(portionId) : null, portionName || '']
    );

    const totalPaid = currentPaid + amount;
    const remaining = Math.max(totalDue - totalPaid, 0);
    let status = 'unpaid';
    if (remaining <= 0 && totalDue > 0) status = 'paid';
    else if (totalPaid > 0) status = 'partially_paid';

    const updatedInvoiceResult = await client.query(
      `UPDATE monthly_invoices
         SET installments_paid = $2,
             outstanding_amount = $3,
             status = $4,
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [invoiceId, totalPaid, remaining, status]
    );

    if (portionId) {
      await client.query(
        `UPDATE house_portions SET total_dues = $2, amount_paid = $3, remaining = $4, status = $5, last_billed_month = $6, updated_at = NOW() WHERE id = $1`,
        [portionId, totalDue, totalPaid, remaining, uppercaseStatus(status), billMonth]
      );
      await client.query('COMMIT');
      return { payment: mapPayment(paymentInsert.rows[0]), invoice: mapInvoice(updatedInvoiceResult.rows[0]) };
    }

    await client.query(
      `UPDATE houses
         SET total_dues = $2,
             amount_paid = $3,
             remaining = $4,
             installments_paid = $3,
             outstanding_amount = $4,
             status = $5,
             dues_status = $6,
             payment_summary = $7,
             updated_at = NOW()
       WHERE id = $1`,
      [
        houseId,
        totalDue,
        totalPaid,
        remaining,
        uppercaseStatus(status),
        duesText(status),
        `Rs ${totalPaid.toFixed(2)} dues paid out of Rs ${totalDue.toFixed(2)}`,
      ]
    );

    await client.query('COMMIT');

    return {
      payment: mapPayment(paymentInsert.rows[0]),
      invoice: mapInvoice(updatedInvoiceResult.rows[0]),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  mapInvoice,
  mapPayment,
  normalizeStatus,
  findByHouseId,
  findByHouseIdAndBillMonth,
  findPaymentsByInvoiceId,
  upsertInvoice,
  updateInvoiceStatus,
  addPayment,
};
