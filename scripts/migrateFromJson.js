require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { query } = require('../config/db');
const { normalizeBillMonth, formatBillMonthLabel, buildInvoiceNumber } = require('../db/monthlyInvoices');

async function main() {
  const file = path.join(__dirname, '..', 'db', 'dues.json');
  if (!fs.existsSync(file)) {
    throw new Error('db/dues.json not found.');
  }

  const rows = JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
  let housesCount = 0;
  let invoicesCount = 0;

  for (const row of rows) {
    const houseResult = await query(
      `INSERT INTO houses (
        plot_no, owner_name, dues_status, total_dues, amount_paid, remaining,
        po_no, po_date, address, contact, charge_category, charge_category_label,
        monthly_current_charges, monthly_charges_after_discount, per_month_discount,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12,
        $13,$14,$15,
        COALESCE($16::timestamp, NOW()), COALESCE($17::timestamp, NOW())
      )
      ON CONFLICT (plot_no) DO UPDATE SET
        owner_name = EXCLUDED.owner_name,
        dues_status = EXCLUDED.dues_status,
        total_dues = EXCLUDED.total_dues,
        amount_paid = EXCLUDED.amount_paid,
        remaining = EXCLUDED.remaining,
        po_no = EXCLUDED.po_no,
        po_date = EXCLUDED.po_date,
        address = EXCLUDED.address,
        contact = EXCLUDED.contact,
        charge_category = EXCLUDED.charge_category,
        charge_category_label = EXCLUDED.charge_category_label,
        monthly_current_charges = EXCLUDED.monthly_current_charges,
        monthly_charges_after_discount = EXCLUDED.monthly_charges_after_discount,
        per_month_discount = EXCLUDED.per_month_discount,
        updated_at = NOW()
      RETURNING id, plot_no`,
      [
        row.plotNo,
        row.ownerName || '',
        row.duesStatus || '',
        Number(row.totalDues || 0),
        Number(row.amountPaid || 0),
        Number(row.remaining || 0),
        row.poNo || '',
        row.poDate || null,
        row.address || '',
        row.contact || '',
        row.chargeCategory || '',
        row.chargeCategoryLabel || '',
        Number(row.monthlyCurrentCharges || 0),
        Number(row.monthlyChargesAfterDiscount || 0),
        Number(row.perMonthDiscount || 0),
        row.createdAt || null,
        row.updatedAt || null,
      ]
    );
    housesCount += 1;

    const houseId = houseResult.rows[0].id;
    const plotNo = houseResult.rows[0].plot_no;
    const invoices = Array.isArray(row.invoices) ? row.invoices : [];

    for (const inv of invoices) {
      const billMonth = normalizeBillMonth(inv.billMonth);
      await query(
        `INSERT INTO monthly_invoices (
          house_id, plot_no, bill_month, bill_month_label, invoice_number,
          current_charges, per_month_discount, charges_after_discount,
          previous_dues, installments_paid, outstanding_amount,
          status, generated_at, generated_by, notes, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,
          $9,$10,$11,
          $12,COALESCE($13::timestamp, NOW()),$14,$15,NOW(),NOW()
        ) ON CONFLICT (house_id, bill_month) DO NOTHING`,
        [
          houseId,
          plotNo,
          billMonth,
          inv.billMonthLabel || formatBillMonthLabel(billMonth),
          inv.invoiceNumber || buildInvoiceNumber(plotNo, billMonth),
          Number(inv.currentCharges || 0),
          Number(inv.perMonthDiscount || 0),
          Number(inv.chargesAfterDiscount || 0),
          Number(inv.previousDues || row.totalDues || 0),
          Number(inv.installmentsPaid || row.amountPaid || 0),
          Number(inv.outstandingAmount || row.remaining || 0),
          String(inv.status || 'unpaid').toLowerCase() === 'paid' ? 'paid' : 'unpaid',
          inv.generatedAt || null,
          inv.generatedBy || '',
          inv.notes || '',
        ]
      );
      invoicesCount += 1;
    }
  }

  console.log(`Migration complete. Houses: ${housesCount}, invoices: ${invoicesCount}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
