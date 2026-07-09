const express = require('express');
const db = require('../db');
const { todayStr, rollingAverage } = require('../utils');

const router = express.Router();

function computeStats(entries) {
  // entries ascending by date
  const withAvg = rollingAverage(entries, 'weight', 7).map((avg, idx) => ({ ...entries[idx], avg }));

  let trendPerWeek = null;
  if (withAvg.length >= 2) {
    const last = withAvg[withAvg.length - 1];
    const cutoff = new Date(last.date);
    cutoff.setDate(cutoff.getDate() - 7);
    let prevRef = withAvg[0];
    for (const e of withAvg) {
      if (new Date(e.date) <= cutoff) prevRef = e;
    }
    const daysBetween = (new Date(last.date) - new Date(prevRef.date)) / (1000 * 60 * 60 * 24);
    if (daysBetween > 0) {
      trendPerWeek = ((last.avg - prevRef.avg) / daysBetween) * 7;
    }
  }

  return { withAvg, trendPerWeek };
}

router.get('/', (req, res) => {
  const entries = db
    .prepare('SELECT * FROM weight_entries WHERE user_id = ? ORDER BY date ASC')
    .all(req.user.id);

  const { withAvg, trendPerWeek } = computeStats(entries);
  const latest = withAvg[withAvg.length - 1] || null;
  const goalWeight = req.user.goal_weight;

  let projection = null;
  if (latest && goalWeight && trendPerWeek && Math.sign(goalWeight - latest.avg) === Math.sign(trendPerWeek)) {
    const weeksLeft = (goalWeight - latest.avg) / trendPerWeek;
    const projDate = new Date();
    projDate.setDate(projDate.getDate() + Math.round(weeksLeft * 7));
    projection = { weeksLeft: Math.abs(weeksLeft), date: projDate.toISOString().slice(0, 10) };
  }

  res.render('weight/index', {
    entries: withAvg.slice().reverse(),
    latest,
    trendPerWeek,
    goalWeight,
    projection,
    today: todayStr(),
    chartData: withAvg.map((e) => ({ date: e.date, weight: e.weight, avg: Math.round(e.avg * 10) / 10 })),
  });
});

router.post('/', (req, res) => {
  const { date, weight } = req.body;
  if (!weight) return res.status(400).send('Weight is required.');
  db.prepare(
    'INSERT INTO weight_entries (user_id, date, weight) VALUES (?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET weight = excluded.weight'
  ).run(req.user.id, date || todayStr(), Number(weight));
  res.redirect('/weight');
});

router.post('/:id/delete', (req, res) => {
  db.prepare('DELETE FROM weight_entries WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.redirect('/weight');
});

router.post('/goal', (req, res) => {
  const { goal_weight } = req.body;
  db.prepare('UPDATE users SET goal_weight = ? WHERE id = ?').run(goal_weight ? Number(goal_weight) : null, req.user.id);
  res.redirect('/weight');
});

module.exports = router;
