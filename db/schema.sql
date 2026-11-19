-- LockIn database schema (MySQL 8)
-- Run automatically by `npm run db:init` or by docker-compose on first start.

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(80)  NOT NULL,
  email         VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  xp            INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- One uploaded PDF / pasted set of notes
CREATE TABLE IF NOT EXISTS materials (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,
  module_code VARCHAR(20)  NOT NULL,          -- e.g. C237
  title       VARCHAR(200) NOT NULL,
  summary     TEXT,
  raw_text    MEDIUMTEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Topics the AI found inside a material (Middleware, REST API, ...)
CREATE TABLE IF NOT EXISTS topics (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  material_id INT          NOT NULL,
  name        VARCHAR(120) NOT NULL,
  learn       TEXT,        -- simplified explanation
  brainrot    TEXT,        -- Gen-Z explanation
  notes       JSON,        -- array of key points
  mastered    TINYINT(1)   NOT NULL DEFAULT 0, -- set once topic hits 80%, for the +100 XP
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flashcards (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  material_id INT  NOT NULL,
  topic_id    INT  NOT NULL,
  front       TEXT NOT NULL,
  back        TEXT NOT NULL,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
  FOREIGN KEY (topic_id)    REFERENCES topics(id)    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS questions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  material_id  INT  NOT NULL,
  topic_id     INT  NOT NULL,
  difficulty   ENUM('easy','medium','hard') NOT NULL DEFAULT 'medium',
  question     TEXT NOT NULL,
  options      JSON NOT NULL,   -- ["GET","POST","PUT","DELETE"]
  answer_index TINYINT NOT NULL,
  explanation  TEXT,
  source       ENUM('initial','adaptive') NOT NULL DEFAULT 'initial',
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
  FOREIGN KEY (topic_id)    REFERENCES topics(id)    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  material_id  INT NOT NULL,
  mode         ENUM('full','lockin') NOT NULL DEFAULT 'full',
  score        INT NOT NULL DEFAULT 0,
  total        INT NOT NULL DEFAULT 0,
  duration_sec INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)     REFERENCES users(id)     ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS answers (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  attempt_id   INT NOT NULL,
  question_id  INT NOT NULL,
  chosen_index TINYINT,
  correct      TINYINT(1) NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (attempt_id)  REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id)     ON DELETE CASCADE
);

-- Seconds studied per user per day (powers streaks + study time)
CREATE TABLE IF NOT EXISTS study_log (
  user_id    INT  NOT NULL,
  study_date DATE NOT NULL,
  seconds    INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, study_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Every XP award, so you can show history / analytics later
CREATE TABLE IF NOT EXISTS xp_events (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  amount     INT NOT NULL,
  reason     VARCHAR(120) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
