const express = require('express');
const db = require('../db');

const router = express.Router();

function getWorkoutOr404(req, res) {
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!workout) {
    res.status(404).send('Workout not found');
    return null;
  }
  return workout;
}

function previousSets(userId, exerciseId, beforeWorkoutId, beforeDate) {
  const prevWorkoutExercise = db
    .prepare(
      `SELECT we.id AS workout_exercise_id, w.performed_at FROM workout_exercises we
       JOIN workouts w ON w.id = we.workout_id
       WHERE w.user_id = ? AND we.exercise_id = ? AND w.id != ?
         AND (w.performed_at < ? OR (w.performed_at = ? AND w.id < ?))
       ORDER BY w.performed_at DESC, w.id DESC
       LIMIT 1`
    )
    .get(userId, exerciseId, beforeWorkoutId, beforeDate, beforeDate, beforeWorkoutId);
  if (!prevWorkoutExercise) return null;
  const sets = db
    .prepare('SELECT * FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_index')
    .all(prevWorkoutExercise.workout_exercise_id);
  return { performed_at: prevWorkoutExercise.performed_at, sets };
}

router.get('/', (req, res) => {
  const workouts = db
    .prepare('SELECT * FROM workouts WHERE user_id = ? ORDER BY performed_at DESC, id DESC LIMIT 50')
    .all(req.user.id);
  const templates = db.prepare('SELECT * FROM workout_templates WHERE user_id = ? ORDER BY name').all(req.user.id);
  res.render('workouts/index', { workouts, templates });
});

router.get('/start/:templateId', (req, res) => {
  const template = db
    .prepare('SELECT * FROM workout_templates WHERE id = ? AND user_id = ?')
    .get(req.params.templateId, req.user.id);
  if (!template) return res.status(404).send('Template not found');

  const templateExercises = db
    .prepare('SELECT * FROM workout_template_exercises WHERE template_id = ? ORDER BY order_index')
    .all(template.id);

  const start = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO workouts (user_id, template_id, name) VALUES (?, ?, ?)')
      .run(req.user.id, template.id, template.name);
    const workoutId = info.lastInsertRowid;
    const insertWE = db.prepare(
      'INSERT INTO workout_exercises (workout_id, exercise_id, order_index, notes) VALUES (?, ?, ?, ?)'
    );
    templateExercises.forEach((te, idx) => insertWE.run(workoutId, te.exercise_id, idx, te.notes));
    return workoutId;
  });
  const workoutId = start();
  res.redirect(`/workouts/${workoutId}/log`);
});

router.get('/start-blank', (req, res) => {
  const info = db.prepare("INSERT INTO workouts (user_id, template_id, name) VALUES (?, NULL, 'Ad-hoc workout')").run(req.user.id);
  res.redirect(`/workouts/${info.lastInsertRowid}/log`);
});

router.get('/:id/log', (req, res) => {
  const workout = getWorkoutOr404(req, res);
  if (!workout) return;

  const workoutExercises = db
    .prepare(
      `SELECT we.*, e.name AS exercise_name, e.category FROM workout_exercises we
       JOIN exercises e ON e.id = we.exercise_id
       WHERE we.workout_id = ? ORDER BY we.order_index`
    )
    .all(workout.id);

  const exercisesWithSets = workoutExercises.map((we) => {
    const sets = db.prepare('SELECT * FROM workout_sets WHERE workout_exercise_id = ? ORDER BY set_index').all(we.id);
    const templateTarget = workout.template_id
      ? db
          .prepare('SELECT * FROM workout_template_exercises WHERE template_id = ? AND exercise_id = ?')
          .get(workout.template_id, we.exercise_id)
      : null;
    const prev = previousSets(req.user.id, we.exercise_id, workout.id, workout.performed_at);
    return { ...we, sets, target: templateTarget, prev };
  });

  const allExercises = db.prepare('SELECT * FROM exercises WHERE is_active = 1 ORDER BY category, name').all();

  res.render('workouts/log', { workout, exercisesWithSets, allExercises });
});

router.post('/:id', (req, res) => {
  const workout = getWorkoutOr404(req, res);
  if (!workout) return;
  const { name, performed_at, notes } = req.body;
  db.prepare('UPDATE workouts SET name = ?, performed_at = ?, notes = ? WHERE id = ?').run(
    name || workout.name,
    performed_at || workout.performed_at,
    notes || null,
    workout.id
  );
  res.redirect(`/workouts/${workout.id}/log`);
});

router.post('/:id/delete', (req, res) => {
  const workout = getWorkoutOr404(req, res);
  if (!workout) return;
  db.prepare('DELETE FROM workouts WHERE id = ?').run(workout.id);
  res.redirect('/workouts');
});

router.post('/:id/exercises', (req, res) => {
  const workout = getWorkoutOr404(req, res);
  if (!workout) return;
  const { exercise_id } = req.body;
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM workout_exercises WHERE workout_id = ?')
    .get(workout.id).m;
  db.prepare('INSERT INTO workout_exercises (workout_id, exercise_id, order_index) VALUES (?, ?, ?)').run(
    workout.id,
    exercise_id,
    maxOrder + 1
  );
  res.redirect(`/workouts/${workout.id}/log`);
});

router.post('/:id/exercises/:weId/swap', (req, res) => {
  const workout = getWorkoutOr404(req, res);
  if (!workout) return;
  const { exercise_id } = req.body;
  db.prepare('UPDATE workout_exercises SET exercise_id = ? WHERE id = ? AND workout_id = ?').run(
    exercise_id,
    req.params.weId,
    workout.id
  );
  res.redirect(`/workouts/${workout.id}/log`);
});

router.post('/:id/exercises/:weId/delete', (req, res) => {
  const workout = getWorkoutOr404(req, res);
  if (!workout) return;
  db.prepare('DELETE FROM workout_exercises WHERE id = ? AND workout_id = ?').run(req.params.weId, workout.id);
  res.redirect(`/workouts/${workout.id}/log`);
});

router.post('/:id/exercises/:weId/sets', (req, res) => {
  const workout = getWorkoutOr404(req, res);
  if (!workout) return;
  const we = db.prepare('SELECT * FROM workout_exercises WHERE id = ? AND workout_id = ?').get(req.params.weId, workout.id);
  if (!we) return res.status(404).send('Exercise not found in this workout');
  const { weight, reps } = req.body;
  const nextIndex = db
    .prepare('SELECT COALESCE(MAX(set_index), -1) AS m FROM workout_sets WHERE workout_exercise_id = ?')
    .get(we.id).m + 1;
  db.prepare('INSERT INTO workout_sets (workout_exercise_id, set_index, weight, reps) VALUES (?, ?, ?, ?)').run(
    we.id,
    nextIndex,
    weight === '' ? null : Number(weight),
    reps === '' ? null : Number(reps)
  );
  res.redirect(`/workouts/${workout.id}/log`);
});

router.post('/:id/sets/:setId', (req, res) => {
  const workout = getWorkoutOr404(req, res);
  if (!workout) return;
  const { weight, reps } = req.body;
  db.prepare(
    `UPDATE workout_sets SET weight = ?, reps = ?
     WHERE id = ? AND workout_exercise_id IN (SELECT id FROM workout_exercises WHERE workout_id = ?)`
  ).run(weight === '' ? null : Number(weight), reps === '' ? null : Number(reps), req.params.setId, workout.id);
  res.redirect(`/workouts/${workout.id}/log`);
});

router.post('/:id/sets/:setId/delete', (req, res) => {
  const workout = getWorkoutOr404(req, res);
  if (!workout) return;
  db.prepare(
    `DELETE FROM workout_sets WHERE id = ? AND workout_exercise_id IN
     (SELECT id FROM workout_exercises WHERE workout_id = ?)`
  ).run(req.params.setId, workout.id);
  res.redirect(`/workouts/${workout.id}/log`);
});

module.exports = router;
