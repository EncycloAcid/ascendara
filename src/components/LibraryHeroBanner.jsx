import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Gamepad2,
  Import,
  Play,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/LanguageContext";
import {
  gameImageCache,
  heroImageCache,
  logoImageCache,
  loadGameCover,
} from "@/lib/gameImageCache";

const formatPlaytime = (seconds, t) => {
  if (!seconds || seconds < 60) {
    return t("library.neverPlayed") || "Not played yet";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

export default function LibraryHeroBanner({
  game,
  hasUpdate = false,
  isRunning = false,
  collapsed = false,
  onToggleCollapse,
  onPlay,
}) {
  const { t } = useLanguage();
  const gameId = game?.game || game?.name || "";

  const [heroData, setHeroData] = useState(() => heroImageCache.get(gameId) ?? null);
  const [logoData, setLogoData] = useState(() => logoImageCache.get(gameId) ?? null);
  const [coverData, setCoverData] = useState(() => gameImageCache.get(gameId) ?? null);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;

    setHeroData(heroImageCache.get(gameId) ?? null);
    setLogoData(logoImageCache.get(gameId) ?? null);
    setCoverData(gameImageCache.get(gameId) ?? null);

    const loadAssets = async () => {
      if (!heroImageCache.has(gameId) && window.electron?.getGameImage) {
        try {
          const hero = await window.electron.getGameImage(gameId, "hero");
          if (!cancelled && hero) {
            const url = `data:image/jpeg;base64,${hero}`;
            heroImageCache.set(gameId, url);
            setHeroData(url);
          }
        } catch {
          /* silent fallback to cover */
        }
      }

      if (!logoImageCache.has(gameId) && window.electron?.getGameImage) {
        try {
          const logo = await window.electron.getGameImage(gameId, "logo");
          if (!cancelled && logo) {
            const url = `data:image/png;base64,${logo}`;
            logoImageCache.set(gameId, url);
            setLogoData(url);
          }
        } catch {
          /* silent fallback to title text */
        }
      }

      if (!gameImageCache.has(gameId)) {
        try {
          const cover = await loadGameCover(game);
          if (!cancelled && cover) {
            setCoverData(cover);
          }
        } catch {
          /* silent */
        }
      }
    };

    loadAssets();
    return () => {
      cancelled = true;
    };
  }, [gameId, game]);

  if (!game) return null;

  const backdrop = heroData || coverData;
  const playtimeText = formatPlaytime(game.playTime, t);

  if (collapsed) {
    return (
      <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-border/40 bg-card/70 px-4 py-2.5 shadow-sm backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("home.continuePlaying") || "Continue Playing"}
            </p>
            <p className="truncate text-sm font-semibold text-foreground">{gameId}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            className="h-8 gap-1.5 rounded-xl font-semibold text-secondary"
            onClick={() => onPlay(game)}
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            {t("library.view.play") || "Play"}
          </Button>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand featured game banner"
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/40 bg-background/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => onPlay(game)}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay(game);
        }
      }}
      className="group relative mb-6 cursor-pointer overflow-hidden rounded-2xl border border-border/40 bg-zinc-950 shadow-sm transition-all duration-300 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {/* Hero artwork backdrop */}
      <div className="relative flex min-h-[168px] flex-col justify-between p-5 sm:min-h-[188px] sm:p-6">
        {backdrop ? (
          <img
            src={backdrop}
            alt=""
            aria-hidden
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]",
              !heroData && "scale-110 blur-md brightness-75"
            )}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-zinc-900 to-zinc-950" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/65 to-black/25" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20" />

        {/* Top badges & collapse toggle */}
        <div className="relative z-10 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white backdrop-blur-md">
              <Sparkles className="h-3 w-3 text-primary" />
              {t("home.continuePlaying") || "Continue Playing"}
            </span>
            {isRunning && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300 backdrop-blur-md">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                {t("library.view.playing") || "Playing"}
              </span>
            )}
            {hasUpdate && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-secondary shadow-sm">
                <Import className="h-3 w-3" />
                {t("gameScreen.updateBadge") || "Update"}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            aria-label="Collapse featured game banner"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/80 backdrop-blur-md transition-colors hover:bg-black/65 hover:text-white"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>

        {/* Bottom title/logo + actions */}
        <div className="relative z-10 mt-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 max-w-xl">
            {logoData ? (
              <img
                src={logoData}
                alt={gameId}
                className="mb-2 max-h-14 max-w-[260px] object-contain object-left drop-shadow-[0_4px_12px_rgba(0,0,0,0.85)]"
              />
            ) : (
              <h2 className="mb-1.5 truncate text-2xl font-bold tracking-tight text-white drop-shadow-sm sm:text-3xl">
                {gameId}
              </h2>
            )}
            <div className="flex flex-wrap items-center gap-3 text-xs text-white/80">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-white/70" />
                {playtimeText}
              </span>
              {game.version && (
                <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-sm">
                  v{game.version}
                </span>
              )}
              {game.online && (
                <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-sm">
                  <Gamepad2 className="h-3 w-3" />
                  Online
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              className="h-9 gap-2 rounded-xl px-4 font-semibold text-secondary shadow-md"
              onClick={e => {
                e.stopPropagation();
                onPlay(game);
              }}
            >
              <Play className="h-4 w-4 fill-current" />
              {t("library.view.play") || "Play"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
