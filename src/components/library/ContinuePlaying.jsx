import { memo, useEffect, useState } from "react";
import { ArrowRight, Clock3, Gamepad2, History, Play } from "lucide-react";
import { StatGroup, StatTile } from "@/components/home/StatTile";
import { formatDuration } from "@/services/library/weeklyActivityService";
import { heroImageCache, logoImageCache } from "@/lib/gameImageCache";
import { imageDataUrlFromBase64, sanitizeText } from "@/lib/utils";

// Wide art and logo come from the files downloaded with the game, shared with
// the library cards through the same caches
const useLocalArt = (name, type, cache) => {
  const [url, setUrl] = useState(() => cache.get(name) ?? null);

  useEffect(() => {
    if (!name) return undefined;
    let active = true;
    const load = async (force = false) => {
      if (!force && cache.has(name)) {
        setUrl(cache.get(name));
        return;
      }
      try {
        const base64 = await window.electron.getGameImage(name, type);
        const dataUrl = imageDataUrlFromBase64(base64);
        cache.set(name, dataUrl);
        if (active) setUrl(dataUrl);
      } catch {
        // No art on disk; the banner falls back to the cover or the title
      }
    };
    load();
    const unsubscribe = window.electron.onGameAssetsUpdated?.(({ game }) => {
      if (game === name) load(true);
    });
    return () => {
      active = false;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [name, type, cache]);

  return url;
};

const coverCache = new Map(); // game name -> default cover, when there is no wide art

const formatLastPlayed = (value, locale) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "—";
  const minutes = Math.round((date.getTime() - Date.now()) / 60000);
  const format = new Intl.RelativeTimeFormat(locale || undefined, {
    numeric: "auto",
    style: "short",
  });
  const hours = Math.round(minutes / 60);
  const text =
    Math.abs(minutes) < 1
      ? format.format(0, "second")
      : Math.abs(minutes) < 60
        ? format.format(minutes, "minute")
        : Math.abs(hours) < 24
          ? format.format(hours, "hour")
          : format.format(Math.round(hours / 24), "day");
  return text.charAt(0).toLocaleUpperCase(locale || undefined) + text.slice(1);
};

/**
 * The game played last, as a wide banner at the top of the library: its art,
 * logo, a tray of play stats and a button to its page.
 */
const ContinuePlaying = memo(({ game, locale, t, onOpen }) => {
  const name = game.game || game.name;
  const hero = useLocalArt(name, "hero", heroImageCache);
  const cover = useLocalArt(hero ? null : name, undefined, coverCache);
  const logo = useLocalArt(name, "logo", logoImageCache);
  const [logoFailed, setLogoFailed] = useState(false);
  const title = sanitizeText(name);
  const art = hero || cover;

  return (
    <section
      data-tour="library-continue"
      className="group relative mb-8 h-[clamp(260px,36vh,400px)] cursor-pointer overflow-hidden rounded-[16px] border border-border/70 bg-card"
      onClick={() => onOpen(game)}
    >
      {art ? (
        <img
          src={art}
          alt=""
          draggable="false"
          className="absolute inset-0 h-full w-full object-cover object-[center_30%] transition-transform duration-700 group-hover:scale-[1.02]"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Gamepad2 className="h-12 w-12 text-muted-foreground/30" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-2/3 bg-gradient-to-l from-background/90 via-background/50 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-background/90 via-background/40 to-transparent" />

      <div className="absolute inset-0 flex items-end justify-between gap-6 p-[clamp(16px,3vw,40px)]">
        <StatGroup className="hidden w-[360px] shrink-0 lg:grid">
          <StatTile
            label={t("library.playTime")}
            valueClassName="min-h-[76px] text-[1.4rem]"
          >
            {formatDuration(game.playTime)}
            <Clock3 className="h-5 w-5 shrink-0" strokeWidth={1.75} />
          </StatTile>
          <StatTile
            label={t("library.continue.lastPlayed")}
            valueClassName="min-h-[76px] text-[1.15rem]"
          >
            <span className="truncate">{formatLastPlayed(game.lastPlayed, locale)}</span>
            <History className="h-5 w-5 shrink-0" strokeWidth={1.75} />
          </StatTile>
        </StatGroup>

        <div className="ml-auto flex min-w-0 max-w-[520px] flex-col items-end gap-4 text-right">
          <span className="inline-flex items-center gap-2 rounded-[6px] border border-foreground/15 bg-foreground/20 px-3 py-1.5 text-sm text-foreground/90 backdrop-blur-md">
            <Play className="h-3.5 w-3.5" strokeWidth={2} />
            {t("library.continue.title")}
          </span>
          {logo && !logoFailed ? (
            <img
              src={logo}
              alt={title}
              draggable="false"
              onError={() => setLogoFailed(true)}
              className="max-h-[120px] w-auto max-w-[min(420px,100%)] object-contain object-right drop-shadow-[0_8px_30px_rgb(0_0_0/0.6)]"
            />
          ) : (
            <h2 className="m-0 text-balance text-3xl font-bold uppercase leading-[0.95] tracking-tight text-foreground lg:text-4xl">
              {title}
            </h2>
          )}
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onOpen(game);
            }}
            className="flex h-[46px] items-center gap-6 rounded-[10px] bg-primary pl-5 pr-1.5 text-[15px] text-secondary shadow-[0_0_28px_rgb(var(--color-primary)/0.25)] transition-[box-shadow,transform] hover:shadow-[0_0_36px_rgb(var(--color-primary)/0.4)] active:scale-[0.98]"
          >
            {t("library.continue.open")}
            <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-background text-foreground">
              <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2} />
            </span>
          </button>
        </div>
      </div>
    </section>
  );
});
ContinuePlaying.displayName = "ContinuePlaying";

export default ContinuePlaying;
