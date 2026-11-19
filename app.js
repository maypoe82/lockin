// LockIn - adaptive study platform
require('dotenv').config({ quiet: true });
process.env.TZ = process.env.TZ || 'Asia/Singapore';

const express = require('express');
const session = require('express-session');
const path = require('path');
const { locals } = require('./middleware/auth');
const security = require('./middleware/security');
const MySQLStore = require('./config/sessionStore');
const migrate = require('./db/migrate');
const ai = require('./services/ai');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // Render/most hosts sit behind a proxy (needed for secure cookies + rate limits)
app.disable('x-powered-by');

app.get('/health', (req, res) => res.json({ status: 'ok', ai: ai.provider() })); // for Docker/Render checks

app.use(security.nonce);
app.use(security.headers);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '1h' : 0 }));
app.use(
  session({
    store: new MySQLStore(),
    secret: process.env.SESSION_SECRET || 'change-me-in-env',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 14, httpOnly: true, sameSite: 'lax', secure: isProd },
  })
);
app.use(security.csrfToken);
app.use(locals);
app.use((req, res, next) => { res.locals.aiMode = ai.provider(); next(); });
app.use(security.verifyCsrf);

app.use(require('./routes/auth'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/materials'));
app.use(require('./routes/quiz'));
app.use(require('./routes/study'));

app.use((req, res) => res.status(404).render('error', { title: 'Page not found', message: 'The page you requested does not exist.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: 'Something went wrong. Please try again.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  migrate()
    .catch((e) => console.error('Could not set up database tables:', e.message))
    .finally(() => app.listen(PORT, () => console.log(`LockIn running on http://localhost:${PORT} (AI: ${ai.provider()})`)));
}

module.exports = app;
