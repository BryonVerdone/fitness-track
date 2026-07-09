const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || '/data/fitness.db';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Seed shared exercise database on first run only.
const exerciseCount = db.prepare('SELECT COUNT(*) AS c FROM exercises').get().c;
if (exerciseCount === 0) {
  const seedExercises = require('./seedExercises');
  const insert = db.prepare(
    'INSERT INTO exercises (name, category, equipment, notes) VALUES (@name, @category, @equipment, @notes)'
  );
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      insert.run({ notes: null, ...row });
    }
  });
  insertMany(seedExercises);
}

module.exports = db;
