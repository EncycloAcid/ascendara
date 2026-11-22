import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  Download,
  HardDrive,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useImageLoader } from "@/hooks/useImageLoader";
import steamGridImageService from "@/services/images/steamGridImageService";
import { cn, sanitizeText } from "@/lib/utils";

// Cards share one height, sized so the wide card and three portrait cards fill
// the row exactly: 565/400 + 3 × 263/400 widths, plus three 16px gaps. The row
// width is the window minus the rail, the main column's padding and Home's.
export const SHELF_HEIGHT =
  "clamp(260px, calc((100vw - var(--app-rail-width, 0px) - 2rem - 2 * clamp(8px, 2.5vw, 40px) - 48px) / 3.3975), 460px)";

const INITIAL_COUNT = 12;
const LOAD_MORE_COUNT = 12;

const useVisible = ref => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
};

// Portrait cards prefer a real portrait cover; until one resolves (or when
// there is none) the landscape index art is cropped to fit
const usePortraitCover = (name, enabled) => {
  const [cover, setCover] = useState(() =>
    name ? steamGridImageService.peekCover(name) || null : null
  );
  useEffect(() => {
    if (!enabled || !name) return undefined;
    let active = true;
    steamGridImageService
      .getCover(name)
      .then(url => active && url && setCover(url))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [name, enabled]);
  return cover;
};

const formatUpdated = (value, locale) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "short",
    year: "numeric",
  }).format(date);
};

const CardAction = ({ label, onClick, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={event => {
      event.stopPropagation();
      onClick();
    }}
    className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-white/15 bg-black/40 text-white backdrop-blur-sm transition-colors hover:border-white/40 hover:bg-white/10"
  >
    {children}
  </button>
);

const ShelfCard = memo(
  ({
    game,
    feature,
    locale,
    t,
    saved,
    fallback,
    onOpen,
    onDownload,
    onTogglePlayLater,
    onContextMenu,
  }) => {
    const ref = useRef(null);
    const visible = useVisible(ref);
    const { cachedImage, loading } = useImageLoader(game?.imgID, {
      quality: visible ? "high" : "low",
      priority: visible ? "high" : "low",
      enabled: !!game?.imgID || !!game?.game,
      fallbackGameName: !game?.imgID ? game?.game : null,
      fallbackSlot: "card",
    });
    const cover = usePortraitCover(game?.game, visible && !feature);
    const image = (!feature && cover) || cachedImage;
    const title = sanitizeText(game.game || "");
    const updated = formatUpdated(game.latest_update, locale);
    const subtitle = (game.category || []).slice(0, 2).join(", ");

    return (
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        onClick={() => onOpen(game)}
        onKeyDown={event => {
          if (event.key === "Enter") onOpen(game);
        }}
        onContextMenu={event => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu?.(event, game);
        }}
        className={cn(
          "group relative h-full shrink-0 cursor-pointer snap-start overflow-hidden rounded-[10px] border border-border/70 bg-card outline-none transition-[border-color] duration-300 hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring",
          feature ? "aspect-[565/400]" : "aspect-[263/400]"
        )}
      >
        {image ? (
          <img
            src={image}
            alt={title}
            draggable="false"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
          />
        ) : loading || !visible ? (
          <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
        ) : (
          <div className="absolute inset-0">{fallback(game)}</div>
        )}

        {/* Details slide up on hover or keyboard focus */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/45 to-transparent opacity-0 transition-opacity duration-300 group-focus-within:opacity-100 group-hover:opacity-100" />
        <div className="absolute inset-x-0 bottom-0 flex translate-y-3 items-end justify-between gap-3 p-4 opacity-0 transition-all duration-300 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-base font-semibold leading-tight text-white">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-1 truncate text-sm text-white/55">{subtitle}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/85">
              {game.size && (
                <span className="inline-flex items-center gap-1.5">
                  <HardDrive className="h-4 w-4" strokeWidth={1.75} />
                  {game.size}
                </span>
              )}
              {updated && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-4 w-4" strokeWidth={1.75} />
                  {updated}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <CardAction
              label={
                saved ? t("gameCard.removeFromPlayLater") : t("gameCard.addToPlayLater")
              }
              onClick={() => onTogglePlayLater(game)}
            >
              {saved ? (
                <CircleCheck className="h-5 w-5" strokeWidth={1.75} />
              ) : (
                <CirclePlus className="h-5 w-5" strokeWidth={1.75} />
              )}
            </CardAction>
            <CardAction
              label={t("gameCard.downloadNow")}
              onClick={() => onDownload(game)}
            >
              <Download className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </CardAction>
          </div>
        </div>
      </div>
    );
  }
);
ShelfCard.displayName = "ShelfCard";

const PopularShelf = ({
  title,
  tabs,
  locale,
  t,
  isPlayLater,
  fallback,
  onOpen,
  onDownload,
  onTogglePlayLater,
  onContextMenu,
}) => {
  const available = tabs.filter(tab => tab.games?.length);
  const [activeId, setActiveId] = useState(available[0]?.id);
  const active = available.find(tab => tab.id === activeId) || available[0];
  const scrollRef = useRef(null);
  const [count, setCount] = useState(INITIAL_COUNT);
  const [canScroll, setCanScroll] = useState({ left: false, right: false });

  const games = useMemo(() => active?.games || [], [active]);
  const visibleGames = games.slice(0, count);
  const hasMore = games.length > count;

  // Each tab starts from its first game
  useEffect(() => {
    setCount(INITIAL_COUNT);
    scrollRef.current?.scrollTo({ left: 0 });
  }, [active?.id, games]);

  const update = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const { scrollLeft, scrollWidth, clientWidth } = node;
    const nearEnd = scrollLeft + clientWidth >= scrollWidth - 120;
    if (nearEnd && hasMore) {
      setCount(previous => Math.min(previous + LOAD_MORE_COUNT, games.length));
    }
    setCanScroll({
      left: scrollLeft > 4,
      right: scrollLeft < scrollWidth - clientWidth - 4 || hasMore,
    });
  }, [hasMore, games.length]);

  useEffect(() => {
    update();
    const node = scrollRef.current;
    if (!node) return undefined;
    node.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      node.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update, visibleGames.length]);

  const scrollBy = direction => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * node.clientWidth * 0.8, behavior: "smooth" });
  };

  if (!active) return null;

  return (
    <section data-tour="home-rows" className="relative">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <h2 className="m-0 text-[1.375rem] font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <div className="flex items-center gap-3">
          <div className="hidden gap-1 sm:flex">
            {[
              [-1, ChevronLeft, canScroll.left, t("common.back")],
              [1, ChevronRight, canScroll.right, t("common.next")],
            ].map(([direction, Icon, enabled, label]) => (
              <button
                key={direction}
                type="button"
                aria-label={label}
                disabled={!enabled}
                onClick={() => scrollBy(direction)}
                className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-border/70 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:text-muted-foreground"
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
          <div
            role="tablist"
            aria-label={title}
            className="flex rounded-[10px] border border-border/70 bg-card p-1"
          >
            {available.map(tab => {
              const selected = tab.id === active.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveId(tab.id)}
                  className={cn(
                    "rounded-[6px] px-4 py-2 text-sm transition-colors duration-200 sm:px-5",
                    selected
                      ? "bg-primary text-secondary shadow-sm"
                      : "text-muted-foreground/80 hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        role="tabpanel"
        className="scrollbar-hide flex snap-x gap-4 overflow-x-auto"
        style={{ height: SHELF_HEIGHT, scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {visibleGames.map((game, index) => (
          <ShelfCard
            key={`${active.id}-${game.game}`}
            game={game}
            feature={index === 0}
            locale={locale}
            t={t}
            saved={isPlayLater(game)}
            fallback={fallback}
            onOpen={onOpen}
            onDownload={onDownload}
            onTogglePlayLater={onTogglePlayLater}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    </section>
  );
};

export default PopularShelf;
