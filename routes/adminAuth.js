const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { NAV_KEYS } = require('./adminUsers');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

function allPermissions() {
  return NAV_KEYS.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {});
}

function normalizeRole(role, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedRole = String(role || '').trim().toLowerCase();
  const defaultAdminEmail = String(process.env.ADMIN_EMAIL || 'admin@invoice.com').trim().toLowerCase();

  if (normalizedEmail && normalizedEmail === defaultAdminEmail) return 'super_admin';
  if (normalizedRole === 'super_admin' || normalizedRole === 'superadmin' || normalizedRole === 'super-admin') return 'super_admin';
  if (normalizedRole === 'admin') return 'admin';
  return 'sub_admin';
}

function buildPermissions(row) {
  const role = normalizeRole(row.role, row.email);
  if (role === 'super_admin') return allPermissions();

  const base = row.permissions || {};
  return NAV_KEYS.reduce((acc, key) => {
    acc[key] = Boolean(base[key]);
    return acc;
  }, {});
}

function buildUser(row) {
  const role = normalizeRole(row.role, row.email);
  return {
    id: row.id,
    name: row.name,
    email: String(row.email || '').trim().toLowerCase(),
    role,
    permissions: role === 'super_admin' ? allPermissions() : buildPermissions({ ...row, role }),
  };
}

function createToken(row) {
  const role = normalizeRole(row.role, row.email);
  return jwt.sign({ id: row.id, email: row.email, role }, JWT_SECRET, { expiresIn: '7d' });
}

async function ensureSuperAdmin() {
  const email = String(process.env.ADMIN_EMAIL || 'admin@invoice.com').trim().toLowerCase();
  const name = String(process.env.ADMIN_NAME || 'System Admin').trim();
  const password = String(process.env.ADMIN_PASSWORD || 'Admin@12345');
  const hash = await bcrypt.hash(password, 10);
  await query(
    `INSERT INTO admin_users (name,email,password_hash,role,permissions,is_active,created_at,updated_at)
     VALUES ($1,$2,$3,'super_admin',$4::jsonb,TRUE,NOW(),NOW())
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       role = 'super_admin',
       permissions = EXCLUDED.permissions,
       is_active = TRUE,
       updated_at = NOW()`,
    [name, email, hash, JSON.stringify(allPermissions())]
  );
}

async function authAdmin(req, res, next) {
  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await query('SELECT * FROM admin_users WHERE id=$1 AND is_active=TRUE LIMIT 1', [decoded.id]);
    const admin = result.rows[0];
    if (!admin) return res.status(401).json({ message: 'Unauthorized' });
    req.admin = { ...admin, role: normalizeRole(admin.role, admin.email) };
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

router.post('/login', async (req, res) => {
  try {
    await ensureSuperAdmin();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
    const result = await query('SELECT * FROM admin_users WHERE email=$1 LIMIT 1', [email]);
    const admin = result.rows[0];
    if (!admin || !admin.is_active) return res.status(401).json({ message: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, admin.password_hash || '');
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    const normalizedAdmin = { ...admin, role: normalizeRole(admin.role, admin.email) };

    return res.json({
      message: 'Login successful',
      token: createToken(normalizedAdmin),
      user: buildUser(normalizedAdmin),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Login failed' });
  }
});

router.get('/profile', authAdmin, async (req, res) => {
  return res.json({ user: buildUser(req.admin) });
});

router.post('/change-password', authAdmin, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    if (!currentPassword || !newPassword || !confirmPassword) return res.status(400).json({ message: 'All password fields are required' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });
    if (newPassword !== confirmPassword) return res.status(400).json({ message: 'Password and confirm password must match' });
    const ok = await bcrypt.compare(currentPassword, req.admin.password_hash || '');
    if (!ok) return res.status(400).json({ message: 'Current password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE admin_users SET password_hash=$2, updated_at=NOW() WHERE id=$1', [req.admin.id, hash]);
    return res.json({ message: 'Password updated successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update password' });
  }
});

module.exports = { router, authAdmin, ensureSuperAdmin };
