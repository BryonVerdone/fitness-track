const crypto = require('crypto');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function generateInviteCode() {
  return crypto.randomBytes(16).toString('hex');
}

// Pace in min/mile for runs/walks; speed (mph) for cycle/other.
function paceAndSpeed(type, distanceMiles, durationSeconds) {
  if (!distanceMiles || distanceMiles <= 0) return { pace: null, speed: null };
  const hours = durationSeconds / 3600;
  const speedMph = distanceMiles / hours;
  const paceMinPerMile = durationSeconds / 60 / distanceMiles;
  return { pace: paceMinPerMile, speed: speedMph };
}

function formatPace(paceMinPerMile) {
  if (paceMinPerMile == null || !isFinite(paceMinPerMile)) return '--';
  const min = Math.floor(paceMinPerMile);
  const sec = Math.round((paceMinPerMile - min) * 60);
  return `${min}:${String(sec).padStart(2, '0')}/mi`;
}

function rollingAverage(entries, key, windowDays) {
  // entries assumed sorted ascending by date; returns array aligned with entries
  return entries.map((entry, idx) => {
    const cutoff = new Date(entry.date);
    cutoff.setDate(cutoff.getDate() - windowDays + 1);
    const windowEntries = entries
      .slice(0, idx + 1)
      .filter((e) => new Date(e.date) >= cutoff);
    const sum = windowEntries.reduce((acc, e) => acc + e[key], 0);
    return sum / windowEntries.length;
  });
}

module.exports = { todayStr, generateInviteCode, paceAndSpeed, formatPace, rollingAverage };
