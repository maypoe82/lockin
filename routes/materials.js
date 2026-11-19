const router = require('express').Router();
const multer = require('multer');
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');
const { uploadLimiter, tokenMatches, csrfFailed } = require('../middleware/security');
const { pdfToText } = require('../services/pdf');
const ai = require('../services/ai');
const A = require('../services/analytics');
const SR = require('../services/spaced');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf' || /\.(txt|md)$/i.test(file.originalname)),
});

function friendlyAiError(e) {
  if (/busy|429|500|503|timed out|aborted|No Gemini model/i.test(e.message || '')) {
    return 'The AI service is busy at the moment. Please retry in a few minutes.';
  }
  return 'The notes could not be processed. Please retry, or upload a different file.';
}

router.use(['/upload', '/materials', '/mistakes'], requireLogin);

router.get('/upload', (req, res) => res.render('upload', { title: 'Upload notes' }));

router.post('/upload', uploadLimiter, upload.single('file'), async (req, res, next) => {
  if (!tokenMatches(req)) return csrfFailed(req, res);
  const uid = req.session.user.id;
  try {
    let text = (req.body.text || '').trim();
    if (req.file) {
      text = req.file.mimetype === 'application/pdf' ? await pdfToText(req.file.buffer) : req.file.buffer.toString('utf8');
    }
    if (text.length < 200) {
      req.session.flash = { type: 'error', msg: 'Not enough text was found. Scanned PDFs without selectable text cannot be read.' };
      return res.redirect('/upload');
    }
    const moduleCode = (req.body.module_code || 'GENERAL').trim().toUpperCase().slice(0, 20);
    const title = (req.body.title || req.file?.originalname || 'My notes').trim().slice(0, 200);

    const [m] = await db.query(
      "INSERT INTO materials (user_id, module_code, title, raw_text, status) VALUES (?, ?, ?, ?, 'processing')",
      [uid, moduleCode, title, text]
    );
    generate(m.insertId); // runs in the background; the page polls for the result
    res.redirect(`/materials/${m.insertId}`);
  } catch (e) {
    next(e);
  }
});

// Generate the study pack for a material and save it. Never throws.
async function generate(materialId) {
  try {
    const [[material]] = await db.query('SELECT * FROM materials WHERE id = ?', [materialId]);
    if (!material) return;
    const pack = await ai.generateStudyPack(material.raw_text, material.module_code);
    await savePack(materialId, pack);
  } catch (e) {
    console.error(`Generation failed for material ${materialId}:`, e.message);
    await db.query("UPDATE materials SET status = 'failed', error = ? WHERE id = ?", [friendlyAiError(e), materialId]).catch(() => {});
  }
}

async function savePack(materialId, pack) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM topics WHERE material_id = ?', [materialId]); // clean slate on retry
    for (const t of pack.topics) {
      const [tr] = await conn.query(
        'INSERT INTO topics (material_id, name, learn, brainrot, notes) VALUES (?, ?, ?, ?, ?)',
        [materialId, t.name, t.learn, t.brainrot, JSON.stringify(t.notes)]
      );
      for (const f of t.flashcards) {
        await conn.query('INSERT INTO flashcards (material_id, topic_id, front, back) VALUES (?, ?, ?, ?)', [materialId, tr.insertId, f.front, f.back]);
      }
      for (const q of t.questions) {
        await conn.query(
          'INSERT INTO questions (material_id, topic_id, difficulty, question, options, answer_index, explanation) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [materialId, tr.insertId, q.difficulty, q.question, JSON.stringify(q.options), q.answer_index, q.explanation]
        );
      }
    }
    await conn.query("UPDATE materials SET summary = ?, status = 'ready', error = NULL WHERE id = ?", [pack.summary, materialId]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

router.get('/materials', async (req, res, next) => {
  try {
    const [materials] = await db.query(
      `SELECT m.id, m.module_code, m.title, m.created_at, m.status,
              (SELECT COUNT(*) FROM topics t WHERE t.material_id = m.id) AS topic_count,
              (SELECT COUNT(*) FROM questions q WHERE q.material_id = m.id) AS question_count
         FROM materials m WHERE m.user_id = ? ORDER BY m.id DESC`, [req.session.user.id]);
    res.render('materials', { title: 'My notes', materials });
  } catch (e) { next(e); }
});

async function ownedMaterial(id, uid) {
  const [[m]] = await db.query('SELECT * FROM materials WHERE id = ? AND user_id = ?', [id, uid]);
  return m;
}

router.get('/materials/:id/status', async (req, res, next) => {
  try {
    const m = await ownedMaterial(req.params.id, req.session.user.id);
    if (!m) return res.status(404).json({ status: 'missing' });
    res.json({ status: m.status, error: m.error });
  } catch (e) { next(e); }
});

router.post('/materials/:id/retry', async (req, res, next) => {
  try {
    const m = await ownedMaterial(req.params.id, req.session.user.id);
    if (!m) return res.redirect('/materials');
    await db.query("UPDATE materials SET status = 'processing', error = NULL, created_at = NOW() WHERE id = ?", [m.id]);
    generate(m.id);
    res.redirect(`/materials/${m.id}`);
  } catch (e) { next(e); }
});

router.get('/materials/:id', async (req, res, next) => {
  try {
    const uid = req.session.user.id;
    const material = await ownedMaterial(req.params.id, uid);
    if (!material) return res.status(404).render('error', { title: 'Not found', message: 'Material not found.' });
    if (material.status !== 'ready') return res.render('processing', { title: material.title, material });

    const [topics] = await db.query('SELECT * FROM topics WHERE material_id = ? ORDER BY id', [material.id]);
    const flashcards = await SR.deckForMaterial(uid, material.id);
    const scores = await A.topicScores(uid, material.id);
    const scoreById = Object.fromEntries(scores.map((s) => [s.id, s]));
    topics.forEach((t) => {
      t.notes = typeof t.notes === 'string' ? JSON.parse(t.notes) : t.notes || [];
      t.stats = scoreById[t.id];
    });
    res.render('material', { title: material.title, material, topics, flashcards, studyPage: true });
  } catch (e) { next(e); }
});

router.post('/materials/:id/delete', async (req, res, next) => {
  try {
    await db.query('DELETE FROM materials WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
    req.session.flash = { type: 'success', msg: 'Material deleted.' };
    res.redirect('/materials');
  } catch (e) { next(e); }
});

// Questions you got wrong most recently (and haven't since got right).
router.get('/mistakes', async (req, res, next) => {
  try {
    const uid = req.session.user.id;
    const params = [uid];
    let filter = '';
    if (req.query.topic) { filter = 'AND q.topic_id = ?'; params.push(req.query.topic); }
    const [rows] = await db.query(
      `SELECT q.*, t.name AS topic, an.chosen_index, an.correct
         FROM answers an
         JOIN quiz_attempts qa ON qa.id = an.attempt_id
         JOIN questions q ON q.id = an.question_id
         JOIN topics t ON t.id = q.topic_id
        WHERE qa.user_id = ? ${filter}
          AND an.id = (SELECT MAX(a2.id) FROM answers a2 JOIN quiz_attempts qa2 ON qa2.id = a2.attempt_id
                        WHERE a2.question_id = q.id AND qa2.user_id = qa.user_id)
          AND an.correct = 0
        ORDER BY an.id DESC LIMIT 50`, params);
    rows.forEach((r) => { r.options = typeof r.options === 'string' ? JSON.parse(r.options) : r.options; });
    res.render('mistakes', { title: 'Mistakes', mistakes: rows, topicId: req.query.topic || null, studyPage: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.generate = generate;
