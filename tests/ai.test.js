const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

delete process.env.GEMINI_API_KEY;
delete process.env.OPENAI_API_KEY;
process.env.AI_PROVIDER = 'mock';
const ai = require('../services/ai');

const notes = fs.readFileSync(path.join(__dirname, '../samples/c237-sample-notes.txt'), 'utf8');

test('demo AI builds a valid study pack from notes', async () => {
  const pack = await ai.generateStudyPack(notes, 'C237');
  const names = pack.topics.map((t) => t.name);
  assert.ok(names.includes('Middleware') && names.includes('REST API'), names.join(', '));
  for (const t of pack.topics) {
    assert.ok(t.learn && t.brainrot && t.notes.length, `topic ${t.name} has content`);
    for (const q of t.questions) {
      assert.ok(q.options.length >= 2);
      assert.ok(q.answer_index >= 0 && q.answer_index < q.options.length);
    }
  }
});

test('adaptive generation returns questions at the requested difficulty', async () => {
  const topic = { name: 'Middleware', learn: notes.split('\n\n')[3], notes: ['Calling next passes control to the following middleware in the stack.'] };
  const qs = await ai.generateMoreQuestions(topic, 'medium', 3, []);
  assert.ok(qs.length > 0);
  assert.ok(qs.every((q) => q.difficulty === 'medium'));
});
