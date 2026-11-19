// Flashcard review (spaced repetition), exam dates, and progress over time.
const router = require('express').Router();
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');
const SR = require('../services/spaced');
const S = require('../services/schedule');
const A = require('../services/analytics');

router.use(['/review', '/progress', '/exams', '/api/flashcards'], requireLogin);

// All flashcards due today across every material
router.get('/review', async (req, res, next) => {
  try {
    const cards = await SR.dueCards(req.session.user.id);
    res.render('review', { title: 'Flashcard review', cards, studyPage: true });
  } catch (e) { next(e); }
});

// Record "Knew it" / "Didn't know" for one flashcard
router.post('/api/flashcards/:id/review', async (req, res, next) => {
  try {
    const result = await SR.review(req.session.user.id, Number(req.params.id), req.body.known === true || req.body.known === 'true');
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, box: result.box, due: result.due });
  } catch (e) { next(e); }
});

// Set or clear an exam date for a module
router.post('/exams', async (req, res, next) => {
  try {
    const moduleCode = String(req.body.module_code || '').toUpperCase().slice(0, 20);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.exam_date || '') ? req.body.exam_date : null;
    if (!moduleCode) return res.redirect('/plan');
    if (date && S.daysBetween(A.localDate(), date) < 0) {
      req.session.flash = { type: 'error', msg: 'Please choose a date in the future.' };
      return res.redirect('/plan');
    }
    await S.setExam(req.session.user.id, moduleCode, date);
    req.session.flash = { type: 'success', msg: date ? `Exam date saved for ${moduleCode}.` : `Exam date removed for ${moduleCode}.` };
    res.redirect('/plan');
  } catch (e) { next(e); }
});

router.get('/progress', async (req, res, next) => {
  try {
    const data = await A.progress(req.session.user.id);
    res.render('progress', { title: 'Progress', ...data });
  } catch (e) { next(e); }
});

module.exports = router;
