
const express = require('express');
const { query } = require('../config/db');
const { authResident } = require('./residentAuth');
const router = express.Router();


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

function mapPost(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category || 'society',
    imageUrl: row.image_url || '',
    imageUrls: Array.isArray(row.image_urls) ? row.image_urls : (row.image_url ? [row.image_url] : []),
    isActive: row.is_active,
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get('/dashboard', authResident, async (req, res) => {
  try {
    await ensureNocRequestsTable();
    const [posts, payments, invoices, nocs, complaints, notifCount, nocRequests] = await Promise.all([
      query('SELECT * FROM posts WHERE is_active=TRUE ORDER BY created_at DESC LIMIT 8'),
      query('SELECT * FROM invoice_payments WHERE plot_no=$1 ORDER BY payment_date DESC LIMIT 5', [req.resident.plot_no]),
      query('SELECT * FROM monthly_invoices WHERE plot_no=$1 ORDER BY generated_at DESC LIMIT 20', [req.resident.plot_no]),
      query('SELECT * FROM nocs WHERE LOWER(TRIM(plot_no))=LOWER(TRIM($1)) ORDER BY issued_at DESC LIMIT 10', [req.resident.plot_no]),
      query('SELECT * FROM complaints WHERE resident_id=$1 ORDER BY updated_at DESC LIMIT 10', [req.resident.id]),
      query(`SELECT COUNT(*)::int AS unread FROM notifications WHERE user_type='resident' AND user_id=$1 AND is_read=FALSE`, [req.resident.id]),
      query('SELECT * FROM noc_requests WHERE resident_id=$1 ORDER BY updated_at DESC LIMIT 10', [req.resident.id]),
    ]);

    const invoiceRows = invoices.rows;
    return res.json({
      resident: { id: req.resident.id, fullName: req.resident.full_name, plotNo: req.resident.plot_no },
      summary: {
        unpaidInvoices: invoiceRows.filter((x) => String(x.status).toLowerCase() === 'unpaid').length,
        partiallyPaidInvoices: invoiceRows.filter((x) => String(x.status).toLowerCase() === 'partially_paid').length,
        issuedNocs: nocs.rows.length,
        complaints: complaints.rows.length,
        nocRequests: nocRequests.rows.length,
        unreadNotifications: notifCount.rows[0]?.unread || 0,
      },
      posts: posts.rows.map(mapPost),
      recentPayments: payments.rows,
      recentInvoices: invoiceRows,
      recentNocs: nocs.rows,
      recentComplaints: complaints.rows,
      recentNocRequests: nocRequests.rows,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load dashboard' });
  }
});

router.get('/posts', authResident, async (req, res) => {
  try {
    const category = String(req.query?.category || '').trim().toLowerCase();
    const params = [];
    let sql = 'SELECT * FROM posts WHERE is_active=TRUE';
    if (category) {
      params.push(category);
      sql += ` AND category=$${params.length}`;
    }
    sql += ' ORDER BY created_at DESC, id DESC';
    const result = await query(sql, params);
    return res.json(result.rows.map(mapPost));
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load posts' });
  }
});

router.get('/payments', authResident, async (req, res) => {
  try {
    const result = await query('SELECT * FROM invoice_payments WHERE plot_no=$1 ORDER BY payment_date DESC, id DESC', [req.resident.plot_no]);
    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load payments' });
  }
});

router.get('/invoices', authResident, async (req, res) => {
  try {
    const result = await query('SELECT * FROM monthly_invoices WHERE plot_no=$1 ORDER BY generated_at DESC, id DESC', [req.resident.plot_no]);
    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load invoices' });
  }
});

router.get('/nocs', authResident, async (req, res) => {
  try {
    const result = await query('SELECT * FROM nocs WHERE LOWER(TRIM(plot_no))=LOWER(TRIM($1)) ORDER BY issued_at DESC, id DESC', [req.resident.plot_no]);
    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load NOCs' });
  }
});

router.get('/noc-requests', authResident, async (req, res) => {
  try {
    await ensureNocRequestsTable();
    const result = await query('SELECT * FROM noc_requests WHERE resident_id=$1 ORDER BY updated_at DESC, id DESC', [req.resident.id]);
    return res.json(result.rows.map(mapNocRequest));
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load NOC requests' });
  }
});

router.post('/noc-requests/:id/message', authResident, async (req, res) => {
  try {
    await ensureNocRequestsTable();
    const id = Number(req.params.id);
    const message = String(req.body?.message || '').trim();
    const imageUrls = normalizeImages(req.body?.imageUrls);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    if (!message && !imageUrls.length) return res.status(400).json({ message: 'Message or image is required' });
    const current = await query('SELECT * FROM noc_requests WHERE id=$1 AND resident_id=$2', [id, req.resident.id]);
    const row = current.rows[0];
    if (!row) return res.status(404).json({ message: 'NOC request not found' });
    if (['APPROVED', 'DECLINED', 'REJECTED'].includes(String(row.status).toUpperCase())) {
      return res.status(400).json({ message: 'This NOC request is already closed.' });
    }
    const updates = safeUpdates(row.updates);
    updates.push({ sender: 'resident', message, imageUrls, createdAt: new Date().toISOString() });
    const result = await query('UPDATE noc_requests SET updates=$2::jsonb, updated_at=NOW() WHERE id=$1 RETURNING *', [id, JSON.stringify(updates)]);
    await query(`INSERT INTO notifications (user_type, user_id, title, message, is_read, created_at) VALUES ('admin',1,'NOC request reply',$1,FALSE,NOW())`, [`Plot ${req.resident.plot_no}: new message on NOC request`]);
    return res.json({ message: 'Message sent successfully', request: mapNocRequest(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to send message' });
  }
});

module.exports = router;
