import recentGamesService from "@/services/library/recentGamesService";

export function getLibraryGameName(game) {
  return game?.game || game?.name || "";
}

export function normalizePlayTime(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function formatPlayTime(value) {
  const seconds = normalizePlayTime(value);
  if (seconds <= 0) return "";
  if (seconds < 60) return "<1m";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

export async function loadSmartCollectionLibrary() {
  const [installed, custom] = await Promise.all([
    window.electron.getGames(),
    window.electron.getCustomGames(),
  ]);

  const normalized = [
    ...(Array.isArray(installed)
      ? installed.map(game => ({ ...game, isCustom: false }))
      : []),
    ...(Array.isArray(custom)
      ? custom.map(game => ({
          ...game,
          name: game.game || game.name,
          game: game.game || game.name,
          isCustom: true,
          custom: true,
        }))
      : []),
  ];

  const seen = new Set();
  const games = normalized.filter(game => {
    const name = getLibraryGameName(game);
    const key = `${game.isCustom ? "custom" : "installed"}:${name}`;
    if (!name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    games,
    recentGames: recentGamesService.getRecentGames(),
  };
}

export function buildSmartCollections(games, recentGames) {
  const recentByName = new Map();
  for (const game of recentGames) {
    recentByName.set(getLibraryGameName(game), game);
  }

  const continuePlaying = recentGames
    .map(recent =>
      games.find(game => getLibraryGameName(game) === getLibraryGameName(recent))
    )
    .filter(Boolean);

  return {
    recentByName,
    collections: [
      {
        id: "continue",
        games: continuePlaying,
      },
      {
        id: "neverPlayed",
        games: games.filter(
          game =>
            normalizePlayTime(game.playTime) <= 0 &&
            !recentByName.has(getLibraryGameName(game))
        ),
      },
      {
        id: "played",
        games: games.filter(
          game =>
            normalizePlayTime(game.playTime) > 0 ||
            recentByName.has(getLibraryGameName(game))
        ),
      },
      {
        id: "custom",
        games: games.filter(game => game.isCustom),
      },
      {
        id: "online",
        games: games.filter(game => Boolean(game.online)),
      },
      {
        id: "vr",
        games: games.filter(game => Boolean(game.isVr)),
      },
      {
        id: "dlc",
        games: games.filter(game => Boolean(game.dlc)),
      },
    ],
  };
}

const TEN_GB_BYTES = 10 * 1024 * 1024 * 1024;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export function parseGameSizeBytes(size) {
  if (typeof size === "number" && Number.isFinite(size) && size > 0) {
    return size;
  }
  if (typeof size !== "string") return 0;
  const match = size.trim().match(/^([\d.,]+)\s*(B|KB|MB|GB|TB)\b/i);
  if (!match) return 0;
  const value = parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return 0;
  const unit = match[2].toUpperCase();
  const multipliers = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  return value * (multipliers[unit] || 0);
}

export function buildLibrarySmartCollections(games, recentGames = []) {
  const recentNames = new Set(recentGames.map(getLibraryGameName).filter(Boolean));
  const now = Date.now();

  const seen = new Set();
  const uniqueGames = [];
  for (const game of games) {
    if (!game || game.isFolder || game._isDownloading || game._isQueued) continue;
    const name = getLibraryGameName(game);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    uniqueGames.push(game);
  }

  const installedTimestamp = game =>
    Number(game.installedAt || game.addedAt || game.downloadDate || 0);

  const recentCandidates = uniqueGames
    .filter(game => installedTimestamp(game) > 0)
    .sort((a, b) => installedTimestamp(b) - installedTimestamp(a));
  const withinTwoWeeks = recentCandidates.filter(
    game => now - installedTimestamp(game) <= FOURTEEN_DAYS_MS
  );
  const recentlyInstalled =
    withinTwoWeeks.length > 0 ? withinTwoWeeks : recentCandidates.slice(0, 12);

  const unplayedBacklog = uniqueGames.filter(
    game =>
      normalizePlayTime(game.playTime) < 60 && !recentNames.has(getLibraryGameName(game))
  );

  const coopOnline = uniqueGames.filter(game => Boolean(game.online));

  const under10gb = uniqueGames.filter(game => {
    const bytes = parseGameSizeBytes(game.size || game.sizeBytes || game.diskSize);
    return bytes > 0 && bytes <= TEN_GB_BYTES;
  });

  const includesDlc = uniqueGames.filter(game => Boolean(game.dlc));

  return [
    {
      id: "recentlyInstalled",
      label: "Recently Installed",
      description: "Newest additions to your local library.",
      games: recentlyInstalled,
    },
    {
      id: "unplayedBacklog",
      label: "Unplayed Backlog",
      description: "Installed games you haven't launched yet.",
      games: unplayedBacklog,
    },
    {
      id: "coopOnline",
      label: "Co-op & Online",
      description: "Games with multiplayer or online support.",
      games: coopOnline,
    },
    {
      id: "under10gb",
      label: "Under 10 GB",
      description: "Lightweight games that take up minimal drive space.",
      games: under10gb,
    },
    {
      id: "includesDlc",
      label: "Includes DLC",
      description: "Games bundled with extra content or expansions.",
      games: includesDlc,
    },
  ].filter(collection => collection.games.length > 0);
}
