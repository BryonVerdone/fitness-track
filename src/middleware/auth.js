const db = require('../db');

function loadUser(req, res, next) {
  if (req.session && req.session.userId) {
    const user = db
      .prepare('SELECT id, username, email, is_admin, is_active, goal_weight FROM users WHERE id = ?')
      .get(req.session.userId);
    if (user && user.is_active) {
      req.user = user;
      res.locals.user = user;
      return next();
    }
    // Stale/deactivated user — clear the session.
    req.session.destroy(() => next());
    return;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return req.path.startsWith('/api/') ? res.status(401).json({ error: 'Not authenticated' }) : res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).send('Forbidden');
  }
  next();
}

module.exports = { loadUser, requireAuth, requireAdmin };
