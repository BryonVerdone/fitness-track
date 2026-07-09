const express = require('express');
const db = require('../db');

const router = express.Router();

const CATEGORIES = ['upper', 'lower', 'core', 'cardio'];

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const category = CATEGORIES.includes(req.query.category) ? req.query.category : null;

  let sql = 'SELECT * FROM exercises WHERE is_active = 1';
  const params = [];
  if (q) {
    sql += ' AND name LIKE ?';
    params.push(`%${q}%`);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY category, name';
  const exercises = db.prepare(sql).all(...params);

  if (req.query.json) {
    return res.json(exercises);
  }

  res.render('exercises/index', { exercises, q, category, categories: CATEGORIES });
});

router.post('/', (req, res) => {
  const { name, category, equipment, notes } = req.body;
  if (!name || !CATEGORIES.includes(category)) {
    return res.status(400).send('Invalid exercise data.');
  }
  db.prepare(
    'INSERT INTO exercises (name, category, equipment, notes, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), category, equipment ? equipment.trim() : null, notes ? notes.trim() : null, req.user.id);
  res.redirect('/exercises');
});

// Admin-only maintenance: edit, merge, deactivate.
router.post('/:id/edit', (req, res) => {
  if (!req.user.is_admin) return res.status(403).send('Forbidden');
  const { name, category, equipment, notes } = req.body;
  if (!name || !CATEGORIES.includes(category)) {
    return res.status(400).send('Invalid exercise data.');
  }
  db.prepare('UPDATE exercises SET name = ?, category = ?, equipment = ?, notes = ? WHERE id = ?').run(
    name.trim(),
    category,
    equipment ? equipment.trim() : null,
    notes ? notes.trim() : null,
    req.params.id
  );
  res.redirect('/exercises');
});

router.post('/:id/deactivate', (req, res) => {
  if (!req.user.is_admin) return res.status(403).send('Forbidden');
  db.prepare('UPDATE exercises SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.redirect('/exercises');
});

// Merge duplicate exercise into a canonical one: repoints all references, deactivates the duplicate.
router.post('/:id/merge', (req, res) => {
  if (!req.user.is_admin) return res.status(403).send('Forbidden');
  const dupId = Number(req.params.id);
  const targetId = Number(req.body.target_id);
  if (!targetId || targetId === dupId) {
    return res.status(400).send('Choose a different target exercise.');
  }
  const merge = db.transaction(() => {
    db.prepare('UPDATE workout_template_exercises SET exercise_id = ? WHERE exercise_id = ?').run(targetId, dupId);
    db.prepare('UPDATE workout_exercises SET exercise_id = ? WHERE exercise_id = ?').run(targetId, dupId);
    db.prepare('UPDATE exercises SET is_active = 0 WHERE id = ?').run(dupId);
  });
  merge();
  res.redirect('/exercises');
});

module.exports = router;
