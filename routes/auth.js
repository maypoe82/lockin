const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { loginLimiter, resetLimiter } = require('../middleware/security');
const { sendMail } = require('../services/mail');

const RESET_MINUTES = 60;
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

router.get('/login', (req, res) => res.render('login', { title: 'Log in' }));
router.get('/register', (req, res) => res.render('register', { title: 'Create an account' }));

router.post('/register', loginLimiter, async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 8) {
      req.session.flash = { type: 'error', msg: 'Please complete all fields. Passwords must be at least 8 characters.' };
      return res.redirect('/register');
    }
    const [exists] = await db.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (exists.length) {
      req.session.flash = { type: 'error', msg: 'An account with this email already exists. Please log in.' };
      return res.redirect('/register');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const [r] = await db.query('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name.trim(), email.toLowerCase(), passwordHash]);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: r.insertId, name: name.trim() };
      req.session.flash = { type: 'success', msg: 'Your account has been created. Upload your first notes to begin.' };
      res.redirect('/upload');
    });
  } catch (e) { next(e); }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const [[user]] = await db.query('SELECT * FROM users WHERE email = ?', [(email || '').toLowerCase()]);
    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
      req.session.flash = { type: 'error', msg: 'Incorrect email or password.' };
      return res.redirect('/login');
    }
    // New session ID on login prevents session fixation
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, name: user.name };
      res.redirect('/');
    });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ---------- Forgot password ----------

router.get('/forgot', (req, res) => res.render('forgot', { title: 'Reset your password' }));

router.post('/forgot', resetLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const [[user]] = await db.query('SELECT id, name FROM users WHERE email = ?', [email]);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      await db.query('DELETE FROM password_resets WHERE user_id = ?', [user.id]);
      await db.query('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
        [hash(token), user.id, Date.now() + RESET_MINUTES * 60000]);
      const link = `${req.protocol}://${req.get('host')}/reset/${token}`;
      await sendMail({
        to: email,
        subject: 'Reset your LockIn password',
        text: `Hi ${user.name},\n\nUse this link to set a new LockIn password. It expires in ${RESET_MINUTES} minutes:\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
      }).catch((e) => console.error('Reset email failed:', e.message));
    }
    // Same message whether or not the account exists, so emails cannot be guessed
    req.session.flash = { type: 'success', msg: 'If an account exists for that email, a reset link has been sent. Please check your inbox.' };
    res.redirect('/login');
  } catch (e) { next(e); }
});

async function validReset(token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
  const [[row]] = await db.query('SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?', [hash(token), Date.now()]);
  return row || null;
}

router.get('/reset/:token', async (req, res, next) => {
  try {
    if (!(await validReset(req.params.token))) {
      req.session.flash = { type: 'error', msg: 'This reset link is invalid or has expired. Please request a new one.' };
      return res.redirect('/forgot');
    }
    res.render('reset', { title: 'Choose a new password', token: req.params.token });
  } catch (e) { next(e); }
});

router.post('/reset/:token', resetLimiter, async (req, res, next) => {
  try {
    const row = await validReset(req.params.token);
    if (!row) {
      req.session.flash = { type: 'error', msg: 'This reset link is invalid or has expired. Please request a new one.' };
      return res.redirect('/forgot');
    }
    const { password, confirm } = req.body;
    if (!password || password.length < 8 || password !== confirm) {
      req.session.flash = { type: 'error', msg: 'Passwords must match and be at least 8 characters.' };
      return res.redirect(`/reset/${req.params.token}`);
    }
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 10), row.user_id]);
    await db.query('DELETE FROM password_resets WHERE user_id = ?', [row.user_id]);
    req.session.flash = { type: 'success', msg: 'Your password has been updated. Please log in.' };
    res.redirect('/login');
  } catch (e) { next(e); }
});

module.exports = router;
