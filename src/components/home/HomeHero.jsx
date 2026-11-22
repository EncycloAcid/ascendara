import { memo, useEffect, useState } from "react";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Download,
  Gift,
  Globe,
  HardDrive,
  CircleCheck,
  CirclePlus,
  Sparkles,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatGroup, StatTile } from "@/components/home/StatTile";
import steamGridImageService from "@/services/images/steamGridImageService";
import { cn, sanitizeText } from "@/lib/utils";

// Logos come from the heavier SteamGrid lookup, so each title is resolved at
// most once per session (the service also caches the result on disk)
const logoCache = new Map(); // game name -> logo URL or null

const useGameLogo = name => {
  const [logo, setLogo] = useState(() => (name ? logoCache.get(name) : undefined));

  useEffect(() => {
    if (!name) return undefined;
    if (logoCache.has(name)) {
      setLogo(logoCache.get(name));
      return undefined;
    }
    const cached = steamGridImageService.peek?.(name)?.logo;
    if (cached) {
      logoCache.set(name, cached);
      setLogo(cached);
      return undefined;
    }
    setLogo(undefined);
    let active = true;
    // Only look up titles that stay on screen for a moment, not every slide
    // the carousel flicks past
    const timer = setTimeout(async () => {
      const assets = await steamGridImageService.getFullAssets(name);
      const url = steamGridImageService.pickUrl(assets, "logo");
      logoCache.set(name, url);
      if (active) setLogo(url);
    }, 900);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [name]);

  return logo;
};

const formatUpdated = (value, locale) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "short",
    year: "numeric",
  }).format(date);
};

const HeroLogo = ({ name, title }) => {
  const logo = useGameLogo(name);
  const [failed, setFailed] = useState(null);
  if (logo && failed !== logo) {
    return (
      <img
        src={logo}
        alt={title}
        draggable="false"
        onError={() => setFailed(logo)}
        className="max-h-[180px] w-auto max-w-[min(520px,100%)] object-contain object-right drop-shadow-[0_8px_30px_rgb(0_0_0/0.6)]"
      />
    );
  }
  return (
    <h1 className="text-balance text-4xl font-bold uppercase leading-[0.95] tracking-tight text-foreground drop-shadow-[0_4px_24px_rgb(0_0_0/0.5)] lg:text-5xl xl:text-6xl">
      {title}
    </h1>
  );
};

const HomeHero = memo(
  ({
    games,
    currentSlide,
    imageUrl,
    imageLoading,
    fallback,
    locale,
    t,
    onSelectSlide,
    onPrev,
    onNext,
    onOpen,
    onDownload,
    onTogglePlayLater,
    isPlayLater,
    interactionHandlers,
  }) => {
    const game = games[currentSlide];
    if (!game) return null;
    const title = sanitizeText(game.game || "");
    const updated = formatUpdated(game.latest_update, locale);
    const categories = (game.category || []).slice(0, 3);
    const saved = isPlayLater(game);

    return (
      <section
        data-tour="home-featured"
        className="relative"
        // Bleeds out under the menu bar and the translucent navigation rail
        style={{
          marginLeft: "calc(-1 * (var(--app-rail-width, 0px) + 1rem))",
          marginRight: "-1rem",
        }}
        {...interactionHandlers}
      >
        <div
          className="relative h-[clamp(560px,88vh,920px)] cursor-pointer overflow-hidden"
          onClick={() => onOpen(game)}
        >
          {imageUrl ? (
            <img
              key={imageUrl}
              src={imageUrl}
              alt=""
              draggable="false"
              className="absolute inset-0 h-full w-full animate-page-fade-in object-cover object-[center_25%]"
            />
          ) : imageLoading ? (
            <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
          ) : (
            <div className="absolute inset-0">{fallback}</div>
          )}

          {/* Shades keep the menu bar, copy and stats readable over any artwork,
              and fade the art into the page below */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-background/80 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-3/5 bg-gradient-to-l from-background/80 via-background/30 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-background via-background/70 to-transparent" />

          <div
            className="absolute inset-0 flex items-end justify-between gap-8 pb-[clamp(48px,9vh,104px)]"
            style={{
              paddingLeft: "calc(var(--app-rail-width, 0px) + clamp(24px, 4.5vw, 72px))",
              paddingRight: "clamp(24px, 4.5vw, 72px)",
            }}
          >
            {/* Stats and slide controls */}
            <div className="hidden shrink-0 flex-col gap-4 md:flex">
              <StatGroup className="w-[380px]">
                <StatTile label={t("home.hero.size")} valueClassName="text-[1.4rem]">
                  <span className="truncate">{game.size || "—"}</span>
                  <HardDrive className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                </StatTile>
                <StatTile label={t("home.hero.updated")} valueClassName="text-[1.4rem]">
                  <span className="truncate">{updated || game.version || "—"}</span>
                  <CalendarClock className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                </StatTile>
              </StatGroup>

              {games.length > 1 && (
                <div
                  className="flex items-center gap-3"
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    type="button"
                    aria-label={t("common.back")}
                    onClick={onPrev}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background/50 text-muted-foreground backdrop-blur-md transition-colors hover:text-foreground"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="flex gap-1.5">
                    {games.map((item, index) => (
                      <button
                        type="button"
                        key={item.game || index}
                        aria-label={sanitizeText(item.game || "")}
                        aria-current={index === currentSlide ? "true" : undefined}
                        onClick={() => onSelectSlide(index)}
                        className={cn(
                          "h-1.5 rounded-full transition-all duration-300",
                          index === currentSlide
                            ? "w-6 bg-primary"
                            : "w-1.5 bg-foreground/25 hover:bg-foreground/50"
                        )}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label={t("common.next")}
                    onClick={onNext}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background/50 text-muted-foreground backdrop-blur-md transition-colors hover:text-foreground"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Title block */}
            <div className="flex min-w-0 max-w-[560px] flex-col items-end gap-5 text-right">
              <span className="inline-flex items-center gap-2 rounded-md border border-foreground/15 bg-foreground/10 px-3 py-1.5 text-sm text-foreground/90 backdrop-blur-md">
                <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                {t("home.hero.badge")}
              </span>

              <HeroLogo name={game.game} title={title} />

              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-[15px] leading-relaxed text-foreground/70">
                {categories.length > 0 && <span>{categories.join("  ·  ")}</span>}
                {game.online && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-foreground/15 px-2 py-0.5 text-xs text-foreground/80">
                    <Globe className="h-3.5 w-3.5" />
                    {t("gameCard.online")}
                  </span>
                )}
                {game.dlc && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-foreground/15 px-2 py-0.5 text-xs text-foreground/80">
                    <Gift className="h-3.5 w-3.5" />
                    {t("gameCard.dlc")}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-4" onClick={e => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => onTogglePlayLater(game)}
                  aria-pressed={saved}
                  className="group flex h-[46px] items-center gap-4 rounded-[10px] border border-foreground/10 bg-card/90 pl-5 pr-1.5 text-[15px] text-foreground/90 backdrop-blur-md transition-colors hover:border-foreground/30"
                >
                  {saved
                    ? t("gameCard.removeFromPlayLater")
                    : t("gameCard.addToPlayLater")}
                  <span className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-border/80 transition-colors group-hover:bg-foreground/10">
                    {saved ? (
                      <CircleCheck className="h-5 w-5" strokeWidth={1.75} />
                    ) : (
                      <CirclePlus className="h-5 w-5" strokeWidth={1.75} />
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDownload(game)}
                  className="group flex h-[46px] items-center gap-6 rounded-[10px] bg-primary pl-5 pr-1.5 text-[15px] text-secondary shadow-[0_0_28px_rgb(var(--color-primary)/0.25)] transition-[box-shadow,transform] hover:shadow-[0_0_36px_rgb(var(--color-primary)/0.4)] active:scale-[0.98]"
                >
                  {t("gameCard.downloadNow")}
                  <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-background text-foreground">
                    <Download className="h-[18px] w-[18px]" strokeWidth={2} />
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }
);
HomeHero.displayName = "HomeHero";

export default HomeHero;
