# 🔒 LockIn

> Stop scrolling. Start locking in.

LockIn is an AI-powered study platform. Upload a lecture PDF and it turns it into simple explanations, **Brainrot Mode** explanations, quick notes, flashcards and quizzes. It then tracks which topics you actually understand and builds a **Revision Plan** for the ones you don't.

**It's not just an AI summariser. The point is AI + adaptive learning + analytics.**

## Features

| | |
|---|---|
| 🧠 **Learn** | AI splits your notes into topics and explains each one simply |
| 💀 **Brainrot Mode** | Same topic, explained in Gen-Z slang (still technically correct) |
| 📝 **Quick Notes** | Must-know bullet points per topic |
| 🃏 **Flashcards** | Flip cards with keyboard controls (← → space) |
| ❓ **Quiz** | Up to 15 questions, spread across every topic, easy / medium / hard |
| 🚨 **Lock In Alert** | After a quiz: "You got 3 Middleware questions wrong. Recommended revision: 12 minutes" |
| 📈 **Topic mastery** | Each topic's score uses your **last 10 answers**, so improvement shows quickly |
| 🔒 **Revision Plan** | For each weak topic (<60%): review → 5 easy → 5 medium → review mistakes → retake |
| 🤖 **Adaptive questions** | Lock-In quizzes use questions you haven't got right yet. If there aren't enough, the AI generates new ones for that topic |
| 🎮 **Gamification** | XP (+50 per quiz, +100 per mastered topic, +30 per 30 min studied), 5 levels (Distracted → Final Boss 💀), daily streaks |
| 📊 **Dashboard** | Streak, knowledge score, study time, questions answered, per-module knowledge bars, weekly chart, "your academic opp" |

## Tech stack

- **Backend:** Node.js, Express, REST routes, express-session, bcrypt
- **Frontend:** EJS templates, CSS, vanilla JS
- **Database:** MySQL 8
- **AI:** Google Gemini (free tier) or OpenAI, with JSON-output prompts and validation. There's also a built-in **demo mode** that works with no API key.
- **PDF:** pdf-parse (Mozilla pdf.js)
- **DevOps:** Docker, Docker Compose, Jenkins pipeline, AWS EC2

```
Browser ──► Express (routes) ──► services/ai.js ──► Gemini / OpenAI
                │                services/pdf.js
                │                services/analytics.js (mastery, plan, XP, streaks)
                ▼
             MySQL
```

## Run it

### Option A: Docker (easiest)

```bash
cp .env.example .env          # then paste your GEMINI_API_KEY in .env
docker compose up --build
```

Open http://localhost:3000. MySQL and its tables are set up automatically.

### Option B: Without Docker

You need Node 18+ and MySQL running locally.

```sql
-- in MySQL
CREATE DATABASE lockin;
CREATE USER 'lockin'@'localhost' IDENTIFIED BY 'lockin';
GRANT ALL ON lockin.* TO 'lockin'@'localhost';
```

```bash
npm install
cp .env.example .env          # add your GEMINI_API_KEY
npm run db:init               # creates the tables
npm run dev                   # http://localhost:3000 (auto-restarts on save)
```

### Getting a free AI key

1. Go to https://aistudio.google.com/apikey and create a key.
2. Put it in `.env` as `GEMINI_API_KEY=...`
3. Restart the app. The yellow "Demo AI mode" banner disappears.

Without a key, LockIn still runs: demo mode builds topics from your headings and makes fill-in-the-blank questions. That's fine for testing the flow, but the Brainrot explanations are only good with a real model.

**Try it:** upload `samples/c237-sample-notes.pdf`, take the quiz, then get some Middleware questions wrong on purpose and check the dashboard and Revision Plan.

## Tests

```bash
npm test
```

These cover levels, revision time, weak-topic detection, plan building and the AI output format. Jenkins runs them on every build.

## Project structure

```
app.js                 Express setup, sessions, error pages, /health
config/db.js           MySQL connection pool
db/schema.sql          All tables (users, materials, topics, flashcards, questions,
                       quiz_attempts, answers, study_log, xp_events)
db/init.js             npm run db:init
middleware/auth.js     requireLogin + shared view locals
routes/
  auth.js              register / login / logout
  dashboard.js         dashboard, Revision Plan, study-time API
  materials.js         upload → AI → save, study page, mistakes
  quiz.js              full quiz, adaptive Lock-In quiz, grading, results + alerts
services/
  ai.js                prompts, Gemini/OpenAI calls, output validation, demo mode
  analytics.js         topic mastery, weak topics, plan, XP, levels, streaks
  pdf.js               PDF → text
views/                 EJS pages + partials
public/                CSS + front-end JS (tabs, flashcards, study timer)
tests/                 node:test unit tests
samples/               sample C237 notes (PDF + txt)
Dockerfile, docker-compose.yml, Jenkinsfile
```

## How the adaptive part works

1. **Every answer is stored** with its topic and difficulty.
2. **Topic score** = % correct over your last 10 answers on that topic (`services/analytics.js → topicScores`).
   - ≥ 80% = strong 🔥 (first time also gives +100 XP)
   - < 60% = weak 💀 and goes into your Revision Plan
3. **Lock-In quiz** (`routes/quiz.js → /quiz/lockin`) picks 5 questions for one topic and difficulty, starting with ones you've never got right. If fewer than 5 are left, it asks the AI for new ones (`generateMoreQuestions`) and saves them with `source = 'adaptive'`.
4. **Revision time** = `(100 − score) / 5`, kept between 5 and 15 minutes.

## Deploying to AWS (EC2)

1. Launch an EC2 instance (Amazon Linux 2023, t3.small or bigger). In the security group, open port 22 (SSH) and port 3000 (or 80).
2. Install Docker and the compose plugin on it, then make a folder:
   ```bash
   mkdir -p ~/lockin/db
   # copy docker-compose.yml → ~/lockin/, db/schema.sql → ~/lockin/db/
   # create ~/lockin/.env with your secrets + APP_IMAGE=yourdockerhub/lockin:latest
   ```
3. In Jenkins, add these credentials: `dockerhub-creds` (username/password) and `ec2-ssh-key` (SSH key). Then edit `DOCKERHUB_USER` and `EC2_HOST` at the top of the `Jenkinsfile`.
4. Create a Jenkins **Pipeline** job pointing at your GitHub repo, and add a GitHub webhook.

After that, every push to `main` runs **checkout → test → docker build → push to Docker Hub → SSH to EC2 → pull + restart**.

## Roadmap

- [x] PDF → AI → summary, notes, quiz
- [x] Flashcards
- [x] Brainrot explanations
- [x] Performance tracking per topic
- [x] Adaptive quizzes + AI-generated questions for weak topics
- [x] Personalised Revision Plan
- [ ] AI study plan across modules with exam dates
- [ ] Spaced repetition for flashcards
- [ ] Leaderboards / study with friends
- [ ] Store sessions in MySQL/Redis (right now they're in memory, so a restart logs everyone out)
- [ ] Upload PDFs to S3

## Resume line

> **LockIn — AI-Powered Adaptive Learning Platform.** Developed a full-stack AI learning platform (Node.js, Express, MySQL) that transforms uploaded study materials into personalised summaries, flashcards and quizzes using LLM prompt engineering. Implemented per-topic performance analytics and adaptive AI question generation to identify weak topics and provide targeted revision plans. Containerised with Docker and automated CI/CD to AWS EC2 using Jenkins.
