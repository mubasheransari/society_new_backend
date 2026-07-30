const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname);
const DB_FILE = path.join(DB_DIR, 'dues.json');

function ensureDbFile() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([] , null, 2), 'utf8');
}

function loadAll() {
  ensureDbFile();
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  try { return JSON.parse(raw) || []; } catch { return []; }
}

function saveAll(rows) {
  ensureDbFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(rows, null, 2), 'utf8');
}

/**
 * Upsert by plotNo (unique key).
 * If plotNo exists => replace old row with new row.
 * Returns { inserted, updated, total }
 */
function upsertMany(newRows) {
  const rows = loadAll();

  // Map existing by plotNo (case-insensitive)
  const idxByPlot = new Map();
  rows.forEach((r, i) => {
    const k = (r.plotNo || '').toString().trim().toLowerCase();
    if (k) idxByPlot.set(k, i);
  });

  let inserted = 0;
  let updated = 0;

  newRows.forEach((nr) => {
    const k = (nr.plotNo || '').toString().trim().toLowerCase();
    if (!k) return;

    if (idxByPlot.has(k)) {
      const i = idxByPlot.get(k);
      rows[i] = { ...rows[i], ...nr, updatedAt: new Date().toISOString() };
      updated++;
    } else {
      rows.push({ ...nr, createdAt: new Date().toISOString() });
      idxByPlot.set(k, rows.length - 1);
      inserted++;
    }
  });

  saveAll(rows);
  return { inserted, updated, total: rows.length };
}


/**
 * Upsert single row by plotNo
 */
function upsertOne(row) {
  if (!row || !row.plotNo) throw new Error('plotNo is required');
  return upsertMany([row]);
}

module.exports = { loadAll, saveAll, upsertMany, upsertOne, DB_FILE };
