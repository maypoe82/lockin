// Stores login sessions in MySQL so users stay logged in when the server restarts
// (Render's free plan restarts the app after it sleeps).
const session = require('express-session');
const db = require('./db');

class MySQLStore extends session.Store {
  constructor() {
    super();
    // Remove expired sessions every hour
    setInterval(() => db.query('DELETE FROM sessions WHERE expires < ?', [Date.now()]).catch(() => {}), 3600000).unref();
  }

  expiry(sess) {
    const maxAge = sess?.cookie?.maxAge ?? 86400000;
    return Date.now() + maxAge;
  }

  get(sid, cb) {
    db.query('SELECT data, expires FROM sessions WHERE sid = ?', [sid])
      .then(([rows]) => {
        if (!rows.length || Number(rows[0].expires) < Date.now()) return cb(null, null);
        cb(null, JSON.parse(rows[0].data));
      })
      .catch(cb);
  }

  set(sid, sess, cb = () => {}) {
    db.query(
      'INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), expires = VALUES(expires)',
      [sid, JSON.stringify(sess), this.expiry(sess)]
    ).then(() => cb()).catch(cb);
  }

  touch(sid, sess, cb = () => {}) {
    db.query('UPDATE sessions SET expires = ? WHERE sid = ?', [this.expiry(sess), sid]).then(() => cb()).catch(cb);
  }

  destroy(sid, cb = () => {}) {
    db.query('DELETE FROM sessions WHERE sid = ?', [sid]).then(() => cb()).catch(cb);
  }
}

module.exports = MySQLStore;
