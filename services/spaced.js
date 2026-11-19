// Spaced repetition (Leitner system) for flashcards.
// Box 1 = still learning, Box 5 = well known. Each correct recall moves a card up a box
// and pushes its next review further away; a miss sends it back to Box 1.
const db = require('../config/db');
const { localDate } = require('./analytics');

const INTERVAL_DAYS = { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 };

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDate(d);
}

function nextState(currentBox, known) {
  if (!known) return { box: 1, due: localDate() }; // review again today
  const box = Math.min((currentBox || 0) + 1, 5);
  return { box, due: addDays(INTERVAL_DAYS[box]) };
}

async function deckForMaterial(userId, materialId) {
  const today = localDate();
  const [rows] = await db.query(
    `SELECT f.*, t.name AS topic, r.box, r.due_date
       FROM flashcards f
       JOIN topics t ON t.id = f.topic_id
       LEFT JOIN flashcard_reviews r ON r.flashcard_id = f.id AND r.user_id = ?
      WHERE f.material_id = ?
      ORDER BY f.id`, [userId, materialId]);
  rows.forEach((c) => {
    c.box = c.box || 0;
    c.due = !c.due_date || String(c.due_date).slice(0, 10) <= today;
  });
  // Due cards first (weakest box first), then the rest
  return rows.sort((a, b) => (b.due - a.due) || (a.box - b.box) || (a.id - b.id));
}

async function dueCount(userId) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS n
       FROM flashcards f
       JOIN materials m ON m.id = f.material_id AND m.user_id = ? AND m.status = 'ready'
       LEFT JOIN flashcard_reviews r ON r.flashcard_id = f.id AND r.user_id = ?
      WHERE r.due_date IS NULL OR r.due_date <= ?`, [userId, userId, localDate()]);
  return Number(row.n);
}

async function dueCards(userId, limit = 30) {
  const [rows] = await db.query(
    `SELECT f.*, t.name AS topic, m.title AS material_title, m.module_code, r.box
       FROM flashcards f
       JOIN topics t ON t.id = f.topic_id
       JOIN materials m ON m.id = f.material_id AND m.user_id = ? AND m.status = 'ready'
       LEFT JOIN flashcard_reviews r ON r.flashcard_id = f.id AND r.user_id = ?
      WHERE r.due_date IS NULL OR r.due_date <= ?
      ORDER BY COALESCE(r.box, 0), f.id
      LIMIT ?`, [userId, userId, localDate(), limit]);
  rows.forEach((c) => { c.box = c.box || 0; c.due = true; });
  return rows;
}

async function review(userId, flashcardId, known) {
  const [[card]] = await db.query(
    `SELECT f.id, r.box FROM flashcards f
       JOIN materials m ON m.id = f.material_id AND m.user_id = ?
       LEFT JOIN flashcard_reviews r ON r.flashcard_id = f.id AND r.user_id = ?
      WHERE f.id = ?`, [userId, userId, flashcardId]);
  if (!card) return null;
  const next = nextState(card.box, known);
  await db.query(
    `INSERT INTO flashcard_reviews (user_id, flashcard_id, box, due_date, reviews) VALUES (?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE box = VALUES(box), due_date = VALUES(due_date), reviews = reviews + 1`,
    [userId, flashcardId, next.box, next.due]);
  return next;
}

module.exports = { INTERVAL_DAYS, nextState, deckForMaterial, dueCount, dueCards, review };
