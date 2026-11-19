// Blocks pages that need a logged-in user.
function requireLogin(req, res, next) {
  if (req.session.user) return next();
  req.session.flash = { type: 'error', msg: 'Log in first bestie 🔒' };
  res.redirect('/login');
}

// Makes user + flash message available in every EJS view.
function locals(req, res, next) {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  res.locals.path = req.path;
  delete req.session.flash;
  next();
}

module.exports = { requireLogin, locals };
