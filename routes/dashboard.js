const router = require('express').Router();
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');
const A = require('../services/analytics');

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

router.get('/', (req, res, next) => {
  if (!req.session.user) return res.render('landing', { title: 'LockIn' });
  next();
}, requireLogin, async (req, res, next) => {
  try {
    const uid = req.session.user.id;
    const [stats, scores] = await Promise.all([A.dashboardStats(uid), A.topicScores(uid)]);
    const weak = A.weakTopics(scores);
    const attempted = scores.filter((t) => t.score !== null);
    const knowledge = attempted.length ? Math.round(attempted.reduce((s, t) => s + t.score, 0) / attempted.length) : 0;

    // Group topics by module for the Knowledge bars
    const modules = {};
    for (const t of scores) (modules[t.module_code] ||= []).push(t);

    const [recent] = await db.query(
      `SELECT qa.*, m.title FROM quiz_attempts qa JOIN materials m ON m.id = qa.material_id
        WHERE qa.user_id = ? ORDER BY qa.id DESC LIMIT 5`, [uid]);
    const [[{ n: materialCount }]] = await db.query('SELECT COUNT(*) AS n FROM materials WHERE user_id = ?', [uid]);

    res.render('dashboard', {
      title: 'Dashboard', greeting: greeting(), stats, modules, weak, knowledge,
      opp: weak[0] || null, recent, materialCount,
      untested: scores.filter((t) => t.status === 'new').length,
    });
  } catch (e) { next(e); }
});

router.get('/plan', requireLogin, async (req, res, next) => {
  try {
    const scores = await A.topicScores(req.session.user.id);
    const weak = A.weakTopics(scores);
    res.render('plan', { title: 'Revision Plan', plan: A.buildPlan(weak), totalTopics: scores.length });
  } catch (e) { next(e); }
});

// Called by public/js/app.js every minute while you're on a study page.
router.post('/api/study-ping', requireLogin, async (req, res, next) => {
  try {
    const seconds = Math.min(Number(req.body.seconds) || 0, 120);
    const awards = await A.logStudy(req.session.user.id, seconds);
    res.json({ ok: true, awards });
  } catch (e) { next(e); }
});

module.exports = router;
