import { useMemo } from "react";
import {
  BarChart3,
  Bookmark,
  CheckCircle2,
  Clock,
  Gamepad2,
  HardDrive,
  Heart,
  PlayCircle,
  Trophy,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLanguage } from "@/context/LanguageContext";

const formatBytes = bytes => {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[idx]}`;
};

const formatHours = seconds => {
  if (!seconds || seconds < 60) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

export default function LibraryStatsDialog({
  open,
  onOpenChange,
  games = [],
  folderGames = [],
  storeGames = [],
  deletedGames = [],
  favorites = [],
  storageInfo = null,
  totalGamesSize = 0,
  onSelectGame,
}) {
  const { t } = useLanguage();

  const stats = useMemo(() => {
    const byName = new Map();
    const addUnique = (list, isHistory = false) => {
      for (const item of list) {
        if (!item || item.isFolder || item._isDownloading || item._isQueued) continue;
        const name = item.game || item.name;
        if (!name) continue;
        const existing = byName.get(name);
        if (!existing || (item.playTime || 0) > (existing.playTime || 0)) {
          byName.set(name, {
            ...item,
            _displayName: name,
            _isHistory: isHistory,
          });
        }
      }
    };

    addUnique(games, false);
    addUnique(folderGames, false);
    addUnique(storeGames, false);
    const activeCount = byName.size;
    addUnique(deletedGames, true);

    const allTracked = Array.from(byName.values());
    const totalSeconds = allTracked.reduce((sum, g) => sum + (g.playTime || 0), 0);
    const playedCount = allTracked.filter(g => (g.playTime || 0) >= 60).length;

    const topPlayed = allTracked
      .filter(g => (g.playTime || 0) >= 60)
      .sort((a, b) => (b.playTime || 0) - (a.playTime || 0))
      .slice(0, 10);

    let metaMap = {};
    try {
      metaMap = JSON.parse(localStorage.getItem("game-favorites-meta") || "{}");
    } catch {
      metaMap = {};
    }

    const statusCounts = { playing: 0, completed: 0, backlog: 0 };
    Object.values(metaMap).forEach(entry => {
      if (entry?.status && statusCounts[entry.status] !== undefined) {
        statusCounts[entry.status] += 1;
      }
    });
    const totalStatused =
      statusCounts.playing + statusCounts.completed + statusCounts.backlog;

    const drives =
      storageInfo?.directories?.length > 0
        ? storageInfo.directories
        : storageInfo
          ? [
              {
                path: t("library.storage") || "Primary Drive",
                totalSpace: storageInfo.totalSpace,
                freeSpace: storageInfo.freeSpace,
                gamesSize: totalGamesSize,
              },
            ]
          : [];

    return {
      activeCount,
      playedCount,
      totalSeconds,
      topPlayed,
      statusCounts,
      totalStatused,
      drives,
    };
  }, [games, folderGames, storeGames, deletedGames, storageInfo, totalGamesSize, t]);

  const maxTopSeconds = Math.max(stats.topPlayed[0]?.playTime || 1, 1);

  const statusMeta = [
    {
      key: "playing",
      label: t("library.favoritesGallery.status.playing") || "Playing",
      icon: PlayCircle,
      barClass: "bg-blue-500",
      textClass: "text-blue-400",
    },
    {
      key: "completed",
      label: t("library.favoritesGallery.status.completed") || "Completed",
      icon: CheckCircle2,
      barClass: "bg-emerald-500",
      textClass: "text-emerald-400",
    },
    {
      key: "backlog",
      label: t("library.favoritesGallery.status.backlog") || "Backlog",
      icon: Bookmark,
      barClass: "bg-amber-500",
      textClass: "text-amber-400",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-3xl overflow-y-auto rounded-[16px] border-border/70 bg-background p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-foreground">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary text-secondary">
              <BarChart3 className="h-5 w-5" />
            </span>
            {t("library.stats.title") || "Library Stats & Playtime"}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t("library.stats.subtitle") ||
              "Overview of your playtime, most-played games, completion progress, and drive storage."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-6">
          {/* Top KPI tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-[12px] border border-border/70 bg-card p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Clock className="h-3.5 w-3.5 text-primary" />
                <span>Total Playtime</span>
              </div>
              <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-foreground">
                {formatHours(stats.totalSeconds)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {stats.playedCount} played
              </p>
            </div>

            <div className="rounded-[12px] border border-border/70 bg-card p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Gamepad2 className="h-3.5 w-3.5 text-primary" />
                <span>Library Size</span>
              </div>
              <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-foreground">
                {stats.activeCount}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {Math.max(0, stats.activeCount - stats.playedCount)} unplayed
              </p>
            </div>

            <div className="rounded-[12px] border border-border/70 bg-card p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Heart className="h-3.5 w-3.5 text-primary" />
                <span>Favorites</span>
              </div>
              <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-foreground">
                {favorites.length}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {stats.statusCounts.completed} completed
              </p>
            </div>

            <div className="rounded-[12px] border border-border/70 bg-card p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <HardDrive className="h-3.5 w-3.5 text-primary" />
                <span>Games Storage</span>
              </div>
              <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-foreground">
                {formatBytes(totalGamesSize)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {stats.drives.length} {stats.drives.length === 1 ? "drive" : "drives"}
              </p>
            </div>
          </div>

          {/* Top 10 Most-Played Games */}
          <section className="rounded-[12px] border border-border/70 bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
                <Trophy className="h-4 w-4 text-primary" />
                Top 10 Most-Played Games
              </h3>
              <span className="text-xs text-muted-foreground">
                {stats.topPlayed.length} shown
              </span>
            </div>

            {stats.topPlayed.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No playtime recorded yet. Launch a game to start tracking!
              </p>
            ) : (
              <div className="space-y-2.5">
                {stats.topPlayed.map((game, index) => {
                  const pct = Math.max(
                    4,
                    Math.round(((game.playTime || 0) / maxTopSeconds) * 100)
                  );
                  const clickable = !game._isHistory && typeof onSelectGame === "function";
                  return (
                    <button
                      key={`${game._displayName}-${index}`}
                      type="button"
                      disabled={!clickable}
                      onClick={() => {
                        if (!clickable) return;
                        onOpenChange(false);
                        onSelectGame(game);
                      }}
                      className="group block w-full rounded-[8px] px-2 py-1.5 text-left transition-colors hover:bg-accent/50 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-muted-foreground">
                            #{index + 1}
                          </span>
                          <span className="truncate font-medium text-foreground">
                            {game._displayName}
                          </span>
                          {game._isHistory && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              History
                            </span>
                          )}
                        </div>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                          {formatHours(game.playTime)}
                        </span>
                      </div>
                      <div className="mt-1.5 ml-7 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Completion Breakdown + Storage Per Drive */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Completion Breakdown */}
            <section className="rounded-[12px] border border-border/70 bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold tracking-tight text-foreground">
                Completion Breakdown
              </h3>
              {stats.totalStatused === 0 ? (
                <p className="py-5 text-sm text-muted-foreground">
                  Set a game status (Playing, Completed, or Backlog) in Favorites to track
                  completion progress.
                </p>
              ) : (
                <>
                  <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-muted">
                    {statusMeta.map(item => {
                      const count = stats.statusCounts[item.key];
                      if (!count) return null;
                      return (
                        <div
                          key={item.key}
                          className={item.barClass}
                          style={{ width: `${(count / stats.totalStatused) * 100}%` }}
                          title={`${item.label}: ${count}`}
                        />
                      );
                    })}
                  </div>
                  <div className="space-y-2">
                    {statusMeta.map(item => {
                      const Icon = item.icon;
                      const count = stats.statusCounts[item.key];
                      const pct = Math.round((count / stats.totalStatused) * 100);
                      return (
                        <div
                          key={item.key}
                          className="flex items-center justify-between rounded-[8px] bg-background/60 px-3 py-2 text-sm"
                        >
                          <span className="flex items-center gap-2 font-medium text-foreground">
                            <Icon className={`h-4 w-4 ${item.textClass}`} />
                            {item.label}
                          </span>
                          <span className="tabular-nums text-xs font-semibold text-muted-foreground">
                            <strong className="text-foreground">{count}</strong> ({pct}%)
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>

            {/* Storage Per Drive */}
            <section className="rounded-[12px] border border-border/70 bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold tracking-tight text-foreground">
                Storage by Drive
              </h3>
              {stats.drives.length === 0 ? (
                <p className="py-5 text-sm text-muted-foreground">
                  No storage information available yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {stats.drives.map((drive, idx) => {
                    const total = drive.totalSpace || 1;
                    const usedPct = Math.min(
                      ((total - (drive.freeSpace || 0)) / total) * 100,
                      100
                    );
                    const gamesPct = Math.min(
                      ((drive.gamesSize || 0) / total) * 100,
                      100
                    );
                    const label =
                      drive.path?.split(/[\\/]/).filter(Boolean).pop() ||
                      drive.path ||
                      `Drive ${idx + 1}`;
                    return (
                      <div key={drive.path || idx} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span
                            className="truncate font-semibold text-foreground"
                            title={drive.path}
                          >
                            {label}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatBytes(drive.freeSpace)} free / {formatBytes(total)}
                          </span>
                        </div>
                        <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="absolute left-0 top-0 h-full rounded-full bg-muted-foreground/30"
                            style={{ width: `${usedPct}%` }}
                          />
                          <div
                            className="absolute left-0 top-0 h-full rounded-full bg-primary"
                            style={{ width: `${gamesPct}%` }}
                          />
                        </div>
                        <p className="text-[11px] tabular-nums text-muted-foreground">
                          Games: {formatBytes(drive.gamesSize || 0)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
