const express = require('express');
const db = require('../db');

const router = express.Router();

function getTemplateOr404(req, res) {
  const template = db
    .prepare('SELECT * FROM workout_templates WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!template) {
    res.status(404).send('Template not found');
    return null;
  }
  return template;
}

router.get('/', (req, res) => {
  const templates = db
    .prepare('SELECT * FROM workout_templates WHERE user_id = ? ORDER BY name')
    .all(req.user.id);
  res.render('templates/index', { templates });
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).send('Name is required.');
  const info = db.prepare('INSERT INTO workout_templates (user_id, name) VALUES (?, ?)').run(req.user.id, name.trim());
  res.redirect(`/templates/${info.lastInsertRowid}/edit`);
});

router.get('/:id/edit', (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;
  const templateExercises = db
    .prepare(
      `SELECT wte.*, e.name AS exercise_name, e.category FROM workout_template_exercises wte
       JOIN exercises e ON e.id = wte.exercise_id
       WHERE wte.template_id = ? ORDER BY wte.order_index`
    )
    .all(template.id);
  const exercises = db.prepare('SELECT * FROM exercises WHERE is_active = 1 ORDER BY category, name').all();
  res.render('templates/edit', { template, templateExercises, exercises });
});

router.post('/:id', (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).send('Name is required.');
  db.prepare("UPDATE workout_templates SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name.trim(), template.id);
  res.redirect(`/templates/${template.id}/edit`);
});

router.post('/:id/delete', (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;
  db.prepare('DELETE FROM workout_templates WHERE id = ?').run(template.id);
  res.redirect('/templates');
});

router.post('/:id/exercises', (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;
  const { exercise_id, target_sets, target_rep_low, target_rep_high, notes } = req.body;
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM workout_template_exercises WHERE template_id = ?')
    .get(template.id).m;
  db.prepare(
    `INSERT INTO workout_template_exercises
     (template_id, exercise_id, order_index, target_sets, target_rep_low, target_rep_high, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    template.id,
    exercise_id,
    maxOrder + 1,
    Number(target_sets) || 3,
    target_rep_low ? Number(target_rep_low) : null,
    target_rep_high ? Number(target_rep_high) : null,
    notes || null
  );
  db.prepare("UPDATE workout_templates SET updated_at = datetime('now') WHERE id = ?").run(template.id);
  res.redirect(`/templates/${template.id}/edit`);
});

router.post('/:id/exercises/:teId', (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;
  const { target_sets, target_rep_low, target_rep_high, notes } = req.body;
  db.prepare(
    `UPDATE workout_template_exercises
     SET target_sets = ?, target_rep_low = ?, target_rep_high = ?, notes = ?
     WHERE id = ? AND template_id = ?`
  ).run(
    Number(target_sets) || 3,
    target_rep_low ? Number(target_rep_low) : null,
    target_rep_high ? Number(target_rep_high) : null,
    notes || null,
    req.params.teId,
    template.id
  );
  db.prepare("UPDATE workout_templates SET updated_at = datetime('now') WHERE id = ?").run(template.id);
  res.redirect(`/templates/${template.id}/edit`);
});

router.post('/:id/exercises/:teId/delete', (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;
  db.prepare('DELETE FROM workout_template_exercises WHERE id = ? AND template_id = ?').run(req.params.teId, template.id);
  db.prepare("UPDATE workout_templates SET updated_at = datetime('now') WHERE id = ?").run(template.id);
  res.redirect(`/templates/${template.id}/edit`);
});

router.post('/:id/exercises/:teId/move', (req, res) => {
  const template = getTemplateOr404(req, res);
  if (!template) return;
  const direction = req.body.direction === 'up' ? -1 : 1;
  const rows = db
    .prepare('SELECT id, order_index FROM workout_template_exercises WHERE template_id = ? ORDER BY order_index')
    .all(template.id);
  const idx = rows.findIndex((r) => String(r.id) === req.params.teId);
  const swapIdx = idx + direction;
  if (idx === -1 || swapIdx < 0 || swapIdx >= rows.length) {
    return res.redirect(`/templates/${template.id}/edit`);
  }
  const a = rows[idx];
  const b = rows[swapIdx];
  const swap = db.transaction(() => {
    db.prepare('UPDATE workout_template_exercises SET order_index = ? WHERE id = ?').run(b.order_index, a.id);
    db.prepare('UPDATE workout_template_exercises SET order_index = ? WHERE id = ?').run(a.order_index, b.id);
  });
  swap();
  res.redirect(`/templates/${template.id}/edit`);
});

module.exports = router;
