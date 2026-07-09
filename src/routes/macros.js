const express = require('express');
const db = require('../db');
const { todayStr } = require('../utils');

const router = express.Router();

function getDate(req) {
  return /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || req.body.date) ? (req.query.date || req.body.date) : todayStr();
}

router.get('/', (req, res) => {
  const date = getDate(req);

  const dayProfile = db.prepare('SELECT profile FROM day_profiles WHERE user_id = ? AND date = ?').get(req.user.id, date);
  const profile = dayProfile ? dayProfile.profile : 'training';

  const target = db.prepare('SELECT * FROM macro_targets WHERE user_id = ? AND profile = ?').get(req.user.id, profile);

  const entries = db
    .prepare('SELECT * FROM food_entries WHERE user_id = ? AND date = ? ORDER BY id')
    .all(req.user.id, date);

  const totals = entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein: acc.protein + e.protein,
      carbs: acc.carbs + e.carbs,
      fat: acc.fat + e.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const favorites = db.prepare('SELECT * FROM favorites WHERE user_id = ? ORDER BY name').all(req.user.id);

  res.render('macros/index', { date, profile, target, entries, totals, favorites });
});

router.post('/day-profile', (req, res) => {
  const date = getDate(req);
  const { profile } = req.body;
  if (!['training', 'rest'].includes(profile)) return res.status(400).send('Invalid profile.');
  db.prepare(
    'INSERT INTO day_profiles (user_id, date, profile) VALUES (?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET profile = excluded.profile'
  ).run(req.user.id, date, profile);
  res.redirect(`/macros?date=${date}`);
});

router.post('/entries', (req, res) => {
  const date = getDate(req);
  const { name, calories, protein, carbs, fat } = req.body;
  if (!name || !name.trim()) return res.status(400).send('Name is required.');
  db.prepare(
    'INSERT INTO food_entries (user_id, date, name, calories, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, date, name.trim(), Number(calories) || 0, Number(protein) || 0, Number(carbs) || 0, Number(fat) || 0);
  res.redirect(`/macros?date=${date}`);
});

router.post('/entries/:id/delete', (req, res) => {
  const date = getDate(req);
  db.prepare('DELETE FROM food_entries WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.redirect(`/macros?date=${date}`);
});

router.post('/favorites', (req, res) => {
  const date = getDate(req);
  const { name, calories, protein, carbs, fat } = req.body;
  if (!name || !name.trim()) return res.status(400).send('Name is required.');
  db.prepare(
    'INSERT INTO favorites (user_id, name, calories, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, name.trim(), Number(calories) || 0, Number(protein) || 0, Number(carbs) || 0, Number(fat) || 0);
  res.redirect(`/macros?date=${date}`);
});

router.post('/favorites/:id/use', (req, res) => {
  const date = getDate(req);
  const fav = db.prepare('SELECT * FROM favorites WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!fav) return res.status(404).send('Favorite not found.');
  db.prepare(
    'INSERT INTO food_entries (user_id, date, name, calories, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, date, fav.name, fav.calories, fav.protein, fav.carbs, fav.fat);
  res.redirect(`/macros?date=${date}`);
});

router.post('/favorites/:id/delete', (req, res) => {
  const date = getDate(req);
  db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.redirect(`/macros?date=${date}`);
});

router.get('/targets', (req, res) => {
  const training = db.prepare("SELECT * FROM macro_targets WHERE user_id = ? AND profile = 'training'").get(req.user.id);
  const rest = db.prepare("SELECT * FROM macro_targets WHERE user_id = ? AND profile = 'rest'").get(req.user.id);
  res.render('macros/targets', { training, rest });
});

router.post('/targets', (req, res) => {
  const { profile, calories, protein, carbs, fat } = req.body;
  if (!['training', 'rest'].includes(profile)) return res.status(400).send('Invalid profile.');
  db.prepare(
    `INSERT INTO macro_targets (user_id, profile, calories, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, profile) DO UPDATE SET calories = excluded.calories, protein = excluded.protein, carbs = excluded.carbs, fat = excluded.fat`
  ).run(req.user.id, profile, Number(calories) || 0, Number(protein) || 0, Number(carbs) || 0, Number(fat) || 0);
  res.redirect('/macros/targets');
});

module.exports = router;
