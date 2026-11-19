// Creates all tables. Usage: npm run db:init
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'lockin',
    password: process.env.DB_PASSWORD || 'lockin',
    database: process.env.DB_NAME || 'lockin',
    multipleStatements: true,
  });
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(sql);
  console.log('✅ LockIn tables ready');
  await conn.end();
}

main().catch((err) => {
  console.error('❌ DB init failed:', err.message);
  process.exit(1);
});
