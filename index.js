require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const duesRoutes = require('./routes/dues');
const nocRoutes = require('./routes/noc');
const { router: adminUsersRoutes } = require('./routes/adminUsers');
const { router: adminAuthRoutes } = require('./routes/adminAuth');
const postsRoutes = require('./routes/posts');
const complaintsRoutes = require('./routes/complaints');
const residentRoutes = require('./routes/resident');
const notificationsRoutes = require('./routes/notifications');
const { router: residentAuthRoutes } = require('./routes/residentAuth');
const { parseExcel } = require('./db/excel');
const { query } = require('./config/db');
const housesRepo = require('./db/repositories/housesRepo');

const { ensureChargesCache } = require('./db/maintenanceCharges');

const app = express();

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// Warm the category-charges cache (backed by Postgres) before handling any
// request. Cheap no-op once warmed; needed per cold-start on serverless.
app.use(async (_req, _res, next) => {
  try {
    await ensureChargesCache();
  } catch (error) {
    console.error('Failed to warm category charges cache:', error.message);
  }
  next();
});

app.get('/health', async (_, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, database: 'postgresql' });
  } catch (error) {
    res.status(500).json({ ok: false, database: 'postgresql', error: error.message });
  }
});

app.use('/api/dues', duesRoutes);
app.use('/api/noc', nocRoutes);
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin-users', adminUsersRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/complaints', complaintsRoutes);
app.use('/api/resident/auth', residentAuthRoutes);
app.use('/api/resident', residentRoutes);
app.use('/api/notifications', notificationsRoutes);

app.post('/api/dues/seed', async (req, res) => {
  try {
    const existing = await housesRepo.findAll();
    if (existing.length > 0) {
      return res.json({ message: 'Already seeded', total: existing.length });
    }

    const seedPath = path.join(__dirname, 'data', 'dues.xlsx');
    const parsed = parseExcel(seedPath);
    let inserted = 0;
    for (const item of parsed) {
      await housesRepo.upsertHouse(item);
      inserted += 1;
    }
    return res.json({ message: 'Seeded from data/dues.xlsx', inserted, total: inserted });
  } catch (error) {
    console.error('Seed failed:', error);
    return res.status(400).json({ message: error.message || 'Seed failed' });
  }
});

const PORT = process.env.PORT || 4000;

if (require.main === module) {
  // Running directly (e.g. `node index.js` / `npm start` locally, or on a
  // traditional host like Render/Railway) — start a normal HTTP server.
  app.listen(PORT, () => console.log(`✅ Backend running on http://localhost:${PORT}`));
}

// Exported so Vercel's Node serverless runtime (via api/index.js) can use
// this as a request handler instead of calling app.listen().
module.exports = app;
