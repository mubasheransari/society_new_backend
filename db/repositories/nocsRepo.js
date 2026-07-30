const { query, getClient } = require('../../config/db');

function mapNoc(row) {
  if (!row) return null;
  return {
    id: row.id,
    nocNumber: row.noc_number,
    qrValue: row.qr_value,
    qrImage: row.qr_image || null,
    nocType: row.noc_type,
    plotNo: row.plot_no,
    plotMeasureSqYds: row.plot_measure_sq_yds || '',
    applicantName: row.applicant_name || '',
    relationType: row.relation_type || '',
    relationName: row.relation_name || '',
    ownerType: row.owner_type || '',
    cnic: row.cnic || '',
    duesClearedUpTo: row.dues_cleared_up_to ? new Date(row.dues_cleared_up_to).toISOString() : null,
    buildingType: row.building_type || '',
    transferredName: row.transferred_name || '',
    remarks: row.remarks || '',
    status: row.status || 'ACTIVE',
    issuedByAdminId: row.issued_by_admin_id || null,
    issuedAt: row.issued_at ? new Date(row.issued_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS nocs (
      id UUID PRIMARY KEY,
      noc_number VARCHAR(120) UNIQUE NOT NULL,
      qr_value VARCHAR(255) UNIQUE NOT NULL,
      qr_image TEXT DEFAULT '',
      noc_type VARCHAR(50) NOT NULL,
      plot_no VARCHAR(50) NOT NULL,
      plot_measure_sq_yds VARCHAR(50) DEFAULT '',
      applicant_name TEXT NOT NULL DEFAULT '',
      relation_type VARCHAR(10) DEFAULT '',
      relation_name TEXT DEFAULT '',
      owner_type VARCHAR(50) DEFAULT '',
      cnic VARCHAR(30) DEFAULT '',
      dues_cleared_up_to DATE NULL,
      building_type VARCHAR(100) DEFAULT '',
      transferred_name TEXT DEFAULT '',
      remarks TEXT DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      issued_by_admin_id INTEGER NULL,
      issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_nocs_noc_number ON nocs(noc_number)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_nocs_plot_no ON nocs(plot_no)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_nocs_status ON nocs(status)`);
}

async function createNoc(input) {
  const client = await getClient();
  try {
    const result = await client.query(
      `INSERT INTO nocs (
        id, noc_number, qr_value, qr_image, noc_type, plot_no, plot_measure_sq_yds,
        applicant_name, relation_type, relation_name, owner_type, cnic,
        dues_cleared_up_to, building_type, transferred_name, remarks,
        status, issued_by_admin_id, issued_at, expires_at, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,
        $13,$14,$15,$16,
        $17,$18,NOW(),$19,NOW(),NOW()
      ) RETURNING *`,
      [
        input.id,
        input.nocNumber,
        input.qrValue,
        input.qrImage || '',
        input.nocType,
        input.plotNo,
        input.plotMeasureSqYds || '',
        input.applicantName || '',
        input.relationType || '',
        input.relationName || '',
        input.ownerType || '',
        input.cnic || '',
        input.duesClearedUpTo || null,
        input.buildingType || '',
        input.transferredName || '',
        input.remarks || '',
        input.status || 'ACTIVE',
        input.issuedByAdminId || null,
        input.expiresAt || null,
      ]
    );
    return mapNoc(result.rows[0]);
  } finally {
    client.release();
  }
}

async function findByIdentifier(identifier) {
  const result = await query(
    `SELECT * FROM nocs WHERE id::text = $1 OR noc_number = $1 OR qr_value = $1 LIMIT 1`,
    [String(identifier || '').trim()]
  );
  return mapNoc(result.rows[0]);
}

async function listByPlotNo(plotNo) {
  const result = await query(`SELECT * FROM nocs WHERE LOWER(plot_no)=LOWER($1) ORDER BY issued_at DESC, created_at DESC`, [plotNo]);
  return result.rows.map(mapNoc);
}

async function revokeNoc(id) {
  const result = await query(
    `UPDATE nocs SET status='REVOKED', updated_at = NOW() WHERE id::text = $1 OR noc_number = $1 RETURNING *`,
    [String(id || '').trim()]
  );
  return mapNoc(result.rows[0]);
}

module.exports = {
  ensureTable,
  createNoc,
  findByIdentifier,
  listByPlotNo,
  revokeNoc,
  mapNoc,
};
