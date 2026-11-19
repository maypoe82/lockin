// Creates/upgrades all tables. Usage: npm run db:init
require('dotenv').config({ quiet: true });
const migrate = require('./migrate');

migrate()
  .then(() => { console.log('LockIn tables ready'); process.exit(0); })
  .catch((err) => { console.error('DB init failed:', err.message); process.exit(1); });
