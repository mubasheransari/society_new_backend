const { query } = require('../config/db');
const categoryChargesRepo = require('./repositories/categoryChargesRepo');

const DEFAULT_MAINTENANCE_CHARGES = {
  LS: { categoryCode: 'LS', label: 'LS', yard: 98, ownerActualCharges: 3580, ownerDiscountedCharges: 3500, rentalActualCharges: 2500, rentalDiscountedCharges: 2000 },
  A: { categoryCode: 'A', label: 'A', yard: 112, ownerActualCharges: 3700, ownerDiscountedCharges: 3550, rentalActualCharges: 2500, rentalDiscountedCharges: 2000 },
  B: { categoryCode: 'B', label: 'B', yard: 128, ownerActualCharges: 3850, ownerDiscountedCharges: 3550, rentalActualCharges: 2500, rentalDiscountedCharges: 2000 },
  C1: { categoryCode: 'C1', label: 'C1', yard: 135, ownerActualCharges: 4500, ownerDiscountedCharges: 3850, rentalActualCharges: 3000, rentalDiscountedCharges: 2500 },
  C: { categoryCode: 'C', label: 'C', yard: 160, ownerActualCharges: 4550, ownerDiscountedCharges: 4000, rentalActualCharges: 3000, rentalDiscountedCharges: 2500 },
  D: { categoryCode: 'D', label: 'D', yard: 392, ownerActualCharges: 5900, ownerDiscountedCharges: 5500, rentalActualCharges: 4000, rentalDiscountedCharges: 3500 },
  E: { categoryCode: 'E', label: 'E', yard: 544, ownerActualCharges: 6150, ownerDiscountedCharges: 5650, rentalActualCharges: 5000, rentalDiscountedCharges: 4500 },
  F: { categoryCode: 'F', label: 'F', yard: 960, ownerActualCharges: 8000, ownerDiscountedCharges: 8000, rentalActualCharges: 7000, rentalDiscountedCharges: 6500 },
};

const CATEGORY_ALIASES = {
  LS: 'LS', 'LS-98': 'LS', 'LS98': 'LS',
  A: 'A', 'A-112': 'A', 'A112': 'A',
  B: 'B', 'B-128': 'B', 'B128': 'B',
  C1: 'C1', 'C1-135': 'C1', 'C1135': 'C1',
  C: 'C', 'C-160': 'C', 'C160': 'C',
  D: 'D', 'D-392': 'D', 'D392': 'D',
  E: 'E', 'E-544': 'E', 'E544': 'E',
  F: 'F', 'F-960': 'F', 'F960': 'F',
};

function toMoneyNumber(value) {
  const n = Number(String(value ?? 0).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeCategory(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '').replace(/YD$/, '');
  return CATEGORY_ALIASES[raw] || raw || '';
}

function normalizeResidentType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['rent', 'rental', 'tenant'].includes(raw)) return 'rental';
  return 'owner';
}

function normalizeChargeItem(item = {}) {
  const categoryCode = normalizeCategory(item.categoryCode || item.value || item.code || item.label);
  const label = String(item.label || item.categoryCode || item.value || categoryCode || '').trim().toUpperCase();
  const yard = toMoneyNumber(item.yard);

  const legacyMonthly = item.monthlyCharges ?? item.monthlyCharge ?? item.amount;
  const ownerActualCharges = toMoneyNumber(item.ownerActualCharges ?? item.actualCharges ?? item.actualMonthlyCharges ?? item.currentOwnerDues ?? legacyMonthly);
  const ownerDiscountedCharges = toMoneyNumber(item.ownerDiscountedCharges ?? item.discountedCharges ?? item.discountedMonthlyCharges ?? item.revisedOwnerDues ?? legacyMonthly ?? ownerActualCharges);
  const rentalActualCharges = toMoneyNumber(item.rentalActualCharges ?? item.currentRentalDues ?? item.rentalCharges ?? 0);
  const rentalDiscountedCharges = toMoneyNumber(item.rentalDiscountedCharges ?? item.revisedRentalDues ?? item.rentalMonthlyCharges ?? rentalActualCharges);

  return {
    categoryCode,
    label,
    yard,
    ownerActualCharges,
    ownerDiscountedCharges,
    ownerDiscount: Math.max(ownerActualCharges - ownerDiscountedCharges, 0),
    rentalActualCharges,
    rentalDiscountedCharges,
    rentalDiscount: Math.max(rentalActualCharges - rentalDiscountedCharges, 0),
    // Backward-compatible field used by old screens/invoice generation.
    monthlyCharges: ownerDiscountedCharges,
  };
}

// In-memory cache of category charges, warmed from Postgres. Reads elsewhere
// in this file (buildMaintenanceFields, enrichRow, etc.) stay synchronous by
// reading this cache; only the warm-up and write paths talk to the database.
let CACHE = null;

async function warmChargesCache() {
  try {
    const rows = await categoryChargesRepo.findAll();
    if (rows.length) {
      CACHE = rows.map(normalizeChargeItem);
    } else {
      const defaults = Object.values(DEFAULT_MAINTENANCE_CHARGES).map(normalizeChargeItem);
      CACHE = await categoryChargesRepo.replaceAll(defaults).then((saved) => saved.map(normalizeChargeItem));
    }
  } catch (error) {
    console.error('Failed to warm category charges cache from DB:', error.message);
    if (!CACHE) CACHE = Object.values(DEFAULT_MAINTENANCE_CHARGES).map(normalizeChargeItem);
  }
  return CACHE;
}

async function ensureChargesCache() {
  if (!CACHE) await warmChargesCache();
  return CACHE;
}

function readChargeOptions() {
  return CACHE || Object.values(DEFAULT_MAINTENANCE_CHARGES).map(normalizeChargeItem);
}

async function writeChargeOptions(options = []) {
  const clean = options.map(normalizeChargeItem).filter((item) => item.categoryCode);
  if (!clean.length) throw new Error('At least one category charge is required');

  const seen = new Set();
  for (const item of clean) {
    if (seen.has(item.categoryCode)) throw new Error(`Duplicate category: ${item.categoryCode}`);
    seen.add(item.categoryCode);
  }

  const saved = await categoryChargesRepo.replaceAll(clean);
  CACHE = saved.map(normalizeChargeItem);
  return CACHE;
}

function getChargesMap() {
  return readChargeOptions().reduce((acc, item) => {
    acc[item.categoryCode] = item;
    return acc;
  }, {});
}

function getMaintenanceChargeOptions() {
  return readChargeOptions();
}

async function addChargeOption(item = {}) {
  const existing = readChargeOptions();
  const normalized = normalizeChargeItem(item);
  if (!normalized.categoryCode) throw new Error('Category code is required');
  if (existing.some((row) => row.categoryCode === normalized.categoryCode)) {
    throw new Error(`Category ${normalized.categoryCode} already exists`);
  }
  return writeChargeOptions([...existing, normalized]);
}

async function deleteChargeOption(categoryCode) {
  const code = normalizeCategory(categoryCode);
  const existing = readChargeOptions();
  const next = existing.filter((row) => row.categoryCode !== code);
  if (next.length === existing.length) throw new Error('Category not found');
  return writeChargeOptions(next);
}

function inferCategoryFromPlotNo(plotNo) {
  const raw = String(plotNo || '').trim().toUpperCase();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  const prefix = compact.match(/^[A-Z0-9]+/);
  if (!prefix) return '';
  return normalizeCategory(prefix[0]);
}

function getChargeForCategory(categoryCode) {
  const normalized = normalizeCategory(categoryCode);
  const map = getChargesMap();
  return normalized ? map[normalized] : null;
}

function buildMaintenanceFields(input = {}) {
  const explicitCategory = normalizeCategory(input.chargeCategory || input.categoryCode || input.plotCategory);
  const inferredCategory = inferCategoryFromPlotNo(input.plotNo);
  const categoryCode = explicitCategory || inferredCategory || '';
  const config = categoryCode ? getChargeForCategory(categoryCode) : null;
  const residentType = normalizeResidentType(input.residentType || input.occupancyType || input.duesType || input.categoryType);

  const actual = residentType === 'rental'
    ? toMoneyNumber(config?.rentalActualCharges)
    : toMoneyNumber(config?.ownerActualCharges);
  const discounted = residentType === 'rental'
    ? toMoneyNumber(config?.rentalDiscountedCharges)
    : toMoneyNumber(config?.ownerDiscountedCharges);
  const discount = Math.max(actual - discounted, 0);

  return {
    chargeCategory: categoryCode,
    chargeCategoryLabel: config?.label || categoryCode || '',
    categoryYard: toMoneyNumber(config?.yard),
    residentType,
    monthlyCurrentCharges: config ? actual : 0,
    monthlyChargesAfterDiscount: config ? discounted : 0,
    perMonthDiscount: config ? discount : 0,
    ownerActualCharges: toMoneyNumber(config?.ownerActualCharges),
    ownerDiscountedCharges: toMoneyNumber(config?.ownerDiscountedCharges),
    ownerDiscount: toMoneyNumber(config?.ownerDiscount),
    rentalActualCharges: toMoneyNumber(config?.rentalActualCharges),
    rentalDiscountedCharges: toMoneyNumber(config?.rentalDiscountedCharges),
    rentalDiscount: toMoneyNumber(config?.rentalDiscount),
  };
}

function enrichRow(row = {}) {
  const totalDues = toMoneyNumber(row.totalDues);
  const amountPaid = toMoneyNumber(row.amountPaid);
  const remaining = Math.max(totalDues - amountPaid, 0);
  const charges = buildMaintenanceFields(row);
  const plotMeasureSqYds = String(row.plotMeasureSqYds || '').trim() || (charges.categoryYard ? String(charges.categoryYard) : '');

  return {
    ...row,
    totalDues,
    amountPaid,
    remaining,
    ...charges,
    plotMeasureSqYds,
  };
}

async function updateHousesForCategory(categoryCode, chargeConfigOrMonthlyCharges) {
  const normalized = normalizeCategory(categoryCode);
  if (!normalized) return { updated: 0 };

  const config = typeof chargeConfigOrMonthlyCharges === 'object'
    ? normalizeChargeItem(chargeConfigOrMonthlyCharges)
    : (getChargeForCategory(normalized) || normalizeChargeItem({ categoryCode: normalized, monthlyCharges: chargeConfigOrMonthlyCharges }));

  const actual = toMoneyNumber(config.ownerActualCharges);
  const discounted = toMoneyNumber(config.ownerDiscountedCharges);
  const discount = Math.max(actual - discounted, 0);

  const result = await query(
    `UPDATE houses
     SET monthly_current_charges=$1,
         monthly_charges_after_discount=$2,
         current_charges=$1,
         charges_after_discount=$2,
         per_month_discount=$3,
         monthly_discount=$3,
         updated_at=NOW()
     WHERE UPPER(charge_category)=UPPER($4) OR UPPER(charge_category_label)=UPPER($4)`,
    [actual, discounted, discount, normalized],
  );
  return { updated: result.rowCount || 0 };
}

module.exports = {
  MAINTENANCE_CHARGES: DEFAULT_MAINTENANCE_CHARGES,
  ensureChargesCache,
  getMaintenanceChargeOptions,
  writeChargeOptions,
  addChargeOption,
  deleteChargeOption,
  updateHousesForCategory,
  normalizeCategory,
  normalizeResidentType,
  inferCategoryFromPlotNo,
  buildMaintenanceFields,
  getChargeForCategory,
  enrichRow,
};
