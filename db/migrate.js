// Creates tables and applies small upgrades to existing databases.
// Safe to run on every start.
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

async function columnExists(table, column) {
  const [rows] = await db.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, column]
  );
  return rows.length > 0;
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = sql.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
  for (const s of statements) await db.query(s);

  // Upgrades for databases created before these columns existed
  if (!(await columnExists('materials', 'status'))) {
    await db.query("ALTER TABLE materials ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'ready'");
  }
  if (!(await columnExists('materials', 'error'))) {
    await db.query('ALTER TABLE materials ADD COLUMN error VARCHAR(255)');
  }

  // Generation that was interrupted by a restart can never finish: mark it failed so it can be retried
  await db.query(
    "UPDATE materials SET status = 'failed', error = 'Generation was interrupted. Please retry.' WHERE status = 'processing' AND created_at < NOW() - INTERVAL 10 MINUTE"
  );
}

module.exports = migrate;
