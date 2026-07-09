const express = require('express');
const db = require('../db');
const { todayStr, rollingAverage, paceAndSpeed } = require('../utils');

const router = express.Router();

router.get('/', (req, res) => {
  const today = todayStr();

  const dayProfile = db.prepare('SELECT profile FROM day_profiles WHERE user_id = ? AND date = ?').get(req.user.id, today);
  const profile = dayProfile ? dayProfile.profile : 'training';
  const target = db.prepare('SELECT * FROM macro_targets WHERE user_id = ? AND profile = ?').get(req.user.id, profile);
  const todaysEntries = db.prepare('SELECT * FROM food_entries WHERE user_id = ? AND date = ?').all(req.user.id, today);
  const macroTotals = todaysEntries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein: acc.protein + e.protein,
      carbs: acc.carbs + e.carbs,
      fat: acc.fat + e.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const lastWorkout = db
    .prepare('SELECT * FROM workouts WHERE user_id = ? ORDER BY performed_at DESC, id DESC LIMIT 1')
    .get(req.user.id);
  let lastWorkoutSummary = null;
  if (lastWorkout) {
    const exCount = db.prepare('SELECT COUNT(*) AS c FROM workout_exercises WHERE workout_id = ?').get(lastWorkout.id).c;
    const setCount = db
      .prepare(
        `SELECT COUNT(*) AS c FROM workout_sets ws JOIN workout_exercises we ON we.id = ws.workout_exercise_id WHERE we.workout_id = ?`
      )
      .get(lastWorkout.id).c;
    lastWorkoutSummary = { ...lastWorkout, exCount, setCount };
  }

  const weightEntries = db.prepare('SELECT * FROM weight_entries WHERE user_id = ? ORDER BY date ASC').all(req.user.id);
  let weightTrend = null;
  if (weightEntries.length > 0) {
    const withAvg = rollingAverage(weightEntries, 'weight', 7);
    weightTrend = {
      current: weightEntries[weightEntries.length - 1].weight,
      avg: withAvg[withAvg.length - 1],
    };
  }

  // Weekly summary: last 7 days.
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  const weekFood = db
    .prepare('SELECT * FROM food_entries WHERE user_id = ? AND date >= ?')
    .all(req.user.id, weekAgoStr);
  const daysWithFood = new Set(weekFood.map((e) => e.date)).size || 1;
  const avgCalories = weekFood.reduce((s, e) => s + e.calories, 0) / daysWithFood;
  const avgProtein = weekFood.reduce((s, e) => s + e.protein, 0) / daysWithFood;

  const weekWorkouts = db
    .prepare('SELECT COUNT(*) AS c FROM workouts WHERE user_id = ? AND performed_at >= ?')
    .get(req.user.id, weekAgoStr).c;

  const weekCardio = db
    .prepare('SELECT COALESCE(SUM(distance), 0) AS miles FROM cardio_entries WHERE user_id = ? AND date >= ?')
    .get(req.user.id, weekAgoStr).miles;

  const weightWeekAgo = weightEntries.filter((e) => e.date <= weekAgoStr).slice(-1)[0];
  const weightNow = weightEntries[weightEntries.length - 1];
  const weeklyWeightChange =
    weightWeekAgo && weightNow ? weightNow.weight - weightWeekAgo.weight : null;

  res.render('dashboard', {
    today,
    profile,
    target,
    macroTotals,
    lastWorkoutSummary,
    weightTrend,
    weeklySummary: {
      avgCalories: Math.round(avgCalories),
      avgProtein: Math.round(avgProtein),
      workouts: weekWorkouts,
      miles: weekCardio,
      weightChange: weeklyWeightChange,
    },
  });
});

router.get('/charts', (req, res) => {
  const cardioEntries = db
    .prepare("SELECT * FROM cardio_entries WHERE user_id = ? AND type IN ('run','walk') ORDER BY date ASC")
    .all(req.user.id);
  const paceRpe = cardioEntries.map((e) => {
    const { pace } = paceAndSpeed(e.type, e.distance, e.duration_seconds);
    return { date: e.date, pace: pace ? Math.round(pace * 100) / 100 : null, rpe: e.rpe };
  });

  const exercisesLogged = db
    .prepare(
      `SELECT DISTINCT e.id, e.name FROM exercises e
       JOIN workout_exercises we ON we.exercise_id = e.id
       JOIN workouts w ON w.id = we.workout_id
       WHERE w.user_id = ? ORDER BY e.name`
    )
    .all(req.user.id);

  const selectedExerciseId = req.query.exercise_id ? Number(req.query.exercise_id) : (exercisesLogged[0] && exercisesLogged[0].id);
  let progression = [];
  if (selectedExerciseId) {
    const rows = db
      .prepare(
        `SELECT w.performed_at AS date, ws.weight, ws.reps FROM workout_sets ws
         JOIN workout_exercises we ON we.id = ws.workout_exercise_id
         JOIN workouts w ON w.id = we.workout_id
         WHERE w.user_id = ? AND we.exercise_id = ?
         ORDER BY w.performed_at ASC`
      )
      .all(req.user.id, selectedExerciseId);
    // Best set (by weight*reps volume) per workout date.
    const byDate = new Map();
    for (const r of rows) {
      if (r.weight == null || r.reps == null) continue;
      const volume = r.weight * r.reps;
      const existing = byDate.get(r.date);
      if (!existing || volume > existing.volume) {
        byDate.set(r.date, { weight: r.weight, reps: r.reps, volume });
      }
    }
    progression = Array.from(byDate.entries()).map(([date, v]) => ({ date, ...v }));
  }

  res.render('charts', { paceRpe, exercisesLogged, selectedExerciseId, progression });
});

module.exports = router;
