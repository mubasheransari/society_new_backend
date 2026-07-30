const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'lhs-resident-secret';

function signResident(row) {
  return jwt.sign(
    {
      residentId: row.id,
      plotNo: row.plot_no,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function mapResident(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    plotNo: row.plot_no,
    email: row.email || '',
    phone: row.phone || '',
    isActive: row.is_active,
  };
}

async function findResidentByPlot(plotNo) {
  const result = await query(
    `
      SELECT *
      FROM residents
      WHERE LOWER(TRIM(plot_no)) = LOWER(TRIM($1))
        AND is_active = TRUE
      LIMIT 1
    `,
    [plotNo]
  );

  return result.rows[0] || null;
}

async function authResident(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const payload = jwt.verify(token, JWT_SECRET);

    const result = await query(
      `
        SELECT *
        FROM residents
        WHERE id = $1
        LIMIT 1
      `,
      [payload.residentId]
    );

    const resident = result.rows[0];

    if (!resident || !resident.is_active) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    req.resident = resident;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

router.post('/login', async (req, res) => {
  try {
    const plotNo = String(req.body?.plotNo || '').trim();
    const password = String(req.body?.password || '').trim();

    console.log('Resident login body:', req.body);
    console.log('Resident login parsed:', { plotNo, passwordLength: password.length });

    if (!plotNo || !password) {
      return res.status(400).json({
        message: 'plotNo and password are required',
      });
    }

    const resident = await findResidentByPlot(plotNo);

    console.log('Resident found:', !!resident);
    console.log('Resident row:', resident
      ? {
          id: resident.id,
          plot_no: resident.plot_no,
          is_active: resident.is_active,
          has_password_hash: !!resident.password_hash,
        }
      : null);

    if (!resident) {
      return res.status(401).json({
        message: 'Invalid credentials',
      });
    }

    const storedHash = String(resident.password_hash || '').trim();
    console.log('Stored hash:', storedHash);

    if (!storedHash) {
      return res.status(401).json({
        message: 'Invalid credentials',
      });
    }

    const ok = await bcrypt.compare(password, storedHash);
    console.log('Password match:', ok);

    if (!ok) {
      return res.status(401).json({
        message: 'Invalid credentials',
      });
    }

    return res.json({
      message: 'Login successful',
      token: signResident(resident),
      resident: mapResident(resident),
    });
  } catch (error) {
    console.error('Resident login error:', error);
    return res.status(500).json({
      message: error.message || 'Login failed',
    });
  }
});

router.get('/profile', authResident, async (req, res) => {
  return res.json({
    resident: mapResident(req.resident),
  });
});

router.post('/change-password', authResident, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '').trim();
    const newPassword = String(req.body?.newPassword || '').trim();
    const confirmPassword = String(req.body?.confirmPassword || '').trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        message: 'All password fields are required',
      });
    }

    const ok = await bcrypt.compare(
      currentPassword,
      req.resident.password_hash || ''
    );

    if (!ok) {
      return res.status(400).json({
        message: 'Current password is incorrect',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: 'New password must be at least 6 characters',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        message: 'Password and confirm password must match',
      });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    await query(
      `
        UPDATE residents
        SET password_hash = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [req.resident.id, hash]
    );

    return res.json({
      message: 'Password updated successfully',
    });
  } catch (error) {
    console.error('Resident change password error:', error);
    return res.status(500).json({
      message: error.message || 'Failed to change password',
    });
  }
});

module.exports = { router, authResident, mapResident };