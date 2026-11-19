// Analytics + adaptive learning + gamification.
const db = require('../config/db');

const WEAK_BELOW = 60;     // topic score under this = "academic opp" 💀
const MASTERED_AT = 80;    // topic score at/over this = mastered 🔥
const RECENT_ANSWERS = 10; // mastery uses your last N answers per topic, so improvement shows up fast

const LEVELS = [
  { level: 1, name: 'Distracted', min: 0 },
  { level: 2, name: 'Trying', min: 250 },
  { level: 3, name: 'Locked In', min: 750 },
  { level: 4, name: 'Academic Weapon', min: 1500 },
  { level: 5, name: 'Final Boss 💀', min: 3000 },
];

const XP = { QUIZ: 50, TOPIC_MASTERED: 100, STUDY_30_MIN: 30 };

function levelFor(xp) {
  let current = LEVELS[0];
  for (const l of LEVELS) if (xp >= l.min) current = l;
  const next = LEVELS.find((l) => l.min > xp);
  const progress = next ? Math.round(((xp - current.min) / (next.min - current.min)) * 100) : 100;
  return { ...current, next, progress };
}

function localDate(d = new Date()) {
  // YYYY-MM-DD in the server's TZ (set TZ=Asia/Singapore)
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

function revisionMinutes(score) {
  return Math.min(15, Math.max(5, Math.round((100 - (score ?? 0)) / 5)));
}

// ---------- Topic mastery ----------

async function topicScores(userId, materialId = null) {
  const params = [userId, RECENT_ANSWERS, userId];
  let filter = '';
  if (materialId) { filter = 'AND m.id = ?'; params.push(materialId); }
  const [rows] = await db.query(
    `SELECT t.id, t.name, t.mastered, m.id AS material_id, m.module_code, m.title AS material_title,
            ROUND(100 * AVG(x.correct)) AS score, COUNT(x.correct) AS answered
       FROM topics t
       JOIN materials m ON m.id = t.material_id
       LEFT JOIN (
         SELECT q.topic_id, an.correct,
                ROW_NUMBER() OVER (PARTITION BY q.topic_id ORDER BY an.id DESC) AS rn
           FROM answers an
           JOIN questions q      ON q.id = an.question_id
           JOIN quiz_attempts qa ON qa.id = an.attempt_id
          WHERE qa.user_id = ?
       ) x ON x.topic_id = t.id AND x.rn <= ?
      WHERE m.user_id = ? ${filter}
      GROUP BY t.id, t.name, t.mastered, m.id, m.module_code, m.title
      ORDER BY m.module_code, score DESC`,
    params
  );
  return rows.map((r) => ({
    ...r,
    score: r.score === null ? null : Number(r.score),
    answered: Number(r.answered),
    status: r.score === null ? 'new' : r.score >= MASTERED_AT ? 'strong' : r.score < WEAK_BELOW ? 'weak' : 'ok',
  }));
}

function weakTopics(scores) {
  return scores.filter((t) => t.status === 'weak').sort((a, b) => a.score - b.score);
}

// ---------- Lock-In Plan (the adaptive part) ----------

function buildPlan(weak) {
  return weak.map((t) => ({
    topic: t,
    minutes: revisionMinutes(t.score),
    steps: [
      { label: `Review ${t.name} — ${revisionMinutes(t.score)} min`, href: `/materials/${t.material_id}#topic-${t.id}` },
      { label: 'Try 5 easy questions', href: `/quiz/lockin?topic=${t.id}&difficulty=easy` },
      { label: 'Try 5 medium questions', href: `/quiz/lockin?topic=${t.id}&difficulty=medium` },
      { label: 'Review mistakes', href: `/mistakes?topic=${t.id}` },
      { label: 'Retake assessment', href: `/quiz/material/${t.material_id}` },
    ],
  }));
}

// ---------- XP + streaks + study time ----------

async function awardXP(userId, amount, reason) {
  await db.query('INSERT INTO xp_events (user_id, amount, reason) VALUES (?, ?, ?)', [userId, amount, reason]);
  await db.query('UPDATE users SET xp = xp + ? WHERE id = ?', [amount, userId]);
  return { amount, reason };
}

async function logStudy(userId, seconds) {
  seconds = Math.max(0, Math.min(Math.round(seconds), 3600));
  if (!seconds) return [];
  const [[{ total }]] = await db.query('SELECT COALESCE(SUM(seconds),0) AS total FROM study_log WHERE user_id = ?', [userId]);
  await db.query(
    `INSERT INTO study_log (user_id, study_date, seconds) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE seconds = seconds + VALUES(seconds)`,
    [userId, localDate(), seconds]
  );
  // +30 XP every time your all-time study time crosses another 30-minute mark
  const blocks = Math.floor((Number(total) + seconds) / 1800) - Math.floor(Number(total) / 1800);
  const awards = [];
  for (let i = 0; i < blocks; i++) awards.push(await awardXP(userId, XP.STUDY_30_MIN, 'Studied for 30 min'));
  return awards;
}

async function streak(userId) {
  const [rows] = await db.query(
    'SELECT study_date FROM study_log WHERE user_id = ? AND seconds > 0 ORDER BY study_date DESC LIMIT 400',
    [userId]
  );
  const days = new Set(rows.map((r) => String(r.study_date).slice(0, 10)));
  const cursor = new Date();
  if (!days.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1); // streak survives until end of today
  let count = 0;
  while (days.has(localDate(cursor))) { count++; cursor.setDate(cursor.getDate() - 1); }
  return { count, studiedToday: days.has(localDate()) };
}

async function dashboardStats(userId) {
  const [[time]] = await db.query('SELECT COALESCE(SUM(seconds),0) AS s FROM study_log WHERE user_id = ?', [userId]);
  const [[answered]] = await db.query(
    'SELECT COUNT(*) AS n, COALESCE(ROUND(100*AVG(an.correct)),0) AS acc FROM answers an JOIN quiz_attempts qa ON qa.id = an.attempt_id WHERE qa.user_id = ?',
    [userId]
  );
  const [[user]] = await db.query('SELECT xp FROM users WHERE id = ?', [userId]);
  const [week] = await db.query(
    'SELECT study_date, seconds FROM study_log WHERE user_id = ? AND study_date >= ? ORDER BY study_date',
    [userId, localDate(new Date(Date.now() - 6 * 86400000))]
  );
  const s = Number(time.s);
  return {
    studySeconds: s,
    studyTime: `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`,
    questionsAnswered: Number(answered.n),
    accuracy: Number(answered.acc),
    xp: user.xp,
    level: levelFor(user.xp),
    streak: await streak(userId),
    week: last7Days(week),
  };
}

function last7Days(rows) {
  const map = Object.fromEntries(rows.map((r) => [String(r.study_date).slice(0, 10), Number(r.seconds)]));
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = localDate(d);
    out.push({ label: d.toLocaleDateString('en-SG', { weekday: 'short' }), minutes: Math.round((map[key] || 0) / 60) });
  }
  return out;
}

module.exports = {
  WEAK_BELOW, MASTERED_AT, LEVELS, XP,
  levelFor, revisionMinutes, topicScores, weakTopics, buildPlan,
  awardXP, logStudy, streak, dashboardStats, localDate,
};
