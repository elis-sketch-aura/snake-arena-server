// ============================================================
// snake arena — leaderboard server
// ============================================================
// stores users (username only, no password) and their best scores.
// auth: a cookie called `username` — whoever has the cookie is that user.
// this is fine for a friends-only game but anyone can claim any name.
// ============================================================

const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- database ----
const db = new Database(path.join(__dirname, 'snake.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    score INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_scores_mode ON scores(mode, score DESC);
`);

const findUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const insertUser = db.prepare('INSERT INTO users (username, created_at) VALUES (?, ?)');
const getBestScoreForUser = db.prepare(`
  SELECT MAX(score) AS best FROM scores WHERE user_id = ? AND mode = ?
`);
const insertScore = db.prepare('INSERT INTO scores (user_id, mode, score, created_at) VALUES (?, ?, ?, ?)');
const topScores = db.prepare(`
  SELECT users.username AS username, MAX(scores.score) AS score, scores.mode AS mode
  FROM scores
  JOIN users ON users.id = scores.user_id
  WHERE scores.mode = ?
  GROUP BY users.id
  ORDER BY score DESC
  LIMIT 10
`);

// ---- middleware ----
app.use(express.json());
app.use(cookieParser());

// CORS — allow the game to talk to this server from anywhere.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---- helpers ----
function isValidUsername(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 20) return false;
  return /^[A-Za-z0-9_\- ]+$/.test(trimmed);
}

function getCurrentUser(req) {
  const name = req.cookies && req.cookies.username;
  if (!name) return null;
  return findUserByUsername.get(name) || null;
}

function setUserCookie(res, username) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('username', username, {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
  });
}

// ---- routes ----

app.post('/api/signup', (req, res) => {
  const raw = (req.body && req.body.username) || '';
  const username = String(raw).trim();

  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'username must be 2-20 chars, letters/numbers/underscore/dash/space only' });
  }

  let user = findUserByUsername.get(username);
  if (!user) {
    const now = Date.now();
    const info = insertUser.run(username, now);
    user = { id: info.lastInsertRowid, username, created_at: now };
  }

  setUserCookie(res, username);
  res.json({ ok: true, username: user.username });
});

app.get('/api/me', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.json({ signedIn: false });
  res.json({ signedIn: true, username: user.username });
});

app.post('/api/score', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'not signed in' });

  const score = Number(req.body && req.body.score);
  const mode = req.body && req.body.mode;

  if (!Number.isInteger(score) || score < 0 || score > 1000000) {
    return res.status(400).json({ error: 'score must be a non-negative integer' });
  }
  if (mode !== 'gauntlet' && mode !== 'coop') {
    return res.status(400).json({ error: 'mode must be gauntlet or coop' });
  }

  const prev = getBestScoreForUser.get(user.id, mode);
  const best = prev && prev.best != null ? prev.best : -1;

  if (score > best) {
    insertScore.run(user.id, mode, score, Date.now());
    return res.json({ ok: true, saved: true, best: score });
  }

  return res.json({ ok: true, saved: false, best });
});

app.get('/api/leaderboard', (req, res) => {
  const mode = req.query.mode === 'coop' ? 'coop' : 'gauntlet';
  const rows = topScores.all(mode);
  res.json({ mode, rows });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

app.listen(PORT, () => {
  console.log(`snake arena server listening on port ${PORT}`);
});
