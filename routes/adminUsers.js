const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');

const router = express.Router();

const NAV_KEYS = ['dashboard', 'addHouse', 'categoryCharges', 'records', 'generateNoc', 'settings', 'subAdmins', 'posts', 'complaints'];
const DEFAULT_PERMISSIONS = {
  dashboard: true,
  addHouse: false,
  categoryCharges: false,
  records: true,
  generateNoc: true,
  settings: false,
  subAdmins: false,
  posts: true,
  complaints: true,
};

function normalizePermissions(input = {}) {
  return NAV_KEYS.reduce((acc, key) => {
    acc[key] = Boolean(input[key] ?? DEFAULT_PERMISSIONS[key]);
    return acc;
  }, {});
}

async function ensureAdminUsersTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      password_plain TEXT NOT NULL DEFAULT '',
      role VARCHAR(20) NOT NULL DEFAULT 'sub_admin',
      permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_plain TEXT NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'sub_admin'`);
  await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  await query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_unique ON admin_users(email)`);
}

function mapRow(row) {
  if (!row) return null;
  const email = String(row.email || '').trim().toLowerCase();
  const role = email === String(process.env.ADMIN_EMAIL || 'admin@invoice.com').trim().toLowerCase() ? 'super_admin' : row.role;
  return {
    id: row.id,
    name: row.name,
    email,
    role,
    isActive: row.is_active,
    permissions: normalizePermissions(row.permissions || {}),
    password: row.password_plain || '',
    passwordPlain: row.password_plain || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get('/', async (_req, res) => {
  try {
    await ensureAdminUsersTable();
    const result = await query('SELECT * FROM admin_users ORDER BY role ASC, name ASC, id ASC');
    return res.json(result.rows.map(mapRow));
  } catch (error) {
    console.error('List admin users failed:', error);
    return res.status(500).json({ message: error.message || 'Failed to load admin users' });
  }
});

router.post('/', async (req, res) => {
  try {
    await ensureAdminUsersTable();
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '').trim();
    const confirmPassword = String(req.body?.confirmPassword || '').trim();
    const roleInput = String(req.body?.role || 'sub_admin').trim().toLowerCase();
    const role = roleInput === 'super_admin' ? 'super_admin' : (roleInput === 'admin' ? 'admin' : 'sub_admin');
    const permissions = normalizePermissions(req.body?.permissions || {});
    if (!name) return res.status(400).json({ message: 'Name is required' });
    if (!email) return res.status(400).json({ message: 'Email is required' });
    if (!password) return res.status(400).json({ message: 'Password is required' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    if (password !== confirmPassword) return res.status(400).json({ message: 'Password and confirm password must match' });

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO admin_users (name,email,password_hash,password_plain,role,permissions,is_active,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,TRUE,NOW(),NOW())
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         password_plain = EXCLUDED.password_plain,
         role = EXCLUDED.role,
         permissions = EXCLUDED.permissions,
         is_active = TRUE,
         updated_at = NOW()
       RETURNING *`,
      [name, email, passwordHash, password, role, JSON.stringify(permissions)]
    );
    return res.json({ message: role === 'admin' ? 'Admin saved' : 'Sub admin saved', user: mapRow(result.rows[0]) });
  } catch (error) {
    console.error('Save admin user failed:', error);
    return res.status(500).json({ message: error.message || 'Failed to save admin user' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    await ensureAdminUsersTable();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const existing = await query('SELECT * FROM admin_users WHERE id = $1 LIMIT 1', [id]);
    if (!existing.rows[0]) return res.status(404).json({ message: 'User not found' });
    const current = existing.rows[0];
    const name = String(req.body?.name ?? current.name).trim();
    const email = String(req.body?.email ?? current.email).trim().toLowerCase();
    const roleInput = String(req.body?.role ?? current.role).trim().toLowerCase();
    const role = roleInput === 'super_admin' ? 'super_admin' : (roleInput === 'admin' ? 'admin' : 'sub_admin');
    const isActive = req.body?.isActive === undefined ? current.is_active : Boolean(req.body.isActive);
    const permissions = normalizePermissions(req.body?.permissions ?? current.permissions ?? {});

    let passwordHash = current.password_hash;
    let passwordPlain = current.password_plain || '';
    const password = String(req.body?.password || '').trim();
    const confirmPassword = String(req.body?.confirmPassword || '').trim();
    if (password || confirmPassword) {
      if (!password) return res.status(400).json({ message: 'Password is required' });
      if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
      if (password !== confirmPassword) return res.status(400).json({ message: 'Password and confirm password must match' });
      passwordHash = await bcrypt.hash(password, 10);
      passwordPlain = password;
    }

    const result = await query(
      `UPDATE admin_users
         SET name = $2,
             email = $3,
             password_hash = $4,
             password_plain = $5,
             role = $6,
             permissions = $7::jsonb,
             is_active = $8,
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, name, email, passwordHash, passwordPlain, role, JSON.stringify(permissions), isActive]
    );
    return res.json({ message: 'Admin user updated', user: mapRow(result.rows[0]) });
  } catch (error) {
    console.error('Update admin user failed:', error);
    return res.status(500).json({ message: error.message || 'Failed to update admin user' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await ensureAdminUsersTable();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const result = await query('DELETE FROM admin_users WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'User not found' });
    return res.json({ message: 'Admin user deleted' });
  } catch (error) {
    console.error('Delete admin user failed:', error);
    return res.status(500).json({ message: error.message || 'Failed to delete admin user' });
  }
});

module.exports = { router, NAV_KEYS, DEFAULT_PERMISSIONS, normalizePermissions };
