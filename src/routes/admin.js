const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { generateInviteCode } = require('../utils');

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  const users = db.prepare('SELECT id, username, email, is_admin, is_active, created_at FROM users ORDER BY created_at').all();
  const invites = db
    .prepare(
      `SELECT invites.*, u.username AS used_by_username FROM invites
       LEFT JOIN users u ON u.id = invites.used_by
       ORDER BY invites.created_at DESC`
    )
    .all();
  res.render('admin/index', { users, invites });
});

router.post('/invites', (req, res) => {
  const code = generateInviteCode();
  db.prepare('INSERT INTO invites (code, created_by) VALUES (?, ?)').run(code, req.user.id);
  res.redirect('/admin');
});

router.post('/invites/:id/revoke', (req, res) => {
  db.prepare('UPDATE invites SET revoked = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

router.post('/users/:id/deactivate', (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).redirect('/admin');
  }
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

router.post('/users/:id/activate', (req, res) => {
  db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

module.exports = router;
