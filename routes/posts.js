
const express = require('express');
const { query } = require('../config/db');
const router = express.Router();

function normalizeImageUrls(input, fallback='') {
  const fromArray = Array.isArray(input) ? input : [];
  const clean = fromArray.map((x) => String(x || '').trim()).filter(Boolean);
  if (!clean.length && fallback) clean.push(String(fallback).trim());
  return clean;
}

function normalizeCategory(input) {
  const value = String(input || '').trim().toLowerCase();
  return ['society', 'electricity', 'gas', 'water'].includes(value) ? value : '';
}

function buildPostLink(category) {
  const clean = normalizeCategory(category);
  return clean ? `/resident/posts?category=${encodeURIComponent(clean)}` : '/resident/posts';
}

function mapPost(row) {
  const imageUrls = Array.isArray(row.image_urls) ? row.image_urls : (row.image_url ? [row.image_url] : []);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category || 'society',
    imageUrl: row.image_url || '',
    imageUrls,
    isActive: row.is_active,
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function notifyResidents(title, message, linkUrl = '/resident/posts') {
  try {
    await query(`
      INSERT INTO notifications (user_type, user_id, title, message, link_url, is_read, created_at)
      SELECT 'resident', id, $1, $2, $3, FALSE, NOW()
      FROM residents
      WHERE is_active=TRUE
    `, [title, message, linkUrl]);
  } catch (error) {
    // Backward compatibility for databases that have not run the latest init script yet.
    if (error?.code !== '42703') throw error;
    await query(`
      INSERT INTO notifications (user_type, user_id, title, message, is_read, created_at)
      SELECT 'resident', id, $1, $2, FALSE, NOW()
      FROM residents
      WHERE is_active=TRUE
    `, [title, message]);
  }
}

router.get('/', async (req, res) => {
  try {
    const category = String(req.query?.category || '').trim().toLowerCase();
    const activeOnly = String(req.query?.activeOnly || '').trim() === 'true';
    const params = [];
    let sql = 'SELECT * FROM posts';
    const where = [];
    if (activeOnly) where.push('is_active=TRUE');
    if (category) { params.push(category); where.push(`category=$${params.length}`); }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ' ORDER BY created_at DESC, id DESC';
    const result = await query(sql, params);
    return res.json(result.rows.map(mapPost));
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to load posts' });
  }
});

router.get('/public', async (req, res) => {
  req.query.activeOnly = 'true';
  return router.handle(req, res);
});

router.post('/', async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const category = normalizeCategory(req.body?.category);
    const imageUrls = normalizeImageUrls(req.body?.imageUrls, req.body?.imageUrl);
    const createdBy = String(req.body?.createdBy || 'System Admin').trim();
    const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
    if (!title || !description) return res.status(400).json({ message: 'Title and description are required' });
    if (!category) return res.status(400).json({ message: 'Please select a valid category' });
    const result = await query(
      `INSERT INTO posts (title, description, category, image_url, image_urls, is_active, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,NOW(),NOW()) RETURNING *`,
      [title, description, category, imageUrls[0] || '', JSON.stringify(imageUrls), isActive, createdBy]
    );
    if (isActive) await notifyResidents(`New ${category} update`, title, buildPostLink(category));
    return res.json({ message: 'Post created successfully', post: mapPost(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to create post' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const category = normalizeCategory(req.body?.category);
    const imageUrls = normalizeImageUrls(req.body?.imageUrls, req.body?.imageUrl);
    const isActive = req.body?.isActive === undefined ? true : Boolean(req.body.isActive);
    if (!title || !description) return res.status(400).json({ message: 'Title and description are required' });
    if (!category) return res.status(400).json({ message: 'Please select a valid category' });
    const result = await query(
      `UPDATE posts SET title=$2, description=$3, category=$4, image_url=$5, image_urls=$6::jsonb, is_active=$7, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [id, title, description, category, imageUrls[0] || '', JSON.stringify(imageUrls), isActive]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Post not found' });
    return res.json({ message: 'Post updated successfully', post: mapPost(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update post' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const result = await query('DELETE FROM posts WHERE id=$1 RETURNING id', [id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Post not found' });
    return res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to delete post' });
  }
});

module.exports = router;
