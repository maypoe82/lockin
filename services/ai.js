// AI layer: turns raw lecture text into LockIn study material.
// Providers: Gemini (free tier, default if GEMINI_API_KEY set), OpenAI, or a
// built-in "demo" generator so the app works with no API key at all.

const MAX_CHARS = 60000; // keep prompts a sane size for big PDFs

function provider() {
  const p = (process.env.AI_PROVIDER || '').toLowerCase();
  if (p) return p;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'mock';
}

// ---------- Prompts (this is your "prompt engineering" section) ----------

function studyPackPrompt(text, moduleCode) {
  return `You are LockIn, a study assistant for polytechnic/university students.
Read the lecture material below (module ${moduleCode}) and build a study pack.

Rules:
- Split the content into 3-6 distinct TOPICS that a student could be tested on separately.
- Only use facts from the material. Do not invent content that is not there.
- "learn": a clear, simplified explanation (80-150 words) a tired student understands.
- "brainrot": the SAME concept explained in funny Gen-Z internet slang with emojis
  (e.g. "bro", "no cap", "it's giving", "💀", "fr"). Must still be technically correct. 40-90 words.
- "notes": 3-6 short bullet points of must-know facts.
- "flashcards": 2-4 per topic, short question on front, short answer on back.
- "questions": 3 per topic (1 easy, 1 medium, 1 hard), multiple choice, exactly 4 options,
  one correct answer, plausible wrong options, and a one-sentence explanation.

Return ONLY JSON in exactly this shape:
{
  "summary": "2-3 sentence overview of the whole material",
  "topics": [
    {
      "name": "Middleware",
      "learn": "...",
      "brainrot": "...",
      "notes": ["...", "..."],
      "flashcards": [{"front": "...", "back": "..."}],
      "questions": [
        {"difficulty": "easy", "question": "...", "options": ["A","B","C","D"], "answer_index": 1, "explanation": "..."}
      ]
    }
  ]
}

LECTURE MATERIAL:
"""
${text.slice(0, MAX_CHARS)}
"""`;
}

function moreQuestionsPrompt(topic, difficulty, count, existing) {
  return `You are LockIn. A student is WEAK at the topic "${topic.name}". Write ${count} NEW
${difficulty} multiple-choice questions to help them improve.

Base them only on this content:
Explanation: ${topic.learn}
Key notes: ${(topic.notes || []).join(' | ')}

Do NOT repeat these existing questions:
${existing.map((q) => '- ' + q).join('\n') || '- (none)'}

Each question: exactly 4 options, one correct, a one-sentence explanation.
Difficulty guide: easy = recall a definition; medium = apply/compare; hard = scenario or "which is NOT true".

Return ONLY JSON: {"questions":[{"difficulty":"${difficulty}","question":"...","options":["","","",""],"answer_index":0,"explanation":"..."}]}`;
}

// ---------- Provider calls ----------

// Google retires models (404) and sometimes overloads them (503/429).
// LockIn retries busy models, then falls back to other "flash" models your key can use,
// so the app keeps working without config changes.
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_FALLBACKS = ['gemini-3.8-flash'];
const RETRYABLE = new Set([429, 500, 503]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let discovered = null;

async function availableFlashModels() {
  if (discovered) return discovered;
  try {
    const res = await fetch(`${GEMINI_BASE}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY },
    });
    const data = await res.json();
    discovered = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /flash/.test(n) && !/(image|tts|audio|live|embed|preview|exp)/.test(n))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // newest first
  } catch {
    discovered = [];
  }
  return discovered;
}

async function geminiOnce(model, prompt) {
  return fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
    }),
  });
}

async function callGemini(prompt) {
  const tried = new Set();
  let lastError;
  const tryModels = async (models) => {
    for (const model of models) {
      if (!model || tried.has(model)) continue;
      tried.add(model);
      for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await geminiOnce(model, prompt);
        if (res.ok) {
          const data = await res.json();
          return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
        }
        lastError = new Error(`Gemini error ${res.status} (${model}): ${(await res.text()).slice(0, 200)}`);
        if (!RETRYABLE.has(res.status)) break;
        console.warn(`Gemini ${model} busy (${res.status}), attempt ${attempt}/3`);
        if (attempt < 3) await sleep(attempt * 3000);
      }
      if (lastError && !/Gemini error (404|429|500|503)/.test(lastError.message)) throw lastError; // e.g. bad key
    }
    return null;
  };
  const out =
    (await tryModels([process.env.GEMINI_MODEL, ...GEMINI_FALLBACKS])) ??
    (await tryModels(await availableFlashModels()));
  if (out !== null) return out;
  throw lastError || new Error('No Gemini model available');
}

async function callOpenAI(prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function askJSON(prompt) {
  const raw = provider() === 'openai' ? await callOpenAI(prompt) : await callGemini(prompt);
  // Models sometimes wrap JSON in ```json fences - strip them.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

// ---------- Validation (never trust raw model output) ----------

function cleanQuestion(q) {
  if (!q || !q.question || !Array.isArray(q.options) || q.options.length < 2) return null;
  const options = q.options.slice(0, 4).map(String);
  let idx = Number(q.answer_index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) return null;
  const difficulty = ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium';
  return { difficulty, question: String(q.question), options, answer_index: idx, explanation: String(q.explanation || '') };
}

function cleanPack(pack) {
  const topics = (pack.topics || [])
    .filter((t) => t && t.name)
    .map((t) => ({
      name: String(t.name).slice(0, 120),
      learn: String(t.learn || ''),
      brainrot: String(t.brainrot || ''),
      notes: (t.notes || []).map(String).slice(0, 8),
      flashcards: (t.flashcards || []).filter((f) => f && f.front && f.back).map((f) => ({ front: String(f.front), back: String(f.back) })),
      questions: (t.questions || []).map(cleanQuestion).filter(Boolean),
    }));
  if (!topics.length) throw new Error('AI returned no topics');
  return { summary: String(pack.summary || ''), topics };
}

// ---------- Demo generator (no API key needed) ----------

const STOP = new Set('about above after again against because before being below between both could doing during each from further having here into itself more most other over same should some such than that their them then there these they this those through under until very were what when where which while will with would your'.split(' '));

function sentencesOf(text) {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 400);
}

function keyword(sentence) {
  const words = sentence.match(/[A-Za-z][A-Za-z.\-]{4,}/g) || [];
  return words.filter((w) => !STOP.has(w.toLowerCase())).sort((a, b) => b.length - a.length)[0];
}

function clozeQuestions(sentences, pool, difficulties) {
  const qs = [];
  for (const s of sentences) {
    if (qs.length >= difficulties.length) break;
    const word = keyword(s);
    if (!word) continue;
    const distractors = [...new Set(pool.filter((w) => w.toLowerCase() !== word.toLowerCase()))]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    while (distractors.length < 3) distractors.push(['function', 'database', 'variable', 'protocol'][distractors.length]);
    const options = [word, ...distractors].sort(() => Math.random() - 0.5);
    qs.push({
      difficulty: difficulties[qs.length],
      question: `Fill in the blank: "${s.replace(word, '_____')}"`,
      options,
      answer_index: options.indexOf(word),
      explanation: `From your notes: "${s}"`,
    });
  }
  return qs;
}

function mockPack(text) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  // Headings = short lines without a full stop at the end
  const sections = [];
  let current = null;
  for (const line of lines) {
    const isHeading = line.length < 60 && !/[.,;:]$/.test(line) && /^[A-Z0-9]/.test(line) && line.split(' ').length <= 7;
    if (isHeading) {
      current = { name: line.replace(/^[\d.\s#-]+/, '') || line, body: '' };
      sections.push(current);
    } else {
      if (!current) { current = { name: 'Overview', body: '' }; sections.push(current); }
      current.body += ' ' + line;
    }
  }
  let topics = sections.filter((s) => sentencesOf(s.body).length >= 2);
  if (topics.length < 2) {
    const all = sentencesOf(text);
    const size = Math.max(3, Math.ceil(all.length / 4));
    topics = [];
    for (let i = 0; i < all.length && topics.length < 4; i += size) {
      const chunk = all.slice(i, i + size);
      topics.push({ name: (keyword(chunk[0]) || `Part ${topics.length + 1}`).replace(/\.$/, ''), body: chunk.join(' ') });
    }
  }
  topics = topics.slice(0, 6);
  const pool = sentencesOf(text).map(keyword).filter(Boolean);

  return {
    summary: sentencesOf(text).slice(0, 2).join(' ') || 'Your uploaded notes.',
    topics: topics.map((t) => {
      const ss = sentencesOf(t.body);
      return {
        name: t.name,
        learn: ss.slice(0, 3).join(' '),
        brainrot: `ok so ${t.name} 💀 — basically: ${ss[0].charAt(0).toLowerCase() + ss[0].slice(1)} no cap. that's the whole vibe fr 🔒`,
        notes: ss.slice(0, 5),
        flashcards: ss.slice(0, 3).map((s) => {
          const w = keyword(s);
          return w ? { front: s.replace(w, '_____'), back: w } : { front: `Key idea of ${t.name}?`, back: s };
        }),
        questions: clozeQuestions(ss, pool, ['easy', 'medium', 'hard']),
      };
    }),
  };
}

// ---------- Public API ----------

async function generateStudyPack(text, moduleCode) {
  if (provider() === 'mock') return cleanPack(mockPack(text));
  return cleanPack(await askJSON(studyPackPrompt(text, moduleCode)));
}

async function generateMoreQuestions(topic, difficulty, count, existingQuestions) {
  if (provider() === 'mock') {
    const ss = [...topic.notes, ...sentencesOf(topic.learn)].sort(() => Math.random() - 0.5);
    const pool = ss.map(keyword).filter(Boolean);
    return clozeQuestions(ss, pool, Array(count).fill(difficulty));
  }
  const out = await askJSON(moreQuestionsPrompt(topic, difficulty, count, existingQuestions));
  return (out.questions || []).map(cleanQuestion).filter(Boolean).map((q) => ({ ...q, difficulty }));
}

module.exports = { generateStudyPack, generateMoreQuestions, provider };
