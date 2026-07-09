const express = require('express');
const db = require('../db');
const { todayStr, paceAndSpeed } = require('../utils');

const router = express.Router();
const TYPES = ['run', 'walk', 'cycle', 'other'];

router.get('/', (req, res) => {
  const entries = db
    .prepare('SELECT * FROM cardio_entries WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 100')
    .all(req.user.id);

  const enriched = entries.map((e) => {
    const { pace, speed } = paceAndSpeed(e.type, e.distance, e.duration_seconds);
    return { ...e, pace, speed };
  });

  // Weekly mileage: sum distance grouped by ISO week start (Monday).
  const weekMap = new Map();
  for (const e of entries) {
    const d = new Date(e.date);
    const day = (d.getUTCDay() + 6) % 7; // Mon=0
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - day);
    const key = monday.toISOString().slice(0, 10);
    weekMap.set(key, (weekMap.get(key) || 0) + e.distance);
  }
  const weeklyMileage = Array.from(weekMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, miles]) => ({ week, miles }));

  res.render('cardio/index', { entries: enriched, types: TYPES, today: todayStr(), weeklyMileage });
});

router.post('/', (req, res) => {
  const { type, date, distance, duration_minutes, rpe, notes } = req.body;
  if (!TYPES.includes(type) || !distance || !duration_minutes) {
    return res.status(400).send('Invalid cardio entry.');
  }
  db.prepare(
    'INSERT INTO cardio_entries (user_id, date, type, distance, duration_seconds, rpe, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    req.user.id,
    date || todayStr(),
    type,
    Number(distance),
    Math.round(Number(duration_minutes) * 60),
    rpe ? Number(rpe) : null,
    notes ? notes.trim() : null
  );
  res.redirect('/cardio');
});

router.post('/:id', (req, res) => {
  const { type, date, distance, duration_minutes, rpe, notes } = req.body;
  if (!TYPES.includes(type) || !distance || !duration_minutes) {
    return res.status(400).send('Invalid cardio entry.');
  }
  db.prepare(
    'UPDATE cardio_entries SET type = ?, date = ?, distance = ?, duration_seconds = ?, rpe = ?, notes = ? WHERE id = ? AND user_id = ?'
  ).run(
    type,
    date,
    Number(distance),
    Math.round(Number(duration_minutes) * 60),
    rpe ? Number(rpe) : null,
    notes ? notes.trim() : null,
    req.params.id,
    req.user.id
  );
  res.redirect('/cardio');
});

router.post('/:id/delete', (req, res) => {
  db.prepare('DELETE FROM cardio_entries WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.redirect('/cardio');
});

module.exports = router;
