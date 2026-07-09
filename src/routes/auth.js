const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { generateInviteCode } = require('../utils');

const router = express.Router();

// Real client IP from Cloudflare Tunnel / reverse proxy headers.
function clientIp(req) {
  return req.headers['cf-connecting-ip'] || req.ip;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  message: 'Too many login attempts. Please try again later.',
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/login', { error: null });
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password, remember } = req.body;
  if (!username || !password) {
    return res.status(400).render('auth/login', { error: 'Username and password are required.' });
  }
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(username, username);
  if (!user || !user.is_active || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('auth/login', { error: 'Invalid credentials.' });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).render('auth/login', { error: 'Login failed, try again.' });
    req.session.userId = user.id;
    if (remember) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    } else {
      req.session.cookie.expires = false; // session cookie
    }
    res.redirect('/');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/register', (req, res) => {
  const hasAdmin = db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
  if (!hasAdmin) {
    return res.render('auth/register', { error: null, code: 'setup', firstUser: true });
  }
  res.render('auth/invite_invalid');
});

router.post('/register', (req, res, next) => {
  const hasAdmin = db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
  if (hasAdmin) return res.status(403).render('auth/invite_invalid');
  req.params.code = 'setup';
  registerHandler(req, res);
});

router.get('/register/:code', (req, res) => {
  const hasAdmin = db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
  if (!hasAdmin) {
    return res.render('auth/register', { error: null, code: req.params.code, firstUser: true });
  }
  const invite = db
    .prepare('SELECT * FROM invites WHERE code = ? AND used_by IS NULL AND revoked = 0')
    .get(req.params.code);
  if (!invite) {
    return res.status(404).render('auth/invite_invalid');
  }
  res.render('auth/register', { error: null, code: req.params.code, firstUser: false });
});

router.post('/register/:code', registerHandler);

function registerHandler(req, res) {
  const { username, email, password } = req.body;
  const code = req.params.code;
  if (!username || !email || !password || password.length < 8) {
    return res
      .status(400)
      .render('auth/register', { error: 'All fields are required; password must be at least 8 characters.', code, firstUser: false });
  }

  const hasAdmin = db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
  let invite = null;
  if (hasAdmin) {
    invite = db.prepare('SELECT * FROM invites WHERE code = ? AND used_by IS NULL AND revoked = 0').get(code);
    if (!invite) {
      return res.status(404).render('auth/invite_invalid');
    }
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (existing) {
    return res
      .status(400)
      .render('auth/register', { error: 'That username or email is already taken.', code, firstUser: !hasAdmin });
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const isAdmin = !hasAdmin ? 1 : 0;

  const insertUser = db.prepare(
    'INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, ?)'
  );
  const info = insertUser.run(username, email, passwordHash, isAdmin);
  const userId = info.lastInsertRowid;

  if (invite) {
    db.prepare("UPDATE invites SET used_by = ?, used_at = datetime('now') WHERE id = ?").run(userId, invite.id);
  }

  if (isAdmin) {
    seedAdminDefaults(userId);
  } else {
    db.prepare('INSERT INTO macro_targets (user_id, profile, calories, protein, carbs, fat) VALUES (?, ?, 2000, 150, 200, 65)').run(userId, 'training');
    db.prepare('INSERT INTO macro_targets (user_id, profile, calories, protein, carbs, fat) VALUES (?, ?, 1800, 150, 150, 65)').run(userId, 'rest');
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).render('auth/register', { error: 'Registration failed, try again.', code, firstUser: !hasAdmin });
    req.session.userId = userId;
    res.redirect('/');
  });
}

function seedAdminDefaults(userId) {
  db.prepare(
    'INSERT INTO macro_targets (user_id, profile, calories, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, 'training', 2000, 190, 175, 60);
  db.prepare(
    'INSERT INTO macro_targets (user_id, profile, calories, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId, 'rest', 1850, 190, 135, 60);
  db.prepare('UPDATE users SET goal_weight = 185 WHERE id = ?').run(userId);

  const exByName = (name) => db.prepare('SELECT id FROM exercises WHERE name = ?').get(name);
  const templates = [
    {
      name: 'Gym Upper',
      exercises: [
        ['Incline DB Press', 3, 8, 12],
        ['Machine Shoulder Press', 3, 8, 12],
        ['Lat Pulldown', 3, 10, 15],
        ['Cable Row', 3, 10, 12],
        ['Bicep Curl', 3, 10, 15],
        ['Tricep Pushdown', 3, 10, 15],
        ['Lateral Raise', 2, 12, 15],
      ],
    },
    {
      name: 'Gym Lower',
      exercises: [
        ['Hack Squat', 3, 8, 12],
        ['Bulgarian Split Squat', 3, 8, 12],
        ['Stiff-Leg Deadlift', 3, 10, 12],
        ['Leg Curl', 3, 10, 12],
        ['Standing Calf Raise', 3, 12, 15],
      ],
    },
    {
      name: 'Home A',
      exercises: [
        ['Pull-ups', 4, 8, 10],
        ['KB Goblet Squat', 4, 20, 20],
        ['Push-ups', 4, 15, 20],
        ['Glute Bridge', 4, 20, 20],
        ['Lying Leg Lift', 4, 15, 15],
      ],
    },
    {
      name: 'Home B',
      exercises: [
        ['Pull-ups', 4, 6, 8],
        ['KB Reverse Lunge', 4, 10, 10],
        ['Pike Push-ups', 4, 10, 12],
        ['Single-Leg Glute Bridge', 4, 10, 12],
        ['Plank', 4, 45, 60],
      ],
    },
  ];

  const notesFor = { 'KB Goblet Squat': '@30lb', 'KB Reverse Lunge': '@30lb per leg' };

  const insertTemplate = db.prepare('INSERT INTO workout_templates (user_id, name) VALUES (?, ?)');
  const insertTemplateExercise = db.prepare(
    'INSERT INTO workout_template_exercises (template_id, exercise_id, order_index, target_sets, target_rep_low, target_rep_high, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  for (const tpl of templates) {
    const info = insertTemplate.run(userId, tpl.name);
    const templateId = info.lastInsertRowid;
    tpl.exercises.forEach(([name, sets, repLow, repHigh], idx) => {
      const ex = exByName(name);
      if (ex) {
        insertTemplateExercise.run(templateId, ex.id, idx, sets, repLow, repHigh, notesFor[name] || null);
      }
    });
  }
}

module.exports = router;
