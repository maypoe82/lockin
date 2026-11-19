const test = require('node:test');
const assert = require('node:assert');
const SR = require('../services/spaced');
const S = require('../services/schedule');

test('spaced repetition: correct answers move a card up and space it out', () => {
  assert.deepStrictEqual(SR.nextState(0, true).box, 1);
  assert.deepStrictEqual(SR.nextState(3, true).box, 4);
  assert.deepStrictEqual(SR.nextState(5, true).box, 5, 'box 5 is the maximum');
  assert.deepStrictEqual(SR.nextState(4, false).box, 1, 'a miss goes back to box 1');
});

test('exam schedule spreads weakest topics first and keeps the last day for practice', () => {
  const topics = S.topicsNeedingWork([
    { name: 'A', status: 'ok', score: 70 },
    { name: 'B', status: 'weak', score: 20 },
    { name: 'C', status: 'strong', score: 95 },
    { name: 'D', status: 'new', score: null },
  ]);
  assert.deepStrictEqual(topics.map((t) => t.name), ['B', 'D', 'A'], 'mastered topic C is skipped');

  const sched = S.buildModuleSchedule(topics, '2030-01-11', '2030-01-01');
  assert.strictEqual(sched.daysLeft, 10);
  assert.strictEqual(sched.days[0].topics[0].name, 'B');
  assert.ok(sched.days[sched.days.length - 1].finalReview);
  assert.strictEqual(sched.days[sched.days.length - 1].date, '2030-01-10');
});

test('exam schedule packs several topics per day when time is short', () => {
  const topics = Array.from({ length: 6 }, (_, i) => ({ name: `T${i}`, status: 'weak', score: i }));
  const sched = S.buildModuleSchedule(topics, '2030-01-03', '2030-01-01');
  const revisionDays = sched.days.filter((d) => !d.finalReview);
  assert.strictEqual(revisionDays.length, 1);
  assert.strictEqual(revisionDays[0].topics.length, 6);
});
