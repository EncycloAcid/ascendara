import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, Flame, History } from "lucide-react";
import { cn } from "@/lib/utils";

function formatDuration(seconds) {
  if (!seconds || seconds < 60) {
    return `${Math.max(0, Math.round(seconds || 0))}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatSessionTimestamp(ms) {
  if (!ms) return "";
  try {
    const d = new Date(ms);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatShortDate(dateKey) {
  if (!dateKey) return "";
  try {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateKey;
  }
}

export default function PlaytimeTimelineCard({
  gameName = null,
  active = true,
  maxSessions = 8,
  onSelectGame = null,
  className = "",
}) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!active || !window.electron?.getPlaySessions) return;
    let cancelled = false;
    window.electron
      .getPlaySessions({ gameName, days: 30, limit: 100 })
      .then(res => {
        if (!cancelled) setData(res || null);
      })
      .catch(err => {
        console.warn("[PlaytimeTimeline] Failed to load sessions:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [gameName, active]);

  const heatmap = useMemo(() => {
    const totals = data?.dailyTotals || {};
    const keys = Object.keys(totals).sort();
    const maxSec = Math.max(1800, ...keys.map(k => totals[k] || 0));
    let activeDays = 0;

    const cells = keys.map(key => {
      const sec = totals[key] || 0;
      if (sec > 0) activeDays++;
      let level = 0;
      if (sec > 0) {
        const ratio = sec / maxSec;
        if (ratio >= 0.75) level = 4;
        else if (ratio >= 0.45) level = 3;
        else if (ratio >= 0.2) level = 2;
        else level = 1;
      }
      return { key, seconds: sec, level };
    });

    return { cells, activeDays };
  }, [data]);

  const sessions = (data?.sessions || []).slice(0, maxSessions);
  const windowSeconds = data?.windowSeconds || 0;

  return (
    <div
      className={cn(
        "rounded-[12px] border border-border/70 bg-card/80 p-4",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">
            {gameName ? "30-Day Activity & Sessions" : "30-Day Activity Heatmap"}
          </h3>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Flame className="h-3.5 w-3.5 text-primary" />
            {heatmap.activeDays} {heatmap.activeDays === 1 ? "day" : "days"}
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock className="h-3.5 w-3.5" />
            {formatDuration(windowSeconds)}
          </span>
        </div>
      </div>

      {/* 30-day heatmap strip */}
      <div className="mt-3 grid grid-cols-[repeat(15,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(30,minmax(0,1fr))]">
        {heatmap.cells.map(cell => (
          <div
            key={cell.key}
            title={`${formatShortDate(cell.key)}: ${cell.seconds > 0 ? formatDuration(cell.seconds) : "No activity"}`}
            className={cn(
              "h-4 rounded-[3px] border border-border/40 transition-transform hover:scale-110",
              cell.level === 0 && "bg-muted/50",
              cell.level === 1 && "bg-primary/25",
              cell.level === 2 && "bg-primary/50",
              cell.level === 3 && "bg-primary/75",
              cell.level === 4 && "bg-primary"
            )}
          />
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>30 days ago</span>
        <div className="flex items-center gap-1">
          <span>Less</span>
          <span className="h-2.5 w-2.5 rounded-[2px] bg-muted/50" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-primary/30" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-primary/65" />
          <span className="h-2.5 w-2.5 rounded-[2px] bg-primary" />
          <span>More</span>
        </div>
        <span>Today</span>
      </div>

      {/* Recent sessions list */}
      <div className="mt-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          <span>Recent Sessions</span>
        </div>
        {sessions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 py-4 text-center text-xs text-muted-foreground">
            Play sessions will appear here automatically after you finish playing.
          </p>
        ) : (
          <div className="space-y-1">
            {sessions.map(session => (
              <div
                key={session.id}
                onClick={
                  !gameName && onSelectGame
                    ? () => onSelectGame(session.game)
                    : undefined
                }
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-1.5 text-xs",
                  !gameName &&
                    onSelectGame &&
                    "cursor-pointer transition-colors hover:border-primary/40 hover:bg-background/70"
                )}
              >
                <div className="min-w-0">
                  {!gameName && (
                    <p className="truncate font-medium text-foreground">
                      {session.game}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {formatSessionTimestamp(session.startedAt)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
                  {formatDuration(session.durationSeconds)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
