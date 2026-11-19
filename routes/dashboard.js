const router = require('express').Router();
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');
const A = require('../services/analytics');
const S = require('../services/schedule');
const SR = require('../services/spaced');

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
    const [stats, scores, dueCards, exams] = await Promise.all([
      A.dashboardStats(uid), A.topicScores(uid), SR.dueCount(uid), S.examsFor(uid),
    ]);
    const weak = A.weakTopics(scores);
    const attempted = scores.filter((t) => t.score !== null);
    const knowledge = attempted.length ? Math.round(attempted.reduce((s, t) => s + t.score, 0) / attempted.length) : 0;

    const modules = {};
    for (const t of scores) (modules[t.module_code] ||= []).push(t);

    const [recent] = await db.query(
      `SELECT qa.*, m.title FROM quiz_attempts qa JOIN materials m ON m.id = qa.material_id
        WHERE qa.user_id = ? ORDER BY qa.id DESC LIMIT 5`, [uid]);
    const [[{ n: materialCount }]] = await db.query("SELECT COUNT(*) AS n FROM materials WHERE user_id = ? AND status = 'ready'", [uid]);

    // Next upcoming exam
    const today = A.localDate();
    const upcoming = Object.entries(exams)
      .map(([code, date]) => ({ code, date, days: S.daysBetween(today, date) }))
      .filter((e) => e.days >= 0)
      .sort((a, b) => a.days - b.days)[0] || null;

    // Getting-started checklist for new users
    const onboarding = [
      { done: materialCount > 0, label: 'Upload your first lecture notes', href: '/upload' },
      { done: stats.questionsAnswered > 0, label: 'Take your first quiz', href: '/materials' },
      { done: Object.keys(exams).length > 0, label: 'Add an exam date to your Revision Plan', href: '/plan' },
    ];

    res.render('dashboard', {
      title: 'Dashboard', greeting: greeting(), stats, modules, weak, knowledge,
      opp: weak[0] || null, recent, materialCount, dueCards, upcoming,
      onboarding: onboarding.every((s) => s.done) ? null : onboarding,
      untested: scores.filter((t) => t.status === 'new').length,
    });
  } catch (e) { next(e); }
});

router.get('/plan', requireLogin, async (req, res, next) => {
  try {
    const uid = req.session.user.id;
    const [scores, exams] = await Promise.all([A.topicScores(uid), S.examsFor(uid)]);
    const weak = A.weakTopics(scores);

    // One section per module: exam date + day-by-day schedule
    const modules = [...new Set(scores.map((t) => t.module_code))].sort().map((code) => {
      const date = exams[code] || null;
      const schedule = date ? S.buildModuleSchedule(S.topicsNeedingWork(scores.filter((t) => t.module_code === code)), date) : null;
      return { code, date, schedule };
    });

    res.render('plan', {
      title: 'Revision Plan', plan: A.buildPlan(weak), totalTopics: scores.length, modules, today: A.localDate(),
    });
  } catch (e) { next(e); }
});

// Called by public/js/app.js every minute while a study page is open and visible.
router.post('/api/study-ping', requireLogin, async (req, res, next) => {
  try {
    const seconds = Math.min(Number(req.body.seconds) || 0, 120);
    await A.logStudy(req.session.user.id, seconds);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
