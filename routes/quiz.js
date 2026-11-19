const router = require('express').Router();
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');
const ai = require('../services/ai');
const A = require('../services/analytics');

router.use('/quiz', requireLogin);

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

async function ownedMaterial(id, uid) {
  const [[m]] = await db.query('SELECT * FROM materials WHERE id = ? AND user_id = ?', [id, uid]);
  return m;
}

function startQuiz(req, res, { material, questions, mode, heading, topic }) {
  questions.forEach((q) => (q.options = parse(q.options)));
  req.session.quiz = { materialId: material.id, mode, ids: questions.map((q) => q.id), startedAt: Date.now() };
  res.render('quiz', { title: heading, heading, material, questions, mode, topic });
}

// Full assessment: up to 15 questions spread across every topic.
router.get('/quiz/material/:id', async (req, res, next) => {
  try {
    const material = await ownedMaterial(req.params.id, req.session.user.id);
    if (!material) return res.status(404).render('error', { title: '404', message: 'Material not found 💀' });
    const [all] = await db.query('SELECT * FROM questions WHERE material_id = ?', [material.id]);
    // round-robin by topic so every topic gets tested
    const byTopic = {};
    shuffle(all).forEach((q) => (byTopic[q.topic_id] ||= []).push(q));
    const picked = [];
    const buckets = Object.values(byTopic);
    while (picked.length < 15 && buckets.some((b) => b.length)) for (const b of buckets) if (b.length && picked.length < 15) picked.push(b.shift());
    if (!picked.length) {
      req.session.flash = { type: 'error', msg: 'No questions for this material yet 💀' };
      return res.redirect(`/materials/${material.id}`);
    }
    startQuiz(req, res, { material, questions: shuffle(picked), mode: 'full', heading: `Quiz: ${material.title}` });
  } catch (e) { next(e); }
});

// Adaptive "Lock-In" quiz for one weak topic at one difficulty.
// Prefers questions you haven't got right yet; asks the AI for fresh ones when you run out.
router.get('/quiz/lockin', async (req, res, next) => {
  try {
    const uid = req.session.user.id;
    const difficulty = ['easy', 'medium', 'hard'].includes(req.query.difficulty) ? req.query.difficulty : 'easy';
    const [[topic]] = await db.query(
      'SELECT t.* FROM topics t JOIN materials m ON m.id = t.material_id WHERE t.id = ? AND m.user_id = ?', [req.query.topic, uid]);
    if (!topic) return res.status(404).render('error', { title: '404', message: 'Topic not found 💀' });
    topic.notes = parse(topic.notes) || [];

    const want = 5;
    const loadCandidates = async () => {
      const [rows] = await db.query(
        `SELECT q.*, (SELECT COUNT(*) FROM answers an JOIN quiz_attempts qa ON qa.id = an.attempt_id
                       WHERE an.question_id = q.id AND qa.user_id = ? AND an.correct = 1) AS times_right
           FROM questions q WHERE q.topic_id = ? AND q.difficulty = ?`, [uid, topic.id, difficulty]);
      return rows;
    };
    let candidates = await loadCandidates();
    const fresh = candidates.filter((q) => Number(q.times_right) === 0);

    if (fresh.length < want) {
      try {
        const newQs = await ai.generateMoreQuestions(topic, difficulty, want - fresh.length, candidates.map((q) => q.question));
        for (const q of newQs) {
          await db.query(
            `INSERT INTO questions (material_id, topic_id, difficulty, question, options, answer_index, explanation, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'adaptive')`,
            [topic.material_id, topic.id, difficulty, q.question, JSON.stringify(q.options), q.answer_index, q.explanation]);
        }
        candidates = await loadCandidates();
      } catch (err) {
        console.error('Adaptive generation failed, using existing questions:', err.message);
      }
    }
    const ordered = [
      ...shuffle(candidates.filter((q) => Number(q.times_right) === 0)),
      ...shuffle(candidates.filter((q) => Number(q.times_right) > 0)),
    ].slice(0, want);
    if (!ordered.length) {
      req.session.flash = { type: 'error', msg: 'No questions for that topic yet.' };
      return res.redirect('/plan');
    }
    const material = await ownedMaterial(topic.material_id, uid);
    startQuiz(req, res, { material, questions: ordered, mode: 'lockin', topic, heading: `🔒 Lock-In: ${topic.name} (${difficulty})` });
  } catch (e) { next(e); }
});

router.post('/quiz/submit', async (req, res, next) => {
  try {
    const uid = req.session.user.id;
    const quiz = req.session.quiz;
    if (!quiz) return res.redirect('/');
    delete req.session.quiz;

    const [questions] = await db.query('SELECT * FROM questions WHERE id IN (?)', [quiz.ids]);
    let score = 0;
    const graded = questions.map((q) => {
      const raw = req.body[`q_${q.id}`];
      const chosen = raw === undefined ? null : Number(raw);
      const correct = chosen === q.answer_index ? 1 : 0;
      score += correct;
      return { q, chosen, correct };
    });
    const duration = Math.round((Date.now() - quiz.startedAt) / 1000);
    const [attempt] = await db.query(
      'INSERT INTO quiz_attempts (user_id, material_id, mode, score, total, duration_sec) VALUES (?, ?, ?, ?, ?, ?)',
      [uid, quiz.materialId, quiz.mode, score, questions.length, duration]);
    for (const g of graded) {
      await db.query('INSERT INTO answers (attempt_id, question_id, chosen_index, correct) VALUES (?, ?, ?, ?)',
        [attempt.insertId, g.q.id, g.chosen, g.correct]);
    }

    // Quiz time counts as study time (keeps your streak alive) - capped at 30 min
    const studyAwards = await A.logStudy(uid, Math.min(duration, 1800));

    // XP: quiz done + any topic that just hit mastery
    const awards = [await A.awardXP(uid, A.XP.QUIZ, 'Completed a quiz'), ...studyAwards];
    const scores = await A.topicScores(uid, quiz.materialId);
    for (const t of scores) {
      if (t.status === 'strong' && !t.mastered) {
        await db.query('UPDATE topics SET mastered = 1 WHERE id = ?', [t.id]);
        awards.push(await A.awardXP(uid, A.XP.TOPIC_MASTERED, `Mastered ${t.name} 🔥`));
      }
    }
    req.session.awards = { [attempt.insertId]: awards };
    res.redirect(`/quiz/result/${attempt.insertId}`);
  } catch (e) { next(e); }
});

router.get('/quiz/result/:id', async (req, res, next) => {
  try {
    const uid = req.session.user.id;
    const [[attempt]] = await db.query(
      'SELECT qa.*, m.title, m.module_code FROM quiz_attempts qa JOIN materials m ON m.id = qa.material_id WHERE qa.id = ? AND qa.user_id = ?',
      [req.params.id, uid]);
    if (!attempt) return res.status(404).render('error', { title: '404', message: 'Result not found 💀' });

    const [rows] = await db.query(
      `SELECT an.chosen_index, an.correct, q.*, t.name AS topic
         FROM answers an JOIN questions q ON q.id = an.question_id JOIN topics t ON t.id = q.topic_id
        WHERE an.attempt_id = ? ORDER BY an.id`, [attempt.id]);
    rows.forEach((r) => (r.options = parse(r.options)));

    // Per-topic breakdown for THIS attempt
    const breakdown = {};
    for (const r of rows) {
      const b = (breakdown[r.topic_id] ||= { id: r.topic_id, name: r.topic, right: 0, total: 0 });
      b.total++; b.right += r.correct;
    }
    const overall = Object.fromEntries((await A.topicScores(uid, attempt.material_id)).map((t) => [t.id, t]));
    const topics = Object.values(breakdown).map((b) => ({
      ...b, wrong: b.total - b.right, pct: Math.round((b.right / b.total) * 100), overall: overall[b.id]?.score,
    })).sort((a, b) => a.pct - b.pct);

    // 🔒 LOCK IN ALERTs: topics where you dropped 2+ questions, or bombed a small set
    const alerts = topics
      .filter((t) => t.wrong >= 2 || (t.wrong >= 1 && t.pct < A.WEAK_BELOW))
      .map((t) => ({ ...t, minutes: A.revisionMinutes(t.overall ?? t.pct) }));

    const awards = (req.session.awards || {})[attempt.id] || [];
    const pct = attempt.total ? Math.round((attempt.score / attempt.total) * 100) : 0;
    res.render('result', { title: 'Results', attempt, rows, topics, alerts, awards, pct });
  } catch (e) { next(e); }
});

module.exports = router;
