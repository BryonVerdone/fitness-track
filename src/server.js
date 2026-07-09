require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const db = require('./db');
const SqliteSessionStore = require('./sqliteSessionStore');
const { loadUser, requireAuth } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const exerciseRoutes = require('./routes/exercises');
const templateRoutes = require('./routes/templates');
const workoutRoutes = require('./routes/workouts');
const macroRoutes = require('./routes/macros');
const cardioRoutes = require('./routes/cardio');
const weightRoutes = require('./routes/weight');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET is not set. Using an insecure default — set this in production.');
}

// Behind Cloudflare Tunnel: trust the single hop from cloudflared so
// req.ip / req.secure reflect the real client via X-Forwarded-* headers.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use(
  '/vendor/chartjs',
  express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist'))
);

app.use(
  session({
    store: new SqliteSessionStore(),
    secret: process.env.SESSION_SECRET || 'insecure-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    name: 'fitness.sid',
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // default session length; extended on "remember me"
    },
  })
);

app.use(loadUser);

// Health check — see README for a note on Cloudflare Access bypass policies.
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/exercises', requireAuth, exerciseRoutes);
app.use('/templates', requireAuth, templateRoutes);
app.use('/workouts', requireAuth, workoutRoutes);
app.use('/macros', requireAuth, macroRoutes);
app.use('/cardio', requireAuth, cardioRoutes);
app.use('/weight', requireAuth, weightRoutes);
app.use('/', requireAuth, dashboardRoutes);

app.use((req, res) => {
  res.status(404).render('404');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('500');
});

app.listen(PORT, () => {
  console.log(`Fitness tracker listening on port ${PORT}`);
});
