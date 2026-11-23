import { useEffect, useRef, useState } from "react";
import { Clock, Moon, Power, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/context/SettingsContext";
import { cn } from "@/lib/utils";

const SCHEDULER_KEY = "ascendara-download-scheduler";
const COUNTDOWN_SECONDS = 30;

const DEFAULT_SCHEDULER = {
  quietHoursEnabled: false,
  startTime: "22:00",
  endTime: "07:00",
  quietLimitMB: 5,
  savedNormalLimitKB: null,
};

function readScheduler() {
  try {
    const raw = localStorage.getItem(SCHEDULER_KEY);
    if (!raw) return DEFAULT_SCHEDULER;
    return { ...DEFAULT_SCHEDULER, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SCHEDULER;
  }
}

function isWithinQuietHours(startTime, endTime, now = new Date()) {
  const toMinutes = str => {
    const [h, m] = String(str || "00:00")
      .split(":")
      .map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const current = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

const ACTION_LABELS = {
  none: "Do nothing",
  close: "Close Ascendara",
  sleep: "Sleep PC",
  shutdown: "Shut down PC",
};

export default function DownloadSchedulerBar({ hasActiveWork }) {
  const { settings, setSettings } = useSettings();
  const [action, setAction] = useState(
    () =>
      localStorage.getItem("ascendara-queue-finish-action") ||
      settings?.behaviorAfterDownload ||
      "none"
  );
  const [scheduler, setScheduler] = useState(readScheduler);
  const [showQuietConfig, setShowQuietConfig] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [quietActive, setQuietActive] = useState(false);
  const hadActiveWorkRef = useRef(hasActiveWork);

  // Persist post-queue action
  const handleActionChange = value => {
    setAction(value);
    setCountdown(null);
    try {
      localStorage.setItem("ascendara-queue-finish-action", value);
    } catch {}
    if (["none", "sleep", "shutdown"].includes(value)) {
      const next = { ...settings, behaviorAfterDownload: value };
      setSettings(next);
      window.electron?.saveSettings?.(next);
    }
  };

  // Persist quiet hours config
  const updateScheduler = patch => {
    setScheduler(prev => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SCHEDULER_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Trigger cancellable countdown when active downloads + queue transition from busy -> idle
  useEffect(() => {
    const wasBusy = hadActiveWorkRef.current;
    hadActiveWorkRef.current = hasActiveWork;
    if (wasBusy && !hasActiveWork && action && action !== "none") {
      setCountdown(COUNTDOWN_SECONDS);
    } else if (hasActiveWork && countdown !== null) {
      setCountdown(null);
    }
  }, [hasActiveWork, action, countdown]);

  // Tick countdown & execute chosen action at 0
  useEffect(() => {
    if (countdown === null) return undefined;
    if (countdown <= 0) {
      setCountdown(null);
      (async () => {
        try {
          if (action === "close") {
            await window.electron?.closeWindow?.(true);
          } else if (action === "sleep") {
            const res = await window.electron?.sleepSystem?.();
            if (res && !res.success) toast.error(res.error || "Could not sleep PC");
          } else if (action === "shutdown") {
            const res = await window.electron?.shutdownSystem?.();
            if (res && !res.success) toast.error(res.error || "Could not shut down PC");
          }
        } catch (error) {
          console.error("[DownloadSchedulerBar] Post-queue action failed:", error);
          toast.error("Post-download action failed");
        }
      })();
      return undefined;
    }
    const timer = setTimeout(() => setCountdown(c => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown, action]);

  // Apply/restore quiet-hours download speed limit every 30s
  useEffect(() => {
    const checkQuietHours = () => {
      if (!scheduler.quietHoursEnabled) {
        setQuietActive(false);
        if (scheduler.savedNormalLimitKB !== null) {
          const restored = { ...settings, downloadLimit: scheduler.savedNormalLimitKB };
          setSettings(restored);
          window.electron?.saveSettings?.(restored);
          updateScheduler({ savedNormalLimitKB: null });
        }
        return;
      }

      const inWindow = isWithinQuietHours(scheduler.startTime, scheduler.endTime);
      setQuietActive(inWindow);
      const targetKB = Math.max(1, Number(scheduler.quietLimitMB) || 5) * 1024;

      if (inWindow && settings.downloadLimit !== targetKB) {
        const previousLimit =
          scheduler.savedNormalLimitKB !== null
            ? scheduler.savedNormalLimitKB
            : settings.downloadLimit || 0;
        updateScheduler({ savedNormalLimitKB: previousLimit });
        const next = { ...settings, downloadLimit: targetKB };
        setSettings(next);
        window.electron?.saveSettings?.(next);
      } else if (!inWindow && scheduler.savedNormalLimitKB !== null) {
        const next = { ...settings, downloadLimit: scheduler.savedNormalLimitKB };
        setSettings(next);
        window.electron?.saveSettings?.(next);
        updateScheduler({ savedNormalLimitKB: null });
      }
    };

    checkQuietHours();
    const interval = setInterval(checkQuietHours, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scheduler.quietHoursEnabled,
    scheduler.startTime,
    scheduler.endTime,
    scheduler.quietLimitMB,
  ]);

  return (
    <div className="space-y-3">
      {/* Active post-queue countdown alert */}
      {countdown !== null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-primary/40 bg-primary/10 px-4 py-3">
          <div className="flex items-center gap-2.5 text-sm font-medium text-foreground">
            <Power className="h-4 w-4 text-primary" />
            <span>
              All downloads finished — <strong>{ACTION_LABELS[action]}</strong> in{" "}
              <span className="tabular-nums font-bold text-primary">{countdown}s</span>
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCountdown(null)}
            className="h-8 gap-1.5 rounded-[8px] border-primary/40 bg-card text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>
        </div>
      )}

      {/* Compact scheduler bar */}
      <div className="rounded-[12px] border border-border/70 bg-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Power className="h-3.5 w-3.5 text-primary" />
              <span>When queue finishes</span>
            </div>
            <Select value={action} onValueChange={handleActionChange}>
              <SelectTrigger className="h-8 w-[170px] rounded-[8px] border-border/70 bg-background text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Do nothing</SelectItem>
                <SelectItem value="close">Close Ascendara</SelectItem>
                <SelectItem value="sleep">Sleep PC</SelectItem>
                <SelectItem value="shutdown">Shut down PC</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2.5">
            {quietActive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-secondary">
                <Moon className="h-3 w-3" />
                Quiet limit ({scheduler.quietLimitMB} MB/s)
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowQuietConfig(prev => !prev)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs font-medium transition-colors",
                scheduler.quietHoursEnabled
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/70 bg-background text-muted-foreground hover:border-foreground/25 hover:text-foreground"
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Quiet hours</span>
            </button>
          </div>
        </div>

        {showQuietConfig && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-3">
            <div className="flex items-center gap-2.5">
              <Switch
                checked={scheduler.quietHoursEnabled}
                onCheckedChange={checked =>
                  updateScheduler({ quietHoursEnabled: checked })
                }
              />
              <span className="text-xs font-medium text-foreground">
                Throttle downloads during quiet hours
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <label className="flex items-center gap-1.5">
                <span>From</span>
                <input
                  type="time"
                  value={scheduler.startTime}
                  onChange={e => updateScheduler({ startTime: e.target.value })}
                  className="h-8 rounded-[8px] border border-border/70 bg-background px-2 text-xs text-foreground"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span>to</span>
                <input
                  type="time"
                  value={scheduler.endTime}
                  onChange={e => updateScheduler({ endTime: e.target.value })}
                  className="h-8 rounded-[8px] border border-border/70 bg-background px-2 text-xs text-foreground"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span>Limit</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={scheduler.quietLimitMB}
                  onChange={e =>
                    updateScheduler({
                      quietLimitMB: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                  className="h-8 w-16 rounded-[8px] border border-border/70 bg-background px-2 text-xs tabular-nums text-foreground"
                />
                <span>MB/s</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
