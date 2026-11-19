const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

router.get('/login', (req, res) => res.render('login', { title: 'Log in' }));
router.get('/register', (req, res) => res.render('register', { title: 'Sign up' }));

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 6) {
      req.session.flash = { type: 'error', msg: 'Please complete all fields. Passwords must be at least 6 characters.' };
      return res.redirect('/register');
    }
    const [exists] = await db.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (exists.length) {
      req.session.flash = { type: 'error', msg: 'An account with this email already exists. Please log in.' };
      return res.redirect('/register');
    }
    const hash = await bcrypt.hash(password, 10);
    const [r] = await db.query('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name.trim(), email.toLowerCase(), hash]);
    req.session.user = { id: r.insertId, name: name.trim() };
    req.session.flash = { type: 'success', msg: 'Your account has been created. Upload your first notes to begin.' };
    res.redirect('/upload');
  } catch (e) { next(e); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const [[user]] = await db.query('SELECT * FROM users WHERE email = ?', [(email || '').toLowerCase()]);
    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
      req.session.flash = { type: 'error', msg: 'Incorrect email or password.' };
      return res.redirect('/login');
    }
    req.session.user = { id: user.id, name: user.name };
    res.redirect('/');
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

module.exports = router;
