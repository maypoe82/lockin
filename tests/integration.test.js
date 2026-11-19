// End-to-end test: runs the real app against a real MySQL database.
// Skipped automatically when no database is reachable (CI provides one).
const test = require('node:test');
const assert = require('node:assert');

process.env.AI_PROVIDER = 'mock';
process.env.NODE_ENV = 'test';
const db = require('../config/db');
const migrate = require('../db/migrate');
const app = require('../app');
const { setExam } = require('../services/schedule');

const NOTES = require('fs').readFileSync(require('path').join(__dirname, '../samples/c237-sample-notes.txt'), 'utf8');

// Tiny browser: keeps the session cookie and the CSRF token between requests.
function client(base) {
  let cookie = '';
  let csrf = '';
  async function req(path, { method = 'GET', form, json, multipart } = {}) {
    const headers = { cookie };
    let body;
    if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams({ _csrf: csrf, ...form }); }
    if (json) { headers['content-type'] = 'application/json'; headers['x-csrf-token'] = csrf; body = JSON.stringify(json); }
    if (multipart) { body = new FormData(); body.append('_csrf', csrf); for (const [k, v] of Object.entries(multipart)) body.append(k, v); }
    const res = await fetch(base + path, { method, headers, body, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    const token = text.match(/name="_csrf" value="([^"]+)"/);
    if (token) csrf = token[1];
    return { status: res.status, location: res.headers.get('location'), text };
  }
  return { req };
}

let server, base, dbReady = true;

test.before(async () => {
  try { await migrate(); } catch (e) { dbReady = false; return; }
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server?.close();
  await db.end();
});

test('full student journey', async (t) => {
  if (!dbReady) return t.skip('no database available');
  const c = client(base);
  const email = `student${Date.now()}@test.local`;

  await c.req('/register');
  let r = await c.req('/register', { method: 'POST', form: { name: 'Test Student', email, password: 'password123' } });
  assert.strictEqual(r.location, '/upload', 'register redirects to upload');

  await c.req('/upload');
  r = await c.req('/upload', { method: 'POST', multipart: { module_code: 'C237', title: 'Week 5', text: NOTES } });
  const materialPath = r.location;
  assert.match(materialPath, /^\/materials\/\d+$/, 'upload redirects to the material');

  // Generation runs in the background; poll until ready
  let status = 'processing';
  for (let i = 0; i < 50 && status === 'processing'; i++) {
    status = JSON.parse((await c.req(`${materialPath}/status`)).text).status;
    if (status === 'processing') await new Promise((res) => setTimeout(res, 100));
  }
  assert.strictEqual(status, 'ready');

  r = await c.req(materialPath);
  assert.match(r.text, /Middleware/, 'topics are shown');
  assert.match(r.text, /Flashcards \(\d+\)/);

  // Flashcard review (spaced repetition)
  const cardId = r.text.match(/data-id="(\d+)"/)[1];
  r = await c.req(`/api/flashcards/${cardId}/review`, { method: 'POST', json: { known: true } });
  assert.strictEqual(JSON.parse(r.text).box, 1);

  // Take the quiz, answering option A for everything
  const id = materialPath.split('/').pop();
  r = await c.req(`/quiz/material/${id}`);
  const qids = [...new Set([...r.text.matchAll(/name="q_(\d+)"/g)].map((m) => m[1]))];
  assert.ok(qids.length >= 5, 'quiz has questions');
  r = await c.req('/quiz/submit', { method: 'POST', form: Object.fromEntries(qids.map((q) => [`q_${q}`, '0'])) });
  assert.match(r.location, /^\/quiz\/result\/\d+$/);
  r = await c.req(r.location);
  assert.match(r.text, /Results by topic/);

  // Exam date + schedule
  r = await c.req('/plan');
  const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  r = await c.req('/exams', { method: 'POST', form: { module_code: 'C237', exam_date: future } });
  r = await c.req('/plan');
  assert.match(r.text, /days until the exam/);

  r = await c.req('/progress');
  assert.match(r.text, /Quiz scores/);

  r = await c.req('/');
  assert.match(r.text, /Flashcards due/);
});

test('forms are rejected without a CSRF token', async (t) => {
  if (!dbReady) return t.skip('no database available');
  const res = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=a@b.c&password=whatever',
  });
  assert.strictEqual(res.status, 403);
});

test('pages require login', async (t) => {
  if (!dbReady) return t.skip('no database available');
  for (const p of ['/materials', '/plan', '/progress', '/review', '/upload']) {
    const res = await fetch(base + p, { redirect: 'manual' });
    assert.strictEqual(res.headers.get('location'), '/login', `${p} redirects to login`);
  }
});
