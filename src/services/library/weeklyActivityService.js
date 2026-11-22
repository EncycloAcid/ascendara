// A local, per-day record of library playtime so Home can show what happened
// this week. The library only stores running totals (playTime in seconds and
// launchCount), so each day keeps the last totals seen that day and the
// weekly numbers are the differences between those snapshots.

const STORAGE_KEY = "ascendara:weekly-activity";
const KEEP_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

export const dayKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const readLog = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeLog = log => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Storage full or unavailable: the stats just stay at their last values
  }
};

const toCount = value => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/** Record today's library totals. Call with every installed (and custom) game. */
export function recordLibrarySnapshot(games) {
  // An empty list is far more likely a failed read than an emptied library,
  // and recording it would make every game look newly installed tomorrow
  if (!Array.isArray(games) || games.length === 0) return;

  const entry = {};
  for (const game of games) {
    const name = game?.game || game?.name;
    if (!name) continue;
    entry[name] = [toCount(game.playTime), toCount(game.launchCount)];
  }
  if (Object.keys(entry).length === 0) return;

  const log = readLog();
  const today = dayKey();
  if (JSON.stringify(log[today]) === JSON.stringify(entry)) return;
  log[today] = entry;

  const cutoff = dayKey(new Date(Date.now() - KEEP_DAYS * DAY_MS));
  for (const key of Object.keys(log)) {
    if (key < cutoff) delete log[key];
  }
  writeLog(log);
}

// Growth from one snapshot to a later one. A game missing from the earlier
// snapshot counts from zero growth: it may be a reinstall carrying old totals.
const growth = (from, to, index) => {
  let total = 0;
  for (const [name, values] of Object.entries(to || {})) {
    const before = from?.[name];
    if (!before) continue;
    total += Math.max(0, toCount(values[index]) - toCount(before[index]));
  }
  return total;
};

/**
 * Stats for the seven days ending today.
 * @param {string} [locale] Used for the weekday labels.
 */
export function getWeeklyActivity(locale, now = new Date()) {
  const log = readLog();
  const keys = Object.keys(log).sort();
  const weekday = new Intl.DateTimeFormat(locale || undefined, { weekday: "narrow" });

  const days = [];
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    days.push({ key: dayKey(date), label: weekday.format(date), seconds: 0 });
  }

  const empty = {
    days,
    totalSeconds: 0,
    newGames: 0,
    launches: 0,
    favorite: null,
    avgSessionSeconds: 0,
    libraryCount: 0,
  };
  if (keys.length === 0) return empty;

  const windowStart = days[0].key;
  const earlier = keys.filter(key => key < windowStart);
  const baselineKey = earlier.length
    ? earlier[earlier.length - 1]
    : keys.find(key => key >= windowStart);
  const latestKey = keys[keys.length - 1];
  const baseline = log[baselineKey] || {};
  const latest = log[latestKey] || {};

  for (const day of days) {
    if (!log[day.key]) continue;
    const previous = keys.filter(key => key < day.key).pop();
    if (previous) day.seconds = growth(log[previous], log[day.key], 0);
  }

  let favorite = null;
  for (const [name, values] of Object.entries(latest)) {
    const before = baseline[name];
    if (!before) continue;
    const seconds = Math.max(0, toCount(values[0]) - toCount(before[0]));
    if (seconds > 0 && (!favorite || seconds > favorite.seconds)) {
      favorite = { name, seconds };
    }
  }

  let lifetimeSeconds = 0;
  let lifetimeLaunches = 0;
  for (const values of Object.values(latest)) {
    lifetimeSeconds += toCount(values[0]);
    lifetimeLaunches += toCount(values[1]);
  }

  return {
    days,
    totalSeconds: days.reduce((sum, day) => sum + day.seconds, 0),
    newGames:
      baselineKey === latestKey
        ? 0
        : Object.keys(latest).filter(name => !baseline[name]).length,
    launches: growth(baseline, latest, 1),
    favorite,
    avgSessionSeconds: lifetimeLaunches > 0 ? lifetimeSeconds / lifetimeLaunches : 0,
    libraryCount: Object.keys(latest).length,
  };
}

/** Short duration such as "19h", "2.5h" or "45m". */
export function formatDuration(seconds) {
  const value = toCount(seconds);
  if (value < 60) return "0h";
  if (value < 3600) return `${Math.round(value / 60)}m`;
  const hours = value / 3600;
  return `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)}h`;
}
