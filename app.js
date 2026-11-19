// 🔒 LockIn — Stop scrolling. Start locking in.
require('dotenv').config({ quiet: true });
process.env.TZ = process.env.TZ || 'Asia/Singapore';

const express = require('express');
const session = require('express-session');
const path = require('path');
const { locals } = require('./middleware/auth');
const ai = require('./services/ai');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-in-env',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 1 week
  })
);
app.use(locals);
app.use((req, res, next) => { res.locals.aiMode = ai.provider(); next(); });

app.get('/health', (req, res) => res.json({ status: 'ok', ai: ai.provider() })); // for Docker/Jenkins/AWS checks

app.use(require('./routes/auth'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/materials'));
app.use(require('./routes/quiz'));

app.use((req, res) => res.status(404).render('error', { title: '404', message: "This page isn't real 💀" }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: err.message || 'Something broke 💀' });
});

// Create tables on startup if they don't exist (so cloud deploys need no manual setup).
async function ensureSchema() {
  const fs = require('fs');
  const db = require('./config/db');
  const sql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  const statements = sql.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
  for (const s of statements) await db.query(s);
}

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  ensureSchema()
    .catch((e) => console.error('⚠️  Could not set up database tables:', e.message))
    .finally(() => app.listen(PORT, () => console.log(`🔒 LockIn running on http://localhost:${PORT} (AI: ${ai.provider()})`)));
}

module.exports = app;
