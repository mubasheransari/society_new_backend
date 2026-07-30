const crypto = require('crypto');
const express = require('express');
const { query } = require('../config/db');
const { authResident } = require('./residentAuth');
const QRCode = require('qrcode');
const housesRepo = require('../db/repositories/housesRepo');
const invoicesRepo = require('../db/repositories/invoicesRepo');
const nocsRepo = require('../db/repositories/nocsRepo');
const { normalizeBillMonth, formatBillMonthLabel } = require('../db/monthlyInvoices');
const { enrichRow } = require('../db/maintenanceCharges');

const router = express.Router();

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const num = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : 0;
}

const TEMPLATE_META = {
  sale: { label: 'NOC FOR SALE', required: ['relationType', 'relationName', 'plotMeasureSqYds'] },
  noDues: { label: 'NO DUES CERTIFICATE', required: ['relationType', 'relationName', 'plotMeasureSqYds', 'duesClearedUpTo'] },
  water: { label: 'NOC FOR WATER CONNECTION', required: ['relationType', 'relationName', 'plotMeasureSqYds', 'cnic'] },
  gas: { label: 'NOC FOR SUPPLY OF GAS CONNECTION', required: ['relationType', 'relationName', 'plotMeasureSqYds', 'ownerType'] },
  electricity: { label: 'NOC FOR SUPPLY OF ELECTRICITY CONNECTION', required: ['relationType', 'relationName', 'plotMeasureSqYds', 'ownerType'] },
  building: { label: 'FORWARDED FOR APPROVAL OF BUILDING PLAN', required: ['relationType', 'relationName', 'plotMeasureSqYds', 'buildingType', 'transferredName'] },
  verification: { label: 'VERIFICATION', required: ['relationType', 'relationName', 'plotMeasureSqYds'] },
  construction: { label: 'NOC FOR CONSTRUCTION', required: ['relationType', 'relationName', 'plotMeasureSqYds'] },
  transfer: { label: 'TRANSFER OF PLOT', required: ['relationType', 'relationName', 'plotMeasureSqYds'] },
};

function buildNocNumber() {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `NOC-${ymd}-${rand}`;
}

function buildQrValue(nocNumber) {
  return nocNumber;
}

function validateRequired(templateKey, payload) {
  const template = TEMPLATE_META[templateKey];
  if (!template) return 'Invalid NOC type';
  for (const field of template.required) {
    if (!String(payload[field] || '').trim()) {
      return `${field} is required`;
    }
  }
  return null;
}

function mapSigningAuthority() {
  return {
    name: 'MALIK FAHAD',
    designation: 'SECRETARY',
    organization: 'Lucknow Co-operative Housing Society Ltd',
  };
}

async function ensureNocRequestsTable() {
  await query(`CREATE TABLE IF NOT EXISTS noc_requests (
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
  )`);
  await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS plot_no VARCHAR(50) DEFAULT ''`);
  await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS request_type VARCHAR(50) NOT NULL DEFAULT 'general'`);
  await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''`);
  await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'PENDING'`);
  await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS admin_message TEXT DEFAULT ''`);
  await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS updates JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await query(`ALTER TABLE noc_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
}

function normalizeImages(input) {
  return (Array.isArray(input) ? input : []).map((x) => String(x || '').trim()).filter(Boolean);
}

function safeUpdates(input) {
  const base = Array.isArray(input) ? input : [];
  return base.filter(Boolean).map((u) => ({
    sender: String(u.sender || '').trim() || 'system',
    message: String(u.message || '').trim(),
    imageUrls: normalizeImages(u.imageUrls),
    createdAt: u.createdAt || new Date().toISOString(),
  }));
}

function mapNocRequest(row) {
  const updates = safeUpdates(row.updates);
  if (!updates.length) {
    if (row.notes) updates.push({ sender: 'resident', message: row.notes, imageUrls: [], createdAt: row.created_at });
    if (row.admin_message) updates.push({ sender: 'admin', message: row.admin_message, imageUrls: [], createdAt: row.updated_at || row.created_at });
  }
  return {
    id: row.id,
    residentId: row.resident_id,
    residentName: row.resident_name,
    plotNo: row.plot_no,
    plot_no: row.plot_no,
    requestType: row.request_type,
    request_type: row.request_type,
    notes: row.notes || '',
    status: row.status || 'PENDING',
    adminMessage: row.admin_message || '',
    admin_message: row.admin_message || '',
    updates,
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  };
}

async function notify(userType, userId, title, message) {
  await query(`INSERT INTO notifications (user_type, user_id, title, message, is_read, created_at) VALUES ($1,$2,$3,$4,FALSE,NOW())`, [userType, userId, title, message]);
}

async function getNocRequestJoined(id) {
  const joined = await query(`SELECT nr.*, r.full_name AS resident_name, r.plot_no FROM noc_requests nr JOIN residents r ON r.id = nr.resident_id WHERE nr.id=$1`, [id]);
  return joined.rows[0];
}

async function findHouseByAnyPlot(q) {
  let house = await housesRepo.findByPlotNo(q);
  if (!house) {
    const matches = await housesRepo.findAll(q);
    house = matches.find((item) => item.plotNo.toLowerCase() === q.toLowerCase()) || matches[0] || null;
  }
  return house;
}

router.get('/', async (req, res) => {
  try {
    await nocsRepo.ensureTable();
    const q = (req.query.plot || req.query.house || req.query.plotNo || '').toString().trim();
    if (!q) return res.status(400).json({ message: 'plot (Plot No.) is required' });

    const house = await findHouseByAnyPlot(q);
    if (!house) return res.status(404).json({ message: 'No record found' });

    const invoices = await invoicesRepo.findByHouseId(house.id);
    const currentBillMonth = normalizeBillMonth();
    const currentMonthInvoice = invoices.find((item) => item.billMonth === currentBillMonth) || null;
    const row = enrichRow(house);
    const remaining = toNumber(currentMonthInvoice?.outstandingAmount ?? row.remaining ?? 0);
    const canIssue = remaining <= 0;
    const nocHistory = await nocsRepo.listByPlotNo(row.plotNo);

    return res.json({
      plotNo: row.plotNo,
      ownerName: row.ownerName || '',
      contact: row.contact || '',
      ownerCnic: row.ownerCnic || '',
      plotMeasureSqYds: row.plotMeasureSqYds || '',
      relationType: row.relationType || '',
      relationName: row.relationName || '',
      totalDues: toNumber(currentMonthInvoice?.previousDues) + toNumber(currentMonthInvoice?.chargesAfterDiscount ?? row.monthlyChargesAfterDiscount),
      amountPaid: toNumber(currentMonthInvoice?.installmentsPaid ?? row.amountPaid),
      remaining,
      previousDues: toNumber(currentMonthInvoice?.previousDues ?? row.previousDues),
      duesStatus: row.duesStatus || '',
      poNo: row.poNo || '',
      poDate: row.poDate || null,
      chargeCategory: row.chargeCategory || '',
      chargeCategoryLabel: row.chargeCategoryLabel || '',
      monthlyCharges: toNumber(currentMonthInvoice?.chargesAfterDiscount ?? row.monthlyChargesAfterDiscount),
      currentBillMonth,
      currentBillMonthLabel: formatBillMonthLabel(currentBillMonth),
      currentMonthStatus: currentMonthInvoice?.status || 'unpaid',
      currentMonthInvoice,
      canIssue,
      issuedAt: new Date().toISOString(),
      templateMeta: TEMPLATE_META,
      nocHistory,
      signingAuthority: mapSigningAuthority(),
    });
  } catch (error) {
    console.error('NOC search failed:', error);
    return res.status(500).json({ message: 'Failed to fetch NOC record' });
  }
});

async function generateNocCore({ plotNo, nocType, payload, issuedByAdminId }) {
  const house = await findHouseByAnyPlot(plotNo);
  if (!house) {
    const err = new Error('Plot not found');
    err.status = 404;
    throw err;
  }

  const invoices = await invoicesRepo.findByHouseId(house.id);
  const currentBillMonth = normalizeBillMonth();
  const currentMonthInvoice = invoices.find((item) => item.billMonth === currentBillMonth) || null;
  const row = enrichRow(house);
  const remaining = toNumber(currentMonthInvoice?.outstandingAmount ?? row.remaining ?? 0);
  if (remaining > 0) {
    const err = new Error('Cannot generate NOC. Outstanding dues exist.');
    err.status = 400;
    err.result = { plotNo: row.plotNo, remaining };
    throw err;
  }

  const validationError = validateRequired(nocType, payload);
  if (validationError) {
    const err = new Error(validationError);
    err.status = 400;
    throw err;
  }

  const nocNumber = buildNocNumber();
  const qrValue = buildQrValue(nocNumber);
  const qrImage = await QRCode.toDataURL(qrValue, { margin: 1, width: 180 });
  const noc = await nocsRepo.createNoc({
    id: crypto.randomUUID(),
    nocNumber,
    qrValue,
    qrImage,
    nocType,
    plotNo: row.plotNo,
    plotMeasureSqYds: payload.plotMeasureSqYds,
    applicantName: payload.applicantName,
    relationType: payload.relationType,
    relationName: payload.relationName,
    ownerType: payload.ownerType,
    cnic: payload.cnic,
    duesClearedUpTo: payload.duesClearedUpTo,
    buildingType: payload.buildingType,
    transferredName: payload.transferredName,
    remarks: payload.remarks,
    status: 'ACTIVE',
    issuedByAdminId: issuedByAdminId || null,
  });
  return noc;
}

router.post('/generate', async (req, res) => {
  try {
    await nocsRepo.ensureTable();
    const plotNo = String(req.body?.plotNo || '').trim();
    const nocType = String(req.body?.nocType || '').trim();
    if (!plotNo) return res.status(400).json({ isSuccess: false, message: 'plotNo is required' });
    if (!nocType) return res.status(400).json({ isSuccess: false, message: 'nocType is required' });

    const payload = {
      applicantName: String(req.body?.applicantName || '').trim(),
      relationType: String(req.body?.relationType || '').trim(),
      relationName: String(req.body?.relationName || '').trim(),
      ownerType: String(req.body?.ownerType || '').trim(),
      plotMeasureSqYds: String(req.body?.plotMeasureSqYds || '').trim(),
      cnic: String(req.body?.cnic || '').trim(),
      duesClearedUpTo: req.body?.duesClearedUpTo || null,
      buildingType: String(req.body?.buildingType || '').trim(),
      transferredName: String(req.body?.transferredName || '').trim(),
      remarks: String(req.body?.remarks || '').trim(),
    };

    if (!payload.applicantName || !payload.plotMeasureSqYds || !payload.cnic || !payload.relationName) {
      const house = await findHouseByAnyPlot(plotNo);
      if (house) {
        const row = enrichRow(house);
        if (!payload.applicantName) payload.applicantName = row.ownerName || '';
        if (!payload.plotMeasureSqYds) payload.plotMeasureSqYds = row.plotMeasureSqYds || '';
        if (!payload.cnic) payload.cnic = row.ownerCnic || '';
        if (!payload.relationName) payload.relationName = row.relationName || '';
        if (!payload.relationType) payload.relationType = row.relationType || '';
      }
    }

    const noc = await generateNocCore({ plotNo, nocType, payload, issuedByAdminId: req.body?.issuedByAdminId });

    return res.json({
      isSuccess: true,
      message: 'NOC generated successfully.',
      result: {
        ...noc,
        signingAuthority: mapSigningAuthority(),
      },
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ isSuccess: false, message: error.message, result: error.result });
    console.error('Generate NOC failed:', error);
    return res.status(500).json({ isSuccess: false, message: error.message || 'Failed to generate NOC' });
  }
});

const REQUEST_TYPE_TO_TEMPLATE = {
  general: 'verification',
  sale: 'sale',
  no_dues: 'noDues',
  nodues: 'noDues',
  water: 'water',
  gas: 'gas',
  electricity: 'electricity',
  building: 'building',
  verification: 'verification',
  construction: 'construction',
  transfer: 'transfer',
};

router.post('/requests/:id/approve', async (req, res) => {
  try {
    await ensureNocRequestsTable();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });

    const current = await getNocRequestJoined(id);
    if (!current) return res.status(404).json({ message: 'NOC request not found' });

    const reqType = String(current.request_type || 'general').trim().toLowerCase();
    const nocType = REQUEST_TYPE_TO_TEMPLATE[reqType] || 'verification';

    const house = await findHouseByAnyPlot(current.plot_no);
    const houseRow = house ? enrichRow(house) : null;
    const applicantName = houseRow?.ownerName || current.resident_name || `Resident ${current.plot_no}`;
    const today = new Date().toISOString().slice(0, 10);

    const autoPayload = {
      applicantName,
      relationType: houseRow?.relationType || 'S/O',
      relationName: houseRow?.relationName || 'N/A',
      ownerType: 'Owner',
      plotMeasureSqYds: houseRow?.plotMeasureSqYds || 'N/A',
      cnic: houseRow?.ownerCnic || 'N/A',
      duesClearedUpTo: today,
      buildingType: 'Residential',
      transferredName: applicantName,
      remarks: current.notes ? `Resident request: ${current.notes}` : 'Approved via resident NOC request.',
    };

    let noc;
    try {
      noc = await generateNocCore({ plotNo: current.plot_no, nocType, payload: autoPayload, issuedByAdminId: req.body?.issuedByAdminId });
    } catch (err) {
      return res.status(err.status || 500).json({ message: err.message || 'Failed to generate NOC', result: err.result });
    }

    const updates = safeUpdates(current.updates);
    const adminMessage = `NOC ${noc.nocNumber} has been generated and issued.`;
    updates.push({ sender: 'admin', message: adminMessage, imageUrls: [], createdAt: new Date().toISOString() });
    await query(`UPDATE noc_requests SET status='APPROVED', admin_message=$2, updates=$3::jsonb, updated_at=NOW() WHERE id=$1`, [id, adminMessage, JSON.stringify(updates)]);
    await notify('resident', current.resident_id, 'NOC issued', adminMessage);
    const joined = await getNocRequestJoined(id);
    return res.json({ message: `NOC ${noc.nocNumber} generated and request approved.`, request: mapNocRequest(joined), noc });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to approve request' });
  }
});

router.get('/verify/:identifier', async (req, res) => {
  try {
    await nocsRepo.ensureTable();
    const identifier = String(req.params.identifier || '').trim();
    const noc = await nocsRepo.findByIdentifier(identifier);
    if (!noc) {
      return res.status(404).json({ isSuccess: false, message: 'NOC not found' });
    }
    if (noc.status !== 'ACTIVE') {
      return res.status(400).json({
        isSuccess: false,
        message: `This NOC is ${String(noc.status || '').toLowerCase()}.`,
        result: { nocNumber: noc.nocNumber, status: noc.status },
      });
    }

    return res.json({
      isSuccess: true,
      message: 'NOC verified successfully.',
      result: {
        ...noc,
        signingAuthority: mapSigningAuthority(),
      },
    });
  } catch (error) {
    console.error('Verify NOC failed:', error);
    return res.status(500).json({ isSuccess: false, message: error.message || 'Failed to verify NOC' });
  }
});

router.get('/history/:plotNo', async (req, res) => {
  try {
    await nocsRepo.ensureTable();
    const plotNo = String(req.params.plotNo || '').trim();
    if (!plotNo) return res.status(400).json({ isSuccess: false, message: 'plotNo is required' });
    const rows = await nocsRepo.listByPlotNo(plotNo);
    return res.json({ isSuccess: true, message: 'NOC history fetched successfully.', result: rows });
  } catch (error) {
    return res.status(500).json({ isSuccess: false, message: error.message || 'Failed to fetch NOC history' });
  }
});

router.put('/:identifier/revoke', async (req, res) => {
  try {
    await nocsRepo.ensureTable();
    const noc = await nocsRepo.revokeNoc(req.params.identifier);
    if (!noc) return res.status(404).json({ isSuccess: false, message: 'NOC not found' });
    return res.json({ isSuccess: true, message: 'NOC revoked successfully.', result: noc });
  } catch (error) {
    return res.status(500).json({ isSuccess: false, message: error.message || 'Failed to revoke NOC' });
  }
});



router.get('/requests', async (_req, res) => {
  try {
    await ensureNocRequestsTable();
    const result = await query(`SELECT nr.*, r.full_name AS resident_name, r.plot_no FROM noc_requests nr JOIN residents r ON r.id = nr.resident_id ORDER BY nr.updated_at DESC, nr.id DESC`);
    return res.json(result.rows.map(mapNocRequest));
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load NOC requests' });
  }
});

router.post('/requests/mine', authResident, async (req, res) => {
  try {
    await ensureNocRequestsTable();
    const house = await housesRepo.findByPlotNo(req.resident.plot_no);
    if (!house) return res.status(404).json({ message: 'House record not found' });
    const remaining = Number(house.remaining || 0);
    if (remaining > 0) return res.status(400).json({ message: 'Resident can request NOC only when dues are cleared.' });
    const requestType = String(req.body?.requestType || 'general').trim().toLowerCase();
    const notes = String(req.body?.notes || '').trim();
    const initialUpdates = notes ? [{ sender: 'resident', message: notes, imageUrls: [], createdAt: new Date().toISOString() }] : [];
    const existing = await query(`INSERT INTO noc_requests (resident_id, plot_no, request_type, notes, status, updates, created_at, updated_at) VALUES ($1,$2,$3,$4,'PENDING',$5::jsonb,NOW(),NOW()) RETURNING *`, [req.resident.id, req.resident.plot_no, requestType, notes, JSON.stringify(initialUpdates)]);
    await query(`INSERT INTO notifications (user_type, user_id, title, message, is_read, created_at) VALUES ('admin',1,'New NOC request',$1,FALSE,NOW())`, [`Plot ${req.resident.plot_no} requested ${requestType} NOC`]);
    return res.json({ message: 'NOC request submitted successfully', request: mapNocRequest({ ...existing.rows[0], resident_name: req.resident.full_name, plot_no: req.resident.plot_no }) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to request NOC' });
  }
});

router.put('/requests/:id', async (req, res) => {
  try {
    await ensureNocRequestsTable();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const status = String(req.body?.status || 'PENDING').trim().toUpperCase();
    const adminMessage = String(req.body?.adminMessage || '').trim();
    const current = await getNocRequestJoined(id);
    if (!current) return res.status(404).json({ message: 'NOC request not found' });
    const updates = safeUpdates(current.updates);
    const statusLabel = status.charAt(0) + status.slice(1).toLowerCase();
    updates.push({
      sender: 'admin',
      message: adminMessage || `Request ${statusLabel}.`,
      imageUrls: [],
      createdAt: new Date().toISOString(),
    });
    const result = await query(`UPDATE noc_requests SET status=$2, admin_message=$3, updates=$4::jsonb, updated_at=NOW() WHERE id=$1 RETURNING *`, [id, status, adminMessage, JSON.stringify(updates)]);
    await notify('resident', current.resident_id, 'NOC request update', `Your NOC request is now ${status}`);
    const joined = await getNocRequestJoined(id);
    return res.json({ message: 'NOC request updated successfully', request: mapNocRequest(joined) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update NOC request' });
  }
});

router.post('/requests/:id/message', async (req, res) => {
  try {
    await ensureNocRequestsTable();
    const id = Number(req.params.id);
    const sender = String(req.body?.sender || '').trim().toLowerCase();
    const message = String(req.body?.message || '').trim();
    const imageUrls = normalizeImages(req.body?.imageUrls);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    if (!['admin', 'resident'].includes(sender)) return res.status(400).json({ message: 'Invalid sender' });
    if (!message && !imageUrls.length) return res.status(400).json({ message: 'Message or image is required' });
    const current = await getNocRequestJoined(id);
    if (!current) return res.status(404).json({ message: 'NOC request not found' });
    if (['APPROVED', 'DECLINED', 'REJECTED'].includes(String(current.status).toUpperCase())) {
      return res.status(400).json({ message: 'This NOC request is already closed.' });
    }
    const updates = safeUpdates(current.updates);
    updates.push({ sender, message, imageUrls, createdAt: new Date().toISOString() });
    const nextStatus = String(current.status).toUpperCase() === 'PENDING' && sender === 'admin' ? 'REVIEWING' : current.status;
    await query(`UPDATE noc_requests SET updates=$2::jsonb, status=$3, updated_at=NOW() WHERE id=$1`, [id, JSON.stringify(updates), nextStatus]);
    if (sender === 'resident') await notify('admin', 1, 'NOC request reply', `${current.plot_no}: new message on NOC request`);
    else await notify('resident', current.resident_id, 'NOC request reply', 'Your NOC request has a new reply');
    const joined = await getNocRequestJoined(id);
    return res.json({ message: 'Message sent successfully', request: mapNocRequest(joined) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to send message' });
  }
});

module.exports = router;
