// Security: secure HTTP headers, rate limiting, and CSRF protection.
const crypto = require('crypto');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

// A fresh nonce per request lets the small inline theme script run under a strict CSP.
function nonce(req, res, next) {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
}

const headers = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
});

function limiter(limit, windowMinutes, message) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      req.session.flash = { type: 'error', msg: message };
      res.status(429).redirect(req.get('Referrer') || '/');
    },
  });
}

const loginLimiter = limiter(10, 15, 'Too many attempts. Please wait 15 minutes and try again.');
const uploadLimiter = limiter(20, 60, 'Upload limit reached. Please try again in an hour.');
const resetLimiter = limiter(5, 60, 'Too many reset requests. Please try again later.');

// CSRF: every form includes a secret token tied to the session.
function csrfToken(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  next();
}

function tokenMatches(req) {
  const sent = req.body?._csrf || req.get('x-csrf-token') || '';
  const real = req.session.csrf || '';
  return sent.length === real.length && sent.length > 0 && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(real));
}

function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Multipart uploads are checked in the route, after the file is parsed.
  if (req.is('multipart/form-data')) return next();
  if (tokenMatches(req)) return next();
  return csrfFailed(req, res);
}

function csrfFailed(req, res) {
  if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Invalid request token' });
  const back = req.get('Referrer');
  if (!back) return res.status(403).render('error', { title: 'Request blocked', message: 'This form has expired. Please go back, refresh the page and try again.' });
  req.session.flash = { type: 'error', msg: 'Your session expired. Please try again.' };
  return res.redirect(back);
}

module.exports = { nonce, headers, loginLimiter, uploadLimiter, resetLimiter, csrfToken, verifyCsrf, tokenMatches, csrfFailed };
