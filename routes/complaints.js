
const express = require('express');
const { query } = require('../config/db');
const { authResident } = require('./residentAuth');
const router = express.Router();

function normalizeImages(input) {
  return (Array.isArray(input) ? input : []).map((x) => String(x || '').trim()).filter(Boolean);
}

function safeUpdates(input, fallback=[]) {
  const base = Array.isArray(input) ? input : [];
  return base.filter(Boolean).map((u) => ({
    sender: String(u.sender || '').trim() || 'system',
    message: String(u.message || '').trim(),
    imageUrls: normalizeImages(u.imageUrls),
    createdAt: u.createdAt || new Date().toISOString(),
  }));
}

function mapComplaint(row) {
  const updates = safeUpdates(row.updates, []);
  if (!updates.length) {
    if (row.description) updates.push({ sender: 'resident', message: row.description, imageUrls: Array.isArray(row.image_urls) ? row.image_urls : [], createdAt: row.created_at });
    if (row.admin_response) updates.push({ sender: 'admin', message: row.admin_response, imageUrls: Array.isArray(row.admin_response_images) ? row.admin_response_images : [], createdAt: row.updated_at || row.created_at });
  }
  return {
    id: row.id,
    residentId: row.resident_id,
    residentName: row.resident_name,
    plotNo: row.plot_no,
    subject: row.subject,
    description: row.description,
    status: row.status,
    adminResponse: row.admin_response || '',
    imageUrls: Array.isArray(row.image_urls) ? row.image_urls : [],
    adminResponseImages: Array.isArray(row.admin_response_images) ? row.admin_response_images : [],
    updates,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function notify(userType, userId, title, message) {
  await query(`INSERT INTO notifications (user_type, user_id, title, message, is_read, created_at) VALUES ($1,$2,$3,$4,FALSE,NOW())`, [userType, userId, title, message]);
}

async function getComplaintJoined(id) {
  const joined = await query(`SELECT c.*, r.full_name AS resident_name, r.plot_no FROM complaints c JOIN residents r ON r.id = c.resident_id WHERE c.id=$1`, [id]);
  return joined.rows[0];
}

router.get('/', async (_req, res) => {
  try {
    const result = await query(`SELECT c.*, r.full_name AS resident_name, r.plot_no FROM complaints c JOIN residents r ON r.id = c.resident_id ORDER BY c.updated_at DESC, c.id DESC`);
    return res.json(result.rows.map(mapComplaint));
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load complaints' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const status = String(req.body?.status || 'OPEN').trim().toUpperCase();
    const adminResponse = String(req.body?.adminResponse || '').trim();
    const adminResponseImages = normalizeImages(req.body?.adminResponseImages);
    const current = await getComplaintJoined(id);
    if (!current) return res.status(404).json({ message: 'Complaint not found' });
    let updates = safeUpdates(current.updates);
    if (adminResponse) {
      const last = updates[updates.length - 1];
      if (!last || last.sender !== 'admin' || last.message !== adminResponse) {
        updates.push({ sender: 'admin', message: adminResponse, imageUrls: adminResponseImages, createdAt: new Date().toISOString() });
      }
    }
    const result = await query(`UPDATE complaints SET status=$2, admin_response=$3, admin_response_images=$4::jsonb, updates=$5::jsonb, updated_at=NOW() WHERE id=$1 RETURNING *`, [id, status, adminResponse, JSON.stringify(adminResponseImages), JSON.stringify(updates)]);
    await notify('resident', current.resident_id, 'Complaint updated', `${current.subject} is now ${status}`);
    const joined = await getComplaintJoined(id);
    return res.json({ message: 'Complaint updated successfully', complaint: mapComplaint(joined) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update complaint' });
  }
});

router.post('/:id/message', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const sender = String(req.body?.sender || '').trim().toLowerCase();
    const message = String(req.body?.message || '').trim();
    const imageUrls = normalizeImages(req.body?.imageUrls);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    if (!['admin', 'resident'].includes(sender)) return res.status(400).json({ message: 'Invalid sender' });
    if (!message && !imageUrls.length) return res.status(400).json({ message: 'Message or image is required' });
    const current = await getComplaintJoined(id);
    if (!current) return res.status(404).json({ message: 'Complaint not found' });
    if (String(current.status).toUpperCase() === 'RESOLVED') return res.status(400).json({ message: 'Resolved complaint cannot be updated' });
    const updates = safeUpdates(current.updates);
    updates.push({ sender, message, imageUrls, createdAt: new Date().toISOString() });
    const nextStatus = String(current.status).toUpperCase() === 'OPEN' ? 'IN_PROGRESS' : String(current.status).toUpperCase();
    await query(`UPDATE complaints SET updates=$2::jsonb, status=$3, updated_at=NOW() WHERE id=$1`, [id, JSON.stringify(updates), nextStatus]);
    if (sender === 'resident') await notify('admin', 1, 'Complaint reply', `${current.plot_no}: ${current.subject}`);
    else await notify('resident', current.resident_id, 'Complaint reply', `${current.subject} has a new reply`);
    const joined = await getComplaintJoined(id);
    return res.json({ message: 'Message sent successfully', complaint: mapComplaint(joined) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to send message' });
  }
});

router.get('/mine', authResident, async (req, res) => {
  try {
    const result = await query(`SELECT c.*, $2::text AS resident_name, $3::text AS plot_no FROM complaints c WHERE resident_id=$1 ORDER BY c.updated_at DESC, c.id DESC`, [req.resident.id, req.resident.full_name, req.resident.plot_no]);
    return res.json(result.rows.map(mapComplaint));
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load complaints' });
  }
});

router.post('/mine', authResident, async (req, res) => {
  try {
    const subject = String(req.body?.subject || '').trim();
    const description = String(req.body?.description || '').trim();
    const imageUrls = normalizeImages(req.body?.imageUrls);
    if (!subject || !description) return res.status(400).json({ message: 'Subject and description are required' });
    const initialUpdates = [{ sender: 'resident', message: description, imageUrls, createdAt: new Date().toISOString() }];
    const result = await query(`INSERT INTO complaints (resident_id, subject, description, status, admin_response, image_urls, admin_response_images, updates, created_at, updated_at) VALUES ($1,$2,$3,'OPEN','',$4::jsonb,'[]'::jsonb,$5::jsonb,NOW(),NOW()) RETURNING *`, [req.resident.id, subject, description, JSON.stringify(imageUrls), JSON.stringify(initialUpdates)]);
    await notify('admin', 1, 'New complaint', `${req.resident.plot_no}: ${subject}`);
    return res.json({ message: 'Complaint submitted successfully', complaint: mapComplaint({ ...result.rows[0], resident_name: req.resident.full_name, plot_no: req.resident.plot_no }) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to submit complaint' });
  }
});

module.exports = router;
