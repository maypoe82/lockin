const test = require('node:test');
const assert = require('node:assert');
const A = require('../services/analytics');

test('levels follow XP thresholds', () => {
  assert.strictEqual(A.levelFor(0).name, 'Distracted');
  assert.strictEqual(A.levelFor(250).name, 'Trying');
  assert.strictEqual(A.levelFor(800).name, 'Locked In');
  assert.strictEqual(A.levelFor(1500).name, 'Academic Weapon');
  assert.strictEqual(A.levelFor(99999).name, 'Final Boss');
  assert.strictEqual(A.levelFor(99999).progress, 100);
});

test('revision minutes scale with how weak you are (5-15 min)', () => {
  assert.strictEqual(A.revisionMinutes(42), 12);
  assert.strictEqual(A.revisionMinutes(0), 15);
  assert.strictEqual(A.revisionMinutes(95), 5);
});

test('weak topics are under 60%, weakest first, untested ignored', () => {
  const scores = [
    { name: 'Node.js', score: 91, status: 'strong' },
    { name: 'REST API', score: 55, status: 'weak' },
    { name: 'Middleware', score: 42, status: 'weak' },
    { name: 'EJS', score: null, status: 'new' },
  ];
  assert.deepStrictEqual(A.weakTopics(scores).map((t) => t.name), ['Middleware', 'REST API']);
});

test('lock-in plan has the 5 steps per weak topic', () => {
  const plan = A.buildPlan([{ id: 3, name: 'Middleware', score: 42, material_id: 1 }]);
  assert.strictEqual(plan[0].steps.length, 5);
  assert.match(plan[0].steps[0].label, /Review Middleware — 12 min/);
  assert.match(plan[0].steps[1].href, /difficulty=easy/);
});
