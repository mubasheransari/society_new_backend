const express = require('express');
const multer = require('multer');
const { parseExcel } = require('../db/excel');
const { enrichRow, buildMaintenanceFields, getMaintenanceChargeOptions, writeChargeOptions, addChargeOption, deleteChargeOption, updateHousesForCategory, normalizeCategory } = require('../db/maintenanceCharges');
const { normalizeBillMonth, buildInvoiceNumber, formatBillMonthLabel } = require('../db/monthlyInvoices');
const housesRepo = require('../db/repositories/housesRepo');
const invoicesRepo = require('../db/repositories/invoicesRepo');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function normalizeStatus(value) {
  return invoicesRepo.normalizeStatus(value);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const cleaned = String(value).replace(/,/g, '').trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function toUpperUiStatus(status) {
  const normalized = normalizeStatus(status);
  if (normalized === 'paid') return 'PAID';
  if (normalized === 'partially_paid') return 'PARTIALLY PAID';
  return 'UNPAID';
}

function mapHouseForResponse(house) {
  if (!house) return null;

  const actualMonthlyCharges = toNumber(house.monthlyCurrentCharges ?? house.monthly_current_charges ?? house.currentCharges ?? house.current_charges);
  const monthlyCharges = toNumber(house.monthlyChargesAfterDiscount ?? house.monthly_charges_after_discount ?? house.chargesAfterDiscount ?? house.charges_after_discount);
  const perMonthDiscount = toNumber(house.perMonthDiscount ?? house.per_month_discount ?? house.monthlyDiscount ?? house.monthly_discount);
  const totalDues = toNumber(house.totalDues ?? house.total_dues);
  const amountPaid = toNumber(house.amountPaid ?? house.amount_paid ?? house.installmentsPaid ?? house.installments_paid);
  const remaining = toNumber(house.remaining ?? house.outstandingAmount ?? house.outstanding_amount);
  const resolvedStatus = normalizeStatus(house.status || house.currentMonthStatus || house.duesStatus || house.dues_status || 'unpaid');

  return {
    ...house,
    plotNo: house.plotNo || house.plot_no || '',
    ownerName: house.ownerName || house.owner_name || '',
    category: house.category || house.chargeCategoryLabel || house.charge_category_label || house.chargeCategory || house.charge_category || '',
    chargeCategory: house.chargeCategory || house.charge_category || '',
    chargeCategoryLabel: house.chargeCategoryLabel || house.charge_category_label || '',
    actualMonthlyCharges,
    monthlyCurrentCharges: actualMonthlyCharges,
    monthlyCharges,
    monthlyChargesAfterDiscount: monthlyCharges,
    perMonthDiscount,
    previousDues: toNumber(house.previousDues ?? house.previous_dues),
    totalDues,
    amountPaid,
    remaining,
    poNo: house.poNo || house.po_no || '',
    poDate: house.poDate || house.po_date || null,
    address: house.address || '',
    contact: house.contact || '',
    status: resolvedStatus,
  };
}

async function enrichHouseWithInvoices(house) {
  if (!house) return null;
  const mappedHouse = mapHouseForResponse(house);
  const portions = await housesRepo.findPortionsByHouseId(mappedHouse.id);
  const invoices = await invoicesRepo.findByHouseId(mappedHouse.id);
  const currentBillMonth = normalizeBillMonth();
  const currentMonthInvoice = invoices.find((item) => item.billMonth === currentBillMonth) || null;
  const currentStatus = currentMonthInvoice?.status || normalizeStatus(mappedHouse.status);
  const currentPaid = toNumber(currentMonthInvoice?.installmentsPaid ?? 0);
  const currentRemaining = toNumber(currentMonthInvoice?.outstandingAmount ?? mappedHouse.remaining ?? 0);
  const monthlyCharges = toNumber(currentMonthInvoice?.chargesAfterDiscount ?? mappedHouse.monthlyCharges);
  const previousDues = toNumber(currentMonthInvoice?.previousDues ?? mappedHouse.previousDues);
  return {
    ...enrichRow(mappedHouse),
    ...mappedHouse,
    portions,
    invoices,
    currentBillMonth,
    currentBillMonthLabel: formatBillMonthLabel(currentBillMonth),
    currentMonthStatus: currentStatus,
    currentMonthInvoice,
    currentPaid,
    currentRemaining,
    monthlyCharges,
    previousDues,
    invoicesCount: invoices.length,
    lastGeneratedInvoice: invoices[0] || null,
  };
}

router.get('/charges-config', (_, res) => {
  return res.json(getMaintenanceChargeOptions());
});

router.put('/charges-config', async (req, res) => {
  try {
    const incoming = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.items) ? req.body.items : [];
    const saved = await writeChargeOptions(incoming);
    let updatedHouses = 0;
    for (const item of saved) {
      const result = await updateHousesForCategory(item.categoryCode, item);
      updatedHouses += result.updated || 0;
    }
    return res.json({ message: 'Category charges updated successfully', items: saved, updatedHouses });
  } catch (error) {
    console.error('PUT /api/dues/charges-config failed:', error);
    return res.status(400).json({ message: error.message || 'Failed to update category charges' });
  }
});


router.post('/charges-config', async (req, res) => {
  try {
    const body = req.body || {};
    const saved = await addChargeOption(body);
    const item = saved.find((row) => row.categoryCode === normalizeCategory(body.categoryCode || body.code || body.label));
    return res.status(201).json({ message: 'Category added successfully', item, items: saved });
  } catch (error) {
    console.error('POST /api/dues/charges-config failed:', error);
    return res.status(400).json({ message: error.message || 'Failed to add category' });
  }
});

router.delete('/charges-config/:categoryCode', async (req, res) => {
  try {
    const saved = await deleteChargeOption(req.params.categoryCode);
    return res.json({ message: 'Category deleted successfully', items: saved });
  } catch (error) {
    console.error('DELETE /api/dues/charges-config failed:', error);
    return res.status(400).json({ message: error.message || 'Failed to delete category' });
  }
});

router.patch('/charges-config/:categoryCode', async (req, res) => {
  try {
    const code = String(req.params.categoryCode || '').trim().toUpperCase();
    const existing = getMaintenanceChargeOptions();
    const idx = existing.findIndex((item) => String(item.categoryCode).toUpperCase() === code);
    if (idx === -1) return res.status(404).json({ message: 'Category not found' });
    existing[idx] = {
      ...existing[idx],
      label: String(req.body?.label || existing[idx].label || code).trim(),
      yard: req.body?.yard ?? existing[idx].yard,
      ownerActualCharges: req.body?.ownerActualCharges ?? req.body?.actualCharges ?? existing[idx].ownerActualCharges,
      ownerDiscountedCharges: req.body?.ownerDiscountedCharges ?? req.body?.discountedCharges ?? req.body?.monthlyCharges ?? existing[idx].ownerDiscountedCharges,
      rentalActualCharges: req.body?.rentalActualCharges ?? existing[idx].rentalActualCharges,
      rentalDiscountedCharges: req.body?.rentalDiscountedCharges ?? existing[idx].rentalDiscountedCharges,
    };
    const saved = await writeChargeOptions(existing);
    const changed = saved.find((item) => String(item.categoryCode).toUpperCase() === code);
    const result = await updateHousesForCategory(code, changed || {});
    return res.json({ message: 'Category charge updated successfully', item: changed, updatedHouses: result.updated || 0 });
  } catch (error) {
    console.error('PATCH /api/dues/charges-config failed:', error);
    return res.status(400).json({ message: error.message || 'Failed to update category charge' });
  }
});

router.get('/', async (req, res) => {
  try {
    const q = (req.query.plot || req.query.house || '').toString().trim().toLowerCase();
    const houses = await housesRepo.findAll(q);
    const enriched = await Promise.all(houses.map(enrichHouseWithInvoices));
    return res.json(enriched);
  } catch (error) {
    console.error('GET /api/dues failed:', error);
    return res.status(500).json({ message: 'Failed to fetch records', error: error.message });
  }
});

router.get('/suggestions', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const houses = await housesRepo.findAll(q);
    return res.json(houses.slice(0, 12).map((row) => ({ plotNo: row.plotNo, ownerName: row.ownerName || '' })));
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch suggestions' });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const plotNo = (body.plotNo || body.house || body.plot_no || '').toString().trim();
    if (!plotNo) return res.status(400).json({ message: 'plotNo is required' });

    const previousDues = toNumber(body.previousDues ?? body.totalDues ?? body.total ?? body.total_dues);
    const amountPaid = toNumber(body.amountPaid ?? body.paid ?? body.amount_paid);
    const remaining = Math.max(previousDues - amountPaid, 0);
    const resolvedStatus = previousDues <= 0 || remaining <= 0 ? 'paid' : amountPaid > 0 ? 'partially_paid' : 'unpaid';
    const maintenance = buildMaintenanceFields({
      plotNo,
      chargeCategory: body.chargeCategory || body.categoryCode || body.plotCategory || body.charge_category || body.charge_category_label,
      residentType: body.residentType || body.occupancyType || body.duesType,
    });

    const saved = await housesRepo.upsertHouse({
      plotNo,
      ownerName: (body.ownerName || body.owner || body.owner_name || '').toString().trim(),
      currentResidentName: (body.currentResidentName || body.current_resident_name || '').toString().trim(),
      ownerNumber: (body.ownerNumber || body.owner_number || '').toString().trim(),
      currentResidentNumber: (body.currentResidentNumber || body.current_resident_number || '').toString().trim(),
      status: toUpperUiStatus(resolvedStatus),
      duesStatus: normalizeStatus(resolvedStatus),
      totalDues: previousDues,
      amountPaid,
      remaining,
      outstandingAmount: remaining,
      installmentsPaid: amountPaid,
      previousDues: remaining,
      paymentSummary: `Rs ${amountPaid.toFixed(2)} dues paid out of Rs ${previousDues.toFixed(2)}`,
      poNo: (body.poNo || body.po_no || '').toString().trim(),
      poDate: body.poDate || body.po_date ? new Date(body.poDate || body.po_date).toISOString() : null,
      address: '',
      contact: (body.contact || '').toString().trim(),
      chargeCategoryLabel: (body.chargeCategoryLabel || body.charge_category_label || '').toString().trim(),
      ownerCnic: (body.ownerCnic || body.cnic || body.owner_cnic || '').toString().trim(),
      plotMeasureSqYds: (body.plotMeasureSqYds || body.plotMeasure || body.plot_measure_sq_yds || '').toString().trim(),
      relationType: (body.relationType || body.relation_type || '').toString().trim(),
      relationName: (body.relationName || body.relation_name || '').toString().trim(),
      ...maintenance,
    });

    if (Array.isArray(body.portions)) {
      for (const rawPortion of body.portions) {
        if (!rawPortion || !(rawPortion.portionName || rawPortion.name)) continue;
        const pMaint = buildMaintenanceFields({
          plotNo,
          chargeCategory: rawPortion.chargeCategory || rawPortion.categoryCode || body.chargeCategory || body.plotCategory,
          residentType: rawPortion.residentType || body.residentType || 'owner',
        });
        const pPrevious = toNumber(rawPortion.previousDues ?? 0);
        await housesRepo.upsertPortion({
          plotNo,
          portionName: rawPortion.portionName || rawPortion.name,
          residentName: rawPortion.residentName || '',
          residentNumber: rawPortion.residentNumber || '',
          residentType: rawPortion.residentType || 'owner',
          previousDues: pPrevious,
          totalDues: pPrevious,
          remaining: pPrevious,
          openingMonth: rawPortion.openingMonth || body.openingMonth || normalizeBillMonth(),
          lastBilledMonth: rawPortion.lastBilledMonth || rawPortion.openingMonth || body.openingMonth || normalizeBillMonth(),
          ...pMaint,
        });
      }
    }

    const row = await enrichHouseWithInvoices(saved);
    return res.json({ message: 'Saved', row });
  } catch (error) {
    console.error('POST /api/dues failed:', error);
    return res.status(400).json({ message: error.message || 'Failed to save record' });
  }
});


router.get('/:plotNo/portions', async (req, res) => {
  try {
    const plotNo = String(req.params.plotNo || '').trim();
    if (!plotNo) return res.status(400).json({ message: 'plotNo is required' });
    const portions = await housesRepo.findPortionsByPlotNo(plotNo);
    return res.json(portions);
  } catch (error) {
    console.error('GET portions failed:', error);
    return res.status(500).json({ message: 'Failed to fetch portions', error: error.message });
  }
});

router.post('/:plotNo/portions', async (req, res) => {
  try {
    const plotNo = String(req.params.plotNo || '').trim();
    if (!plotNo) return res.status(400).json({ message: 'plotNo is required' });
    const body = req.body || {};
    const maintenance = buildMaintenanceFields({
      plotNo,
      chargeCategory: body.chargeCategory || body.categoryCode || body.plotCategory || body.charge_category || body.charge_category_label,
      residentType: body.residentType || body.occupancyType || body.duesType,
    });
    const previousDues = toNumber(body.previousDues ?? body.totalDues ?? 0);
    const portion = await housesRepo.upsertPortion({
      plotNo,
      portionName: body.portionName || body.name,
      residentName: body.residentName || body.currentResidentName || '',
      residentNumber: body.residentNumber || body.currentResidentNumber || '',
      residentType: body.residentType || 'owner',
      previousDues,
      totalDues: previousDues,
      amountPaid: toNumber(body.amountPaid ?? 0),
      remaining: previousDues,
      openingMonth: body.openingMonth || normalizeBillMonth(),
      lastBilledMonth: body.lastBilledMonth || body.openingMonth || normalizeBillMonth(),
      ...maintenance,
    });
    return res.status(201).json({ message: 'Portion saved successfully', portion });
  } catch (error) {
    console.error('POST portion failed:', error);
    return res.status(400).json({ message: error.message || 'Failed to save portion' });
  }
});

router.delete('/:plotNo/portions/:portionId', async (req, res) => {
  try {
    const removed = await housesRepo.deletePortion(req.params.portionId);
    if (!removed) return res.status(404).json({ message: 'Portion not found' });
    return res.json({ message: 'Portion deleted successfully' });
  } catch (error) {
    console.error('DELETE portion failed:', error);
    return res.status(400).json({ message: error.message || 'Failed to delete portion' });
  }
});

router.get('/:plotNo/invoices', async (req, res) => {
  try {
    const plotNo = (req.params.plotNo || '').toString().trim();
    if (!plotNo) return res.status(400).json({ message: 'plotNo is required' });

    let house = await housesRepo.findByPlotNo(plotNo);
    if (!house) {
      const matches = await housesRepo.findAll(plotNo);
      house = matches.find((item) => item.plotNo.toLowerCase() === plotNo.toLowerCase()) || matches[0] || null;
    }
    if (!house) return res.status(404).json({ message: 'Record not found' });

    const row = await enrichHouseWithInvoices(house);
    const selectedBillMonth = normalizeBillMonth(req.query.billMonth || row.currentBillMonth);
    const portionId = req.query.portionId ? Number(req.query.portionId) : null;
    const selectedPortion = portionId ? await housesRepo.findPortionById(portionId) : null;
    const scopedInvoices = portionId ? await invoicesRepo.findByHouseId(row.id, portionId) : (row.invoices || []);
    const selectedInvoice = scopedInvoices.find((item) => item.billMonth === selectedBillMonth) || null;
    const payments = selectedInvoice ? await invoicesRepo.findPaymentsByInvoiceId(selectedInvoice.id) : [];

    return res.json({
      plotNo: row.plotNo,
      ownerName: selectedPortion?.residentName || row.ownerName || '',
      contact: selectedPortion?.residentNumber || row.contact || '',
      portionId: selectedPortion?.id || null,
      portionName: selectedPortion?.portionName || '',
      portions: row.portions || [],
      chargeCategory: row.chargeCategory || '',
      chargeCategoryLabel: row.chargeCategoryLabel || '',
      currentBillMonth: row.currentBillMonth,
      currentBillMonthLabel: row.currentBillMonthLabel,
      currentMonthStatus: row.currentMonthStatus,
      actualMonthlyCharges: selectedPortion ? selectedPortion.currentCharges : (row.actualMonthlyCharges || row.monthlyCurrentCharges || 0),
      monthlyCurrentCharges: selectedPortion ? selectedPortion.currentCharges : (row.actualMonthlyCharges || row.monthlyCurrentCharges || 0),
      perMonthDiscount: selectedPortion ? selectedPortion.perMonthDiscount : (row.perMonthDiscount || row.monthlyDiscount || 0),
      monthlyDiscount: selectedPortion ? selectedPortion.perMonthDiscount : (row.perMonthDiscount || row.monthlyDiscount || 0),
      monthlyCharges: selectedPortion ? selectedPortion.chargesAfterDiscount : (row.monthlyCharges || row.monthlyChargesAfterDiscount || 0),
      monthlyChargesAfterDiscount: selectedPortion ? selectedPortion.chargesAfterDiscount : (row.monthlyCharges || row.monthlyChargesAfterDiscount || 0),
      totalDues: selectedPortion ? selectedPortion.totalDues : (row.totalDues || 0),
      amountPaid: selectedPortion ? selectedPortion.amountPaid : (row.amountPaid || 0),
      remaining: selectedPortion ? selectedPortion.remaining : (row.remaining || 0),
      previousDues: selectedPortion ? selectedPortion.previousDues : (row.previousDues || 0),
      selectedBillMonth,
      selectedBillMonthLabel: formatBillMonthLabel(selectedBillMonth),
      selectedInvoice,
      payments,
      invoices: scopedInvoices || [],
    });
  } catch (error) {
    console.error('GET invoices failed:', error);
    return res.status(500).json({ message: 'Failed to fetch invoices', error: error.message });
  }
});

router.post('/:plotNo/generate-invoice', async (req, res) => {
  try {
    const plotNo = (req.params.plotNo || '').toString().trim();
    if (!plotNo) return res.status(400).json({ message: 'plotNo is required' });

    const house = await housesRepo.findByPlotNo(plotNo);
    if (!house) return res.status(404).json({ message: 'Record not found' });

    const normalizedHouse = mapHouseForResponse(house);
    const billMonth = normalizeBillMonth(req.body?.billMonth);
    const portionId = req.body?.portionId ? Number(req.body.portionId) : null;
    const selectedPortion = portionId ? await housesRepo.findPortionById(portionId) : null;
    const chargeSource = selectedPortion || normalizedHouse;
    const existingInvoice = await invoicesRepo.findByHouseIdAndBillMonth(normalizedHouse.id, billMonth, portionId);

    const discountedMonthlyCharges = toNumber(req.body?.monthlyCharges ?? req.body?.chargesAfterDiscount ?? existingInvoice?.chargesAfterDiscount ?? chargeSource.chargesAfterDiscount ?? normalizedHouse.monthlyCharges ?? 0);
    const actualMonthlyCharges = toNumber(req.body?.actualMonthlyCharges ?? req.body?.monthlyCurrentCharges ?? req.body?.currentCharges ?? existingInvoice?.currentCharges ?? chargeSource.currentCharges ?? normalizedHouse.actualMonthlyCharges ?? normalizedHouse.monthlyCurrentCharges ?? discountedMonthlyCharges);
    const perMonthDiscount = toNumber(req.body?.perMonthDiscount ?? req.body?.monthlyDiscount ?? existingInvoice?.perMonthDiscount ?? chargeSource.perMonthDiscount ?? Math.max(actualMonthlyCharges - discountedMonthlyCharges, 0));
    const monthlyCharges = discountedMonthlyCharges;
    const previousDues = toNumber(req.body?.previousDues ?? existingInvoice?.previousDues ?? chargeSource.previousDues ?? normalizedHouse.previousDues ?? normalizedHouse.remaining ?? normalizedHouse.totalDues ?? 0);
    const existingPaid = toNumber(existingInvoice?.installmentsPaid ?? 0);
    const paymentAmount = toNumber(req.body?.paymentAmount ?? 0);
    const totalDue = previousDues + monthlyCharges;
    const interimOutstanding = Math.max(totalDue - existingPaid, 0);
    const interimStatus = interimOutstanding <= 0 && totalDue > 0 ? 'paid' : existingPaid > 0 ? 'partially_paid' : 'unpaid';

    const invoice = await invoicesRepo.upsertInvoice({
      houseId: normalizedHouse.id,
      plotNo: normalizedHouse.plotNo,
      billMonth,
      billMonthLabel: formatBillMonthLabel(billMonth),
      invoiceNumber: req.body?.invoiceNumber || existingInvoice?.invoiceNumber || buildInvoiceNumber(`${normalizedHouse.plotNo}${selectedPortion ? '-' + selectedPortion.portionName : ''}`, billMonth),
      portionId: selectedPortion?.id || null,
      portionName: selectedPortion?.portionName || '',
      currentCharges: actualMonthlyCharges,
      perMonthDiscount,
      chargesAfterDiscount: discountedMonthlyCharges,
      previousDues,
      installmentsPaid: existingPaid,
      outstandingAmount: interimOutstanding,
      status: interimStatus,
      generatedBy: req.body?.generatedBy || '',
      notes: req.body?.notes || '',
    });

    let finalInvoice = invoice;
    if (paymentAmount > 0) {
      const result = await invoicesRepo.addPayment({
        houseId: normalizedHouse.id,
        plotNo: normalizedHouse.plotNo,
        billMonth,
        invoiceId: invoice.id,
        amountPaid: paymentAmount,
        notes: req.body?.paymentNotes || req.body?.notes || '',
        receivedBy: req.body?.generatedBy || '',
        portionId: selectedPortion?.id || null,
        portionName: selectedPortion?.portionName || '',
      });
      finalInvoice = result.invoice;
    }

    const refreshedHouse = await housesRepo.findByPlotNo(plotNo);
    const row = await enrichHouseWithInvoices(refreshedHouse || house);
    const payments = await invoicesRepo.findPaymentsByInvoiceId(finalInvoice.id);
    return res.json({
      message: 'Invoice generated successfully',
      selectedInvoice: finalInvoice,
      payments,
      row,
      plotNo: row.plotNo,
      ownerName: selectedPortion?.residentName || row.ownerName,
      portionId: selectedPortion?.id || null,
      portionName: selectedPortion?.portionName || '',
      portions: row.portions || [],
      actualMonthlyCharges: row.actualMonthlyCharges || row.monthlyCurrentCharges || 0,
      monthlyCurrentCharges: row.actualMonthlyCharges || row.monthlyCurrentCharges || 0,
      perMonthDiscount: row.perMonthDiscount || row.monthlyDiscount || 0,
      monthlyDiscount: row.perMonthDiscount || row.monthlyDiscount || 0,
      monthlyCharges: row.monthlyCharges,
      monthlyChargesAfterDiscount: row.monthlyCharges,
      previousDues: row.previousDues,
      amountPaid: row.amountPaid,
      remaining: row.remaining,
      currentMonthStatus: row.currentMonthStatus,
      invoices: row.invoices,
    });
  } catch (error) {
    console.error('Generate invoice failed:', error);
    return res.status(500).json({ message: error.message || 'Failed to generate invoice' });
  }
});

router.post('/:plotNo/invoices/:billMonth/payments', async (req, res) => {
  try {
    const plotNo = (req.params.plotNo || '').toString().trim();
    const billMonth = normalizeBillMonth(req.params.billMonth);
    const amountPaid = toNumber(req.body?.amountPaid ?? req.body?.paidAmount ?? 0);
    const notes = String(req.body?.notes || '').trim();
    const receivedBy = String(req.body?.receivedBy || '').trim();

    const house = await housesRepo.findByPlotNo(plotNo);
    if (!house) return res.status(404).json({ message: 'Record not found' });

    const portionId = req.body?.portionId ? Number(req.body.portionId) : null;
    const selectedPortion = portionId ? await housesRepo.findPortionById(portionId) : null;
    const invoice = await invoicesRepo.findByHouseIdAndBillMonth(house.id, billMonth, portionId);
    if (!invoice) return res.status(404).json({ message: 'Generate invoice first for this month' });

    const result = await invoicesRepo.addPayment({
      houseId: house.id,
      plotNo: house.plotNo,
      billMonth,
      invoiceId: invoice.id,
      amountPaid,
      notes,
      receivedBy,
      portionId: selectedPortion?.id || null,
      portionName: selectedPortion?.portionName || '',
    });

    const refreshedHouse = await housesRepo.findByPlotNo(plotNo);
    const row = await enrichHouseWithInvoices(refreshedHouse);
    const payments = await invoicesRepo.findPaymentsByInvoiceId(invoice.id);

    return res.json({ message: 'Payment added successfully', invoice: result.invoice, payments, row });
  } catch (error) {
    console.error('Add payment failed:', error);
    return res.status(400).json({ message: error.message || 'Failed to add payment' });
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Excel file is required' });
    const rows = parseExcel(req.file.buffer);
    let inserted = 0;
    for (const item of rows) {
      await housesRepo.upsertHouse(item);
      inserted += 1;
    }
    return res.json({ message: `Uploaded successfully. ${inserted} record(s) processed.` });
  } catch (error) {
    console.error('Upload failed:', error);
    return res.status(400).json({ message: error.message || 'Upload failed' });
  }
});

router.delete('/:plotNo', async (req, res) => {
  try {
    const plotNo = (req.params.plotNo || '').toString().trim();
    if (!plotNo) return res.status(400).json({ message: 'plotNo is required' });
    const removed = await housesRepo.deleteByPlotNo(plotNo);
    if (!removed) return res.status(404).json({ message: 'Not found' });
    return res.json({ message: 'Deleted' });
  } catch (error) {
    console.error('Delete house failed:', error);
    return res.status(500).json({ message: 'Failed to delete record' });
  }
});

module.exports = router;
