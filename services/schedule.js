// Exam planner: spreads the topics that still need work across the days before each exam.
const db = require('../config/db');
const { localDate } = require('./analytics');

function daysBetween(fromIso, toIso) {
  return Math.round((new Date(toIso + 'T00:00:00') - new Date(fromIso + 'T00:00:00')) / 86400000);
}

function addDaysIso(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localDate(d);
}

// Priority: weakest assessed topics first, then unassessed, then 60-79%. Mastered topics are skipped.
function topicsNeedingWork(scores) {
  const rank = (t) => (t.status === 'weak' ? 0 : t.status === 'new' ? 1 : t.status === 'ok' ? 2 : 3);
  return scores
    .filter((t) => t.status !== 'strong')
    .sort((a, b) => rank(a) - rank(b) || (a.score ?? 0) - (b.score ?? 0));
}

/**
 * Build a day-by-day schedule for one module.
 * Revision days run from today until the day before the exam; the last day is kept for a full practice quiz.
 */
function buildModuleSchedule(topics, examDate, today = localDate()) {
  const daysLeft = daysBetween(today, examDate);
  if (daysLeft <= 0) return { daysLeft, days: [] };
  const revisionDays = Math.max(1, daysLeft - 1);
  const perDay = Math.max(1, Math.ceil(topics.length / revisionDays));
  const days = [];
  for (let i = 0; i < topics.length; i += perDay) {
    days.push({ date: addDaysIso(today, days.length), topics: topics.slice(i, i + perDay) });
  }
  if (daysLeft >= 2) days.push({ date: addDaysIso(examDate, -1), finalReview: true, topics: [] });
  return { daysLeft, days };
}

async function examsFor(userId) {
  const [rows] = await db.query('SELECT module_code, exam_date FROM exams WHERE user_id = ? ORDER BY exam_date', [userId]);
  return Object.fromEntries(rows.map((r) => [r.module_code, String(r.exam_date).slice(0, 10)]));
}

async function setExam(userId, moduleCode, examDate) {
  if (!examDate) {
    await db.query('DELETE FROM exams WHERE user_id = ? AND module_code = ?', [userId, moduleCode]);
    return;
  }
  await db.query(
    'INSERT INTO exams (user_id, module_code, exam_date) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE exam_date = VALUES(exam_date)',
    [userId, moduleCode, examDate]
  );
}

module.exports = { daysBetween, topicsNeedingWork, buildModuleSchedule, examsFor, setExam };
