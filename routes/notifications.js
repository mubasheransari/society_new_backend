
const express = require('express');
const { query } = require('../config/db');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const userType = String(req.query.userType || '').trim().toLowerCase();
    const userId = Number(req.query.userId || 0);
    if (!userType || !Number.isFinite(userId) || userId <= 0) return res.json([]);
    const result = await query(`SELECT * FROM notifications WHERE user_type=$1 AND user_id=$2 ORDER BY created_at DESC, id DESC LIMIT 50`, [userType, userId]);
    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load notifications' });
  }
});

router.get('/unread-count', async (req, res) => {
  try {
    const userType = String(req.query.userType || '').trim().toLowerCase();
    const userId = Number(req.query.userId || 0);
    if (!userType || !Number.isFinite(userId) || userId <= 0) return res.json({ unread: 0 });
    const result = await query(`SELECT COUNT(*)::int AS unread FROM notifications WHERE user_type=$1 AND user_id=$2 AND is_read=FALSE`, [userType, userId]);
    return res.json({ unread: result.rows[0]?.unread || 0 });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load notification count' });
  }
});

router.post('/read', async (req, res) => {
  try {
    const userType = String(req.body?.userType || '').trim().toLowerCase();
    const userId = Number(req.body?.userId || 0);
    if (!userType || !Number.isFinite(userId) || userId <= 0) return res.status(400).json({ message: 'userType and userId are required' });
    await query(`UPDATE notifications SET is_read=TRUE, read_at=NOW() WHERE user_type=$1 AND user_id=$2 AND is_read=FALSE`, [userType, userId]);
    return res.json({ message: 'Notifications marked as read' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to mark notifications as read' });
  }
});

router.post('/:id/read', async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const userType = String(req.body?.userType || '').trim().toLowerCase();
    const userId = Number(req.body?.userId || 0);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Valid notification id is required' });
    if (!userType || !Number.isFinite(userId) || userId <= 0) return res.status(400).json({ message: 'userType and userId are required' });
    const result = await query(
      `UPDATE notifications SET is_read=TRUE, read_at=NOW() WHERE id=$1 AND user_type=$2 AND user_id=$3 RETURNING *`,
      [id, userType, userId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Notification not found' });
    return res.json({ message: 'Notification marked as read', notification: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to mark notification as read' });
  }
});

module.exports = router;
