/**
 * Playtime Session History Store
 *
 * Persists individual game play sessions (game, start time, end time, duration, date)
 * in <userData>/play-sessions.json for the 30-day activity heatmap & session timeline.
 */

const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const { app } = require("electron");

const MAX_SESSIONS = 2000;
const MIN_DURATION_SECONDS = 5;

function getStorePath() {
  return path.join(app.getPath("userData"), "play-sessions.json");
}

function toLocalDateKey(timestampMs) {
  const d = new Date(timestampMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readSessionsSync() {
  try {
    const filePath = getStorePath();
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  } catch (err) {
    console.warn("[SessionHistory] Failed to read play-sessions.json:", err.message);
    return [];
  }
}

function writeSessionsSync(sessions) {
  try {
    const filePath = getStorePath();
    fs.ensureDirSync(path.dirname(filePath));
    const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, sessions }, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.warn("[SessionHistory] Failed to write play-sessions.json:", err.message);
  }
}

function recordPlaySession({ id, game, startedAt, endedAt, durationSeconds }) {
  if (!game || typeof game !== "string") return null;
  const end = Number.isFinite(endedAt) ? endedAt : Date.now();
  const start = Number.isFinite(startedAt) ? startedAt : end;
  const dur =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.round(durationSeconds)
      : Math.max(0, Math.round((end - start) / 1000));

  if (dur < MIN_DURATION_SECONDS) return null;

  const entry = {
    id: id || crypto.randomUUID(),
    game,
    startedAt: start,
    endedAt: end,
    durationSeconds: dur,
    date: toLocalDateKey(start),
  };

  const sessions = readSessionsSync();
  sessions.unshift(entry);
  if (sessions.length > MAX_SESSIONS) {
    sessions.length = MAX_SESSIONS;
  }
  writeSessionsSync(sessions);
  return entry;
}

function getPlaySessions({ gameName = null, days = 30, limit = 200 } = {}) {
  const all = readSessionsSync();
  const normalizedGame = gameName ? gameName.trim().toLowerCase() : null;
  const filtered = normalizedGame
    ? all.filter(s => (s.game || "").trim().toLowerCase() === normalizedGame)
    : all;

  // Build N-day daily totals (always includes today and the previous days-1 days)
  const dayCount = Math.max(1, Math.min(365, Number(days) || 30));
  const dailyTotals = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoffMs = today.getTime() - (dayCount - 1) * 86400000;

  for (let i = dayCount - 1; i >= 0; i--) {
    const key = toLocalDateKey(today.getTime() - i * 86400000);
    dailyTotals[key] = 0;
  }

  let windowSeconds = 0;
  for (const s of filtered) {
    if (!s || !Number.isFinite(s.startedAt) || !Number.isFinite(s.durationSeconds)) {
      continue;
    }
    if (s.startedAt >= cutoffMs) {
      const key = s.date || toLocalDateKey(s.startedAt);
      if (dailyTotals[key] !== undefined) {
        dailyTotals[key] += s.durationSeconds;
      }
      windowSeconds += s.durationSeconds;
    }
  }

  return {
    sessions: filtered.slice(0, Math.max(1, Math.min(500, Number(limit) || 200))),
    dailyTotals,
    windowSeconds,
    totalSessions: filtered.length,
  };
}

module.exports = {
  recordPlaySession,
  getPlaySessions,
  toLocalDateKey,
};
