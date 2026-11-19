const mysql = require('mysql2/promise');

// Local/Docker: plain connection. Cloud (TiDB Cloud, etc.): set DB_SSL=true.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'lockin',
  password: process.env.DB_PASSWORD || 'lockin',
  database: process.env.DB_NAME || 'lockin',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
});

module.exports = pool;
