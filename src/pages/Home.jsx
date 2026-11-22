import { useState, useEffect, memo, useCallback, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import GameContextMenu from "@/components/GameContextMenu";
import HomeHero from "@/components/home/HomeHero";
import PopularShelf from "@/components/home/PopularShelf";
import WeeklyStats from "@/components/home/WeeklyStats";
import { useLanguage } from "@/context/LanguageContext";
import { useSettings } from "@/context/SettingsContext";
import { filterMatureGames } from "@/lib/matureContent";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Sparkles,
  Gamepad2,
  ArrowRight,
  ExternalLink,
  HandCoins,
  Search,
  Library,
  Download,
  MessageSquare,
  HelpCircle,
} from "lucide-react";
import { useImageLoader } from "@/hooks/useImageLoader";
import gameService from "@/services/games/gameService";
import imageCacheService from "@/services/images/imageCacheService";
import { holdLoad, releaseWhenDecoded } from "@/lib/loadGate";
import { orderedSources } from "@/lib/combinedSources";
import steamGridImageService from "@/services/images/steamGridImageService";
import { recordLibrarySnapshot } from "@/services/library/weeklyActivityService";
import { cn, sanitizeText } from "@/lib/utils";

// Module-level caches that persist during runtime
let gamesCache = null;
let carouselGamesCache = null;
// Identifier for the active source the cache was built against. Used to
// invalidate the cache on mount when the user toggled custom/official mode
// (or switched custom source) while Home was unmounted.
let gamesCacheSourceKey = null;
let gamesCacheRevision = -1;
// Everything else Home derives, so returning to Home paints the finished page
// on the first frame instead of a skeleton that fills in mid-transition.
let installedGamesCache = null;
let sectionsCache = null; // { source: apiGames array, sections }

const hasWarmCache = () => !!(gamesCache && carouselGamesCache);
// Rebuilt from the live image caches rather than remembered: the cached blob
// URLs get revoked when imageCacheService evicts them.
const cachedCarouselImages = () => {
  const images = {};
  for (const game of carouselGamesCache || []) {
    const key = carouselCoverKey(game);
    if (!key) continue;
    const url = game?.imgID
      ? imageCacheService.memoryCache.get(game.imgID)?.url
      : game?.game &&
        steamGridImageService.pickUrl(steamGridImageService.peek(game.game), "hero");
    if (url) images[key] = url;
  }
  return images;
};
const cachedSections = () =>
  sectionsCache && sectionsCache.source === gamesCache ? sectionsCache.sections : null;

const computeSourceKey = settings => {
  if (!settings) return "none";
  const customMode = !!settings.customSourcesMode;
  if (customMode && settings.combineSources) {
    const keys = orderedSources(settings).map(entry => entry.key);
    return `combined:${settings.localIndex || "default"}:${keys.join("|")}`;
  }
  if (customMode) {
    const list = settings.activeCustomList;
    if (list?.id) return `list:${list.id}`;
    const src = settings.customSource;
    if (src?.url) return `custom:${src.url}`;
    return "custom:none";
  }
  return `official:${settings.localIndex || "default"}`;
};

// Unified key for the carousel image map: prefer imgID (official index),
// fall back to a title-based key for custom sources that have no imgID.
const carouselCoverKey = g => (g?.imgID ? g.imgID : g?.game ? `sgdb:${g.game}` : null);

// Stable gradient fallback for games without a cover image (custom sources).
// Deterministic per-title so the same game always gets the same tint.
const FALLBACK_GRADIENTS = [
  "from-purple-600 via-pink-600 to-rose-600",
  "from-blue-600 via-indigo-600 to-purple-600",
  "from-emerald-600 via-teal-600 to-cyan-600",
  "from-amber-600 via-orange-600 to-red-600",
  "from-fuchsia-600 via-purple-600 to-indigo-600",
  "from-sky-600 via-blue-600 to-indigo-600",
  "from-rose-600 via-pink-600 to-fuchsia-600",
  "from-lime-600 via-emerald-600 to-teal-600",
];
const hashGradient = (key = "") => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return FALLBACK_GRADIENTS[Math.abs(h) % FALLBACK_GRADIENTS.length];
};
const GameCoverFallback = memo(({ game, size = "md" }) => {
  const title = sanitizeText(game?.game || game?.name || "");
  const gradient = hashGradient(title);
  const iconSize = size === "xs" ? "h-5 w-5" : size === "sm" ? "h-7 w-7" : "h-10 w-10";
  return (
    <div
      className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${gradient} relative overflow-hidden`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.2),transparent_60%)]" />
      <Gamepad2 className={`${iconSize} text-white/70 drop-shadow-lg`} />
    </div>
  );
});
GameCoverFallback.displayName = "GameCoverFallback";

// Mini Game Card for category grids
const MiniGameCard = memo(({ game, onClick, onContextMenu }) => {
  const cardRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { rootMargin: "200px", threshold: 0.1 }
    );
    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  const { cachedImage: imageUrl, loading } = useImageLoader(game?.imgID, {
    quality: isVisible ? "high" : "low",
    priority: isVisible ? "high" : "low",
    enabled: !!game?.imgID || (!game?.imgID && !!game?.game),
    fallbackGameName: !game?.imgID ? game?.game : null,
    fallbackSlot: "card",
  });

  const resolved = !loading;

  return (
    <div
      ref={cardRef}
      className="group/mini relative cursor-pointer overflow-hidden rounded-lg"
      onClick={onClick}
      onContextMenu={e => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu?.(e, game);
      }}
    >
      <AspectRatio ratio={16 / 9}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={game.game}
            className="h-full w-full object-cover transition-transform duration-300 group-hover/mini:scale-110"
          />
        ) : !resolved ? (
          <Skeleton className="h-full w-full" />
        ) : (
          <GameCoverFallback game={game} size="sm" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-60 transition-opacity group-hover/mini:opacity-100" />
      </AspectRatio>
      <div className="absolute bottom-0 left-0 right-0 p-2">
        <p className="line-clamp-1 text-xs font-medium text-white">
          {sanitizeText(game.game)}
        </p>
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-primary/20 opacity-0 transition-opacity group-hover/mini:opacity-100">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white">
          <ArrowRight className="h-3 w-3" />
        </div>
      </div>
    </div>
  );
});

const Home = memo(() => {
  const navigate = useNavigate();
  const [allApiGames, setApiGames] = useState(() => gamesCache || []);
  const [installedGames, setInstalledGames] = useState(() => installedGamesCache || []);
  const [loading, setLoading] = useState(() => !hasWarmCache());
  const [allCarouselGames, setCarouselGames] = useState(() => carouselGamesCache || []);
  const [topGames, setTopGames] = useState(() => cachedSections()?.topGames || []);
  const [recentlyUpdatedGames, setRecentlyUpdatedGames] = useState(
    () => cachedSections()?.recentlyUpdatedGames || []
  );
  const [onlineGames, setOnlineGames] = useState(
    () => cachedSections()?.onlineGames || []
  );
  const [actionGames, setActionGames] = useState(
    () => cachedSections()?.actionGames || []
  );
  const [popularCategories, setPopularCategories] = useState(
    () => cachedSections()?.popularCategories || {}
  );
  const { t, language } = useLanguage();
  const { settings } = useSettings();
  // Mature games stay out of Home unless the setting allows them
  const showMature = Boolean(settings?.seeInappropriateContent);
  const apiGames = useMemo(
    () => filterMatureGames(allApiGames, showMature),
    [allApiGames, showMature]
  );
  const carouselGames = useMemo(
    () => filterMatureGames(allCarouselGames, showMature),
    [allCarouselGames, showMature]
  );
  const [currentSlide, setCurrentSlide] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [carouselImages, setCarouselImages] = useState(cachedCarouselImages);
  const [imageRefreshKey, setImageRefreshKey] = useState(0);
  const [activityKey, setActivityKey] = useState(0);
  // A drag across the hero flips the slide; the click that ends it must not
  // also open the game
  const suppressHeroClickRef = useRef(false);

  const [touchStart, setTouchStart] = useState(0);
  const [touchEnd, setTouchEnd] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [showQuickAccessDialog, setShowQuickAccessDialog] = useState(false);
  const [quickAccessPage, setQuickAccessPage] = useState(() => {
    return localStorage.getItem("homeQuickAccessPage") || "library";
  });
  const longPressTimer = useRef(null);
  const [isLongPressing, setIsLongPressing] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [contextMenuGame, setContextMenuGame] = useState(null);
  const [playLaterGames, setPlayLaterGames] = useState([]);

  // Load Play Later games
  useEffect(() => {
    const loadPlayLaterGames = () => {
      const savedGames = JSON.parse(localStorage.getItem("play-later-games") || "[]");
      setPlayLaterGames(savedGames);
    };
    loadPlayLaterGames();
    window.addEventListener("play-later-updated", loadPlayLaterGames);
    return () => window.removeEventListener("play-later-updated", loadPlayLaterGames);
  }, []);

  const handleContextMenu = useCallback((e, game) => {
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX;
    const y = e.clientY;
    const menuWidth = 260;
    const menuHeight = 250;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let adjustedX = Math.min(x, viewportWidth - menuWidth);
    let adjustedY = y;
    if (y + menuHeight > viewportHeight) {
      adjustedY = Math.max(0, y - menuHeight);
    }
    adjustedY = Math.max(0, Math.min(adjustedY, viewportHeight - menuHeight));
    setContextMenuPosition({ x: adjustedX, y: adjustedY });
    setContextMenuGame(game);
    setContextMenuOpen(true);
  }, []);

  const handleDownloadFromContext = useCallback(
    game => {
      navigate("/download", {
        state: { gameData: game },
      });
    },
    [navigate]
  );

  const handleStartDownload = useCallback(
    game => {
      navigate("/download", {
        state: {
          gameData: game,
          autoStart: true,
        },
      });
    },
    [navigate]
  );

  const handleReadMore = useCallback(
    game => {
      navigate("/download", {
        state: { gameData: game },
      });
    },
    [navigate]
  );

  const handlePlayLaterFromContext = useCallback(game => {
    const playLaterList = JSON.parse(localStorage.getItem("play-later-games") || "[]");
    const isInList = playLaterList.some(g => g.game === game.game);

    if (isInList) {
      const updatedList = playLaterList.filter(g => g.game !== game.game);
      localStorage.setItem("play-later-games", JSON.stringify(updatedList));
      localStorage.removeItem(`play-later-image-${game.game}`);
    } else {
      const gameToSave = {
        game: game.game,
        gameID: game.gameID,
        imgID: game.imgID,
        version: game.version,
        size: game.size,
        category: game.category,
        dlc: game.dlc,
        online: game.online,
        download_links: game.download_links,
        desc: game.desc,
        addedAt: Date.now(),
      };
      playLaterList.push(gameToSave);
      localStorage.setItem("play-later-games", JSON.stringify(playLaterList));
    }
    window.dispatchEvent(new CustomEvent("play-later-updated"));
  }, []);

  useEffect(() => {
    const loadGames = async (forceRefresh = false) => {
      // Hold the startup splash until the games are in (no-op after boot)
      const releaseLoad = holdLoad();
      try {
        // With a warm cache the page is already painted; only show the
        // skeleton when there's genuinely nothing to show yet.
        if (forceRefresh || !hasWarmCache()) setLoading(true);

        // Invalidate the module-level cache if the active source changed
        // while Home was unmounted (e.g. user toggled custom mode on
        // LocalRefresh then came back).
        try {
          const currentSettings = await window.electron.getSettings();
          const currentKey = computeSourceKey(currentSettings);
          if (
            gamesCacheRevision !== imageCacheService.getRevision() ||
            (gamesCacheSourceKey && gamesCacheSourceKey !== currentKey)
          ) {
            console.log(
              "[Home] Active source changed, invalidating cache",
              gamesCacheSourceKey,
              "->",
              currentKey
            );
            gamesCache = null;
            carouselGamesCache = null;
            gameService.clearMemoryCache();
            forceRefresh = true;
            setLoading(true);
          }
          gamesCacheSourceKey = currentKey;
          gamesCacheRevision = imageCacheService.getRevision();
        } catch (e) {
          console.warn("[Home] Failed to check source key:", e);
        }

        // Use cache if available and not forcing refresh
        if (!forceRefresh && gamesCache && carouselGamesCache) {
          setApiGames(gamesCache);
          setCarouselGames(carouselGamesCache);

          // Still need to get installed games as they might have changed
          const installedGames = await window.electron.getGames();
          const customGames = await window.electron.getCustomGames();

          const actuallyInstalledGames = [
            ...(installedGames || []).map(game => ({
              ...game,
              isCustom: false,
            })),
            ...(customGames || []).map(game => ({
              ...game,
              isCustom: true,
            })),
          ];

          installedGamesCache = actuallyInstalledGames;
          setInstalledGames(actuallyInstalledGames);
          setLoading(false);
          return;
        }

        // Fetch fresh data if no cache or forcing refresh
        console.log(
          "[Home] Loading fresh game data",
          forceRefresh ? "(forced refresh)" : ""
        );
        const [gamesData, carouselGames] = await Promise.all([
          gameService.getAllGames(),
          gameService.getRandomTopGames(),
        ]);
        const games = gamesData.games || [];

        // Update caches
        gamesCache = games;
        carouselGamesCache = carouselGames;

        // Get actually installed games from electron
        const installedGames = await window.electron.getGames();
        const customGames = await window.electron.getCustomGames();

        // Combine installed and custom games
        const actuallyInstalledGames = [
          ...(installedGames || []).map(game => ({
            ...game,
            isCustom: false,
          })),
          ...(customGames || []).map(game => ({
            ...game,
            isCustom: true,
          })),
        ];

        installedGamesCache = actuallyInstalledGames;
        setApiGames(games);
        setInstalledGames(actuallyInstalledGames);
        setCarouselGames(carouselGames);
      } catch (error) {
        console.error("Error loading games:", error);
      } finally {
        setLoading(false);
        releaseLoad();
      }
    };

    loadGames();

    // Listen for index refresh events
    const handleIndexRefresh = event => {
      console.log("[Home] Index refreshed, reloading games", event.detail);
      // Clear module-level caches to force fresh data
      gamesCache = null;
      carouselGamesCache = null;
      // Clear gameService memory cache
      gameService.clearMemoryCache();
      // Clear cached carousel images so they re-fetch from the new index
      setCarouselImages({});
      setImageRefreshKey(k => k + 1);
      loadGames(true);
    };

    window.addEventListener("index-refreshed", handleIndexRefresh);
    return () => window.removeEventListener("index-refreshed", handleIndexRefresh);
  }, []);

  useEffect(() => {
    if (!autoPlay || settings?.reduceEffects || !carouselGames.length) return;
    const timer = setInterval(() => {
      setCurrentSlide(prev => (prev === carouselGames.length - 1 ? 0 : prev + 1));
    }, 5000);
    return () => clearInterval(timer);
  }, [autoPlay, settings?.reduceEffects, carouselGames.length]);

  // Load carousel images - current, next two (for side cards), and one ahead
  useEffect(() => {
    if (!carouselGames.length) return;

    let active = true;
    // The hero image is the first thing on screen, so loading waits for it
    const releaseLoad = holdLoad();
    const loadCarouselImages = async () => {
      const totalSlides = carouselGames.length;
      // Load current slide + next 3 slides (for the "Up Next" sidebar and preloading)
      const slidesToLoad = [
        currentSlide,
        (currentSlide + 1) % totalSlides,
        (currentSlide + 2) % totalSlides,
        (currentSlide + 3) % totalSlides,
      ];

      for (const slideIndex of slidesToLoad) {
        if (!active) return;
        const game = carouselGames[slideIndex];
        const key = carouselCoverKey(game);
        const isCurrent = slideIndex === currentSlide;
        if (!key || carouselImages[key]) {
          if (isCurrent) releaseLoad();
          continue;
        }

        try {
          let imageUrl = null;
          if (game?.imgID) {
            imageUrl = await imageCacheService.getImage(game.imgID);
          } else if (game?.game) {
            const assets = await steamGridImageService.getAssets(game.game);
            imageUrl = steamGridImageService.pickUrl(assets, "hero");
          }
          if (active && imageUrl) {
            setCarouselImages(prev => ({ ...prev, [key]: imageUrl }));
          }
          if (isCurrent) releaseWhenDecoded(releaseLoad, imageUrl);
        } catch (error) {
          console.error(`Error loading carousel image for ${game.game}:`, error);
          if (isCurrent) releaseLoad();
        }
      }
    };

    loadCarouselImages();
    return () => {
      active = false;
      releaseLoad();
    };
  }, [carouselGames, currentSlide, imageRefreshKey]);

  // Initial load - preload all carousel images for smooth transitions
  useEffect(() => {
    if (!carouselGames.length) return;

    let active = true;
    const preloadAllCarouselImages = async () => {
      for (const game of carouselGames) {
        if (!active) return;
        const key = carouselCoverKey(game);
        if (!key || carouselImages[key]) continue;

        try {
          let imageUrl = null;
          if (game?.imgID) {
            imageUrl = await imageCacheService.getImage(game.imgID);
          } else if (game?.game) {
            const assets = await steamGridImageService.getAssets(game.game);
            imageUrl = steamGridImageService.pickUrl(assets, "hero");
          }
          if (active && imageUrl) {
            setCarouselImages(prev => ({ ...prev, [key]: imageUrl }));
          }
        } catch (error) {
          console.error(`Error preloading carousel image for ${game.game}:`, error);
        }
      }
    };

    // Delay preloading to not block initial render
    const timer = setTimeout(preloadAllCarouselImages, 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [carouselGames, imageRefreshKey]);

  // Weekly stats read today's library totals, so record them before showing
  useEffect(() => {
    if (installedGames.length === 0) return;
    recordLibrarySnapshot(installedGames);
    setActivityKey(key => key + 1);
  }, [installedGames]);

  useEffect(() => {
    // Only recalculate sections when apiGames actually changes
    if (apiGames.length === 0) return;
    // Already restored from the cache for this exact list: recomputing would
    // hand every section new arrays and re-render the whole page on mount.
    if (sectionsCache?.source === apiGames) return;

    // Get game sections
    const {
      topGames: topSection,
      recentlyUpdatedGames: recentlyUpdatedSection,
      onlineGames: onlineSection,
      actionGames: actionSection,
      usedGames,
    } = getGameSections(apiGames);

    // Then get popular categories, passing the used games set
    const popularCats = getPopularCategories(apiGames, usedGames);

    sectionsCache = {
      source: apiGames,
      sections: {
        topGames: topSection,
        recentlyUpdatedGames: recentlyUpdatedSection,
        onlineGames: onlineSection,
        actionGames: actionSection,
        popularCategories: popularCats,
      },
    };

    setTopGames(topSection);
    setRecentlyUpdatedGames(recentlyUpdatedSection);
    setOnlineGames(onlineSection);
    setActionGames(actionSection);
    setPopularCategories(popularCats);
  }, [apiGames]);

  const getGameSections = games => {
    if (!Array.isArray(games))
      return {
        topGames: [],
        recentlyUpdatedGames: [],
        onlineGames: [],
        actionGames: [],
        usedGames: new Set(),
      };

    // Custom sources (Hydra Library) don't provide weight, category, or online
    // flags. Degrade the section layout so Home stays useful instead of empty.
    // Combined catalogs still have official games to build the full layout from
    const isCustomSource = games.length > 0 && games.every(g => g?.customSource);
    if (isCustomSource) {
      const usedGames = new Set();

      const recentlyUpdatedSection = games
        .filter(g => !!g?.latest_update)
        .sort((a, b) => new Date(b.latest_update) - new Date(a.latest_update))
        .slice(0, 100);
      recentlyUpdatedSection.forEach(g => usedGames.add(g.game));

      // "Top" for custom sources = newest entries we haven't shown yet
      const topSection = games.filter(g => !usedGames.has(g.game)).slice(0, 100);
      topSection.forEach(g => usedGames.add(g.game));

      return {
        topGames: topSection,
        recentlyUpdatedGames: recentlyUpdatedSection,
        onlineGames: [],
        actionGames: [],
        usedGames,
      };
    }

    // Create a shared Set to track used games across all sections
    const usedGames = new Set();

    // Get top games first (they get priority) - only top 100 by weight
    const topGamesSection = games
      .filter(game => parseInt(game.weight || 0) > 30)
      .sort((a, b) => parseInt(b.weight || 0) - parseInt(a.weight || 0))
      .slice(0, 100);

    // Mark top games as used
    topGamesSection.forEach(game => usedGames.add(game.game));

    // Get recently updated games, excluding already used games - limit to 100
    const recentlyUpdatedSection = games
      .filter(game => !!game.latest_update && !usedGames.has(game.game))
      .sort((a, b) => new Date(b.latest_update) - new Date(a.latest_update))
      .slice(0, 100);

    // Mark recently updated games as used
    recentlyUpdatedSection.forEach(game => usedGames.add(game.game));

    // Get online games, excluding already used games - limit to 100
    const onlineGamesSection = games
      .filter(game => game.online && !usedGames.has(game.game))
      .sort((a, b) => parseInt(b.weight || 0) - parseInt(a.weight || 0))
      .slice(0, 100);

    // Mark online games as used
    onlineGamesSection.forEach(game => usedGames.add(game.game));

    // Get action games, excluding already used games - limit to 100
    const actionGamesSection = games
      .filter(
        game =>
          Array.isArray(game.category) &&
          game.category.some(cat =>
            ["Action", "Adventure", "Fighting", "Shooter"].includes(cat)
          ) &&
          !usedGames.has(game.game)
      )
      .sort((a, b) => parseInt(b.weight || 0) - parseInt(a.weight || 0))
      .slice(0, 100);

    // Mark action games as used
    actionGamesSection.forEach(game => usedGames.add(game.game));

    return {
      topGames: topGamesSection,
      recentlyUpdatedGames: recentlyUpdatedSection,
      onlineGames: onlineGamesSection,
      actionGames: actionGamesSection,
      usedGames, // Return the set of used games for use in getPopularCategories
    };
  };

  const getPopularCategories = (games, usedGames = new Set()) => {
    if (!Array.isArray(games)) return {};

    const categories = {};

    // Helper function to get unique games for a category
    const getUniqueGamesForCategory = (category, count = 4) => {
      return games
        .filter(
          game =>
            game.category?.includes(category) &&
            !usedGames.has(game.game) &&
            parseInt(game.weight || 0) > 20
        )
        .sort((a, b) => parseInt(b.weight || 0) - parseInt(a.weight || 0))
        .slice(0, count)
        .map(game => {
          usedGames.add(game.game);
          return game;
        });
    };

    // Get games for each category
    const popularCategories = [
      "Action",
      "Adventure",
      "Survival",
      "Simulation",
      "Strategy",
      "Sports",
    ];

    popularCategories.forEach(category => {
      const categoryGames = getUniqueGamesForCategory(category);
      if (categoryGames.length >= 2) {
        categories[category] = categoryGames;
      }
    });

    return categories;
  };

  const handlePrevSlide = useCallback(() => {
    setCurrentSlide(prev => (prev === 0 ? carouselGames.length - 1 : prev - 1));
    setAutoPlay(false);
  }, [carouselGames.length]);

  const handleNextSlide = useCallback(() => {
    setCurrentSlide(prev => (prev === carouselGames.length - 1 ? 0 : prev + 1));
    setAutoPlay(false);
  }, [carouselGames.length]);

  const handleCarouselGameClick = useCallback(
    game => {
      const container = document.querySelector(".page-container");
      if (container) {
        container.classList.add("fade-out");
      }

      setTimeout(() => {
        navigate("/download", {
          state: {
            gameData: game,
          },
        });
      }, 300);
    },
    [navigate]
  );

  const handleTouchStart = useCallback(e => {
    setTouchStart(e.touches[0].clientX);
    setTouchEnd(e.touches[0].clientX);
    setIsDragging(true);
    setDragStart(e.touches[0].clientX);
    setAutoPlay(false);
  }, []);

  const handleTouchMove = useCallback(
    e => {
      if (!isDragging) return;
      setTouchEnd(e.touches[0].clientX);
      const offset = e.touches[0].clientX - dragStart;
      setDragOffset(offset);
    },
    [isDragging, dragStart]
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    const diff = touchStart - touchEnd;
    if (Math.abs(diff) > 8) suppressHeroClickRef.current = true;
    const threshold = window.innerWidth * 0.2; // 20% of screen width

    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        handleNextSlide();
      } else {
        handlePrevSlide();
      }
    }
    setDragOffset(0);
  }, [touchStart, touchEnd, handleNextSlide, handlePrevSlide]);

  const handleMouseDown = useCallback(e => {
    setIsDragging(true);
    setDragStart(e.clientX);
    setAutoPlay(false);
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback(
    e => {
      if (!isDragging) return;
      const offset = e.clientX - dragStart;
      setDragOffset(offset);
      e.preventDefault();
    },
    [isDragging, dragStart]
  );

  const handleMouseUp = useCallback(
    e => {
      if (!isDragging) return;
      setIsDragging(false);
      const diff = dragStart - e.clientX;
      if (Math.abs(diff) > 8) suppressHeroClickRef.current = true;
      const threshold = window.innerWidth * 0.2;

      if (Math.abs(diff) > threshold) {
        if (diff > 0) {
          handleNextSlide();
        } else {
          handlePrevSlide();
        }
      }
      setDragOffset(0);
      e.preventDefault();
    },
    [isDragging, dragStart, handleNextSlide, handlePrevSlide]
  );

  const handleMouseLeave = useCallback(
    e => {
      if (isDragging) {
        handleMouseUp(e);
      }
    },
    [isDragging, handleMouseUp]
  );

  const isPlayLater = useCallback(
    game => !!game && playLaterGames.some(g => g.game === game.game),
    [playLaterGames]
  );

  const openHeroGame = useCallback(
    game => {
      if (suppressHeroClickRef.current) {
        suppressHeroClickRef.current = false;
        return;
      }
      handleCarouselGameClick(game);
    },
    [handleCarouselGameClick]
  );

  const renderCoverFallback = useCallback(game => <GameCoverFallback game={game} />, []);

  const openSearch = () => {
    navigate("/search");
    setTimeout(() => {
      const searchInput = document.querySelector('input[placeholder*="Search"]');
      if (searchInput) {
        searchInput.focus();
        searchInput.click();
      }
    }, 150);
  };

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div
          style={{
            marginLeft: "calc(-1 * (var(--app-rail-width, 0px) + 1rem))",
            marginRight: "-1rem",
          }}
        >
          <Skeleton className="h-[clamp(560px,88vh,920px)] w-full rounded-none" />
        </div>
        <div className="space-y-5 px-[clamp(8px,2.5vw,40px)]">
          <div className="flex items-center justify-between">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-11 w-72 rounded-[10px]" />
          </div>
          <div className="flex h-[clamp(300px,40vh,420px)] gap-4 overflow-hidden">
            <Skeleton className="aspect-[565/400] h-full shrink-0 rounded-[10px]" />
            {[0, 1, 2, 3].map(i => (
              <Skeleton
                key={i}
                className="aspect-[263/400] h-full shrink-0 rounded-[10px]"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Safely get current game
  const currentGame = carouselGames.length > 0 ? carouselGames[currentSlide] : null;

  // If no carousel games, show a simpler layout
  const hasCarousel = carouselGames.length > 0 && currentGame;
  const heroKey = carouselCoverKey(currentGame);
  const heroUrl = heroKey ? carouselImages[heroKey] : null;
  // Still resolving (either imgID fetch or SteamGrid lookup)
  const heroLoading =
    !heroUrl &&
    !!(
      currentGame?.imgID ||
      (currentGame?.game && !steamGridImageService.peek(currentGame.game))
    );

  const shelfTabs = [
    { id: "top", label: t("home.tabs.top"), games: topGames },
    { id: "updated", label: t("home.tabs.updated"), games: recentlyUpdatedGames },
    { id: "online", label: t("home.tabs.online"), games: onlineGames },
    { id: "action", label: t("home.tabs.action"), games: actionGames },
  ];

  const quickAccessTile =
    "flex h-16 w-[88px] flex-col items-center justify-center gap-1.5 rounded-[12px] border border-border/70 bg-card text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground";

  return (
    <div className="min-h-screen bg-background">
      <GameContextMenu
        isOpen={contextMenuOpen}
        onClose={() => setContextMenuOpen(false)}
        position={contextMenuPosition}
        game={contextMenuGame}
        onDownload={handleDownloadFromContext}
        onStartDownload={handleStartDownload}
        onReadMore={handleReadMore}
        onPlayLater={handlePlayLaterFromContext}
        isPlayLater={isPlayLater(contextMenuGame)}
      />

      {hasCarousel && (
        <HomeHero
          games={carouselGames}
          currentSlide={currentSlide}
          imageUrl={heroUrl}
          imageLoading={heroLoading}
          fallback={<GameCoverFallback game={currentGame} />}
          locale={language}
          t={t}
          onSelectSlide={index => {
            setCurrentSlide(index);
            setAutoPlay(false);
          }}
          onPrev={handlePrevSlide}
          onNext={handleNextSlide}
          onOpen={openHeroGame}
          onDownload={handleStartDownload}
          onTogglePlayLater={handlePlayLaterFromContext}
          isPlayLater={isPlayLater}
          interactionHandlers={{
            onMouseDown: handleMouseDown,
            onMouseMove: handleMouseMove,
            onMouseUp: handleMouseUp,
            onMouseLeave: handleMouseLeave,
            onTouchStart: handleTouchStart,
            onTouchMove: handleTouchMove,
            onTouchEnd: handleTouchEnd,
          }}
        />
      )}

      <div
        className={cn(
          "relative space-y-16 px-[clamp(8px,2.5vw,40px)]",
          hasCarousel ? "-mt-4" : "pt-6"
        )}
      >
        <PopularShelf
          title={t("home.popular")}
          tabs={shelfTabs}
          locale={language}
          t={t}
          isPlayLater={isPlayLater}
          fallback={renderCoverFallback}
          onOpen={handleCarouselGameClick}
          onDownload={handleStartDownload}
          onTogglePlayLater={handlePlayLaterFromContext}
          onContextMenu={handleContextMenu}
        />

        <WeeklyStats t={t} locale={language} refreshKey={activityKey} />

        {/* Search Bar with Quick Access Buttons */}
        {settings.homeSearch && (
          <section className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={openSearch}
              data-tour="home-search"
              className="group flex h-16 flex-1 items-center gap-4 rounded-[12px] border border-border/70 bg-card px-4 text-left transition-colors hover:border-foreground/25"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
                <Search className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-foreground/85">
                  {t("home.searchPlaceholder")}
                </span>
                <span className="block truncate text-xs text-muted-foreground/70">
                  {t("home.searchSubtitle")}
                </span>
              </span>
            </button>

            {/* Quick Access Buttons */}
            <div data-tour="home-links" className="flex gap-3">
              {/* Customizable Quick Access Button: click to open, hold to choose */}
              <div
                data-tour="home-quick-access"
                role="button"
                tabIndex={0}
                className={cn(quickAccessTile, "cursor-pointer")}
                onKeyDown={event => {
                  if (event.key === "Enter") navigate(`/${quickAccessPage}`);
                }}
                onMouseDown={() => {
                  setIsLongPressing(false);
                  longPressTimer.current = setTimeout(() => {
                    setIsLongPressing(true);
                    setShowQuickAccessDialog(true);
                  }, 500);
                }}
                onMouseUp={() => {
                  if (longPressTimer.current) {
                    clearTimeout(longPressTimer.current);
                  }
                  if (!isLongPressing) {
                    navigate(`/${quickAccessPage}`);
                  }
                  setIsLongPressing(false);
                }}
                onMouseLeave={() => {
                  if (longPressTimer.current) {
                    clearTimeout(longPressTimer.current);
                  }
                  setIsLongPressing(false);
                }}
                onTouchStart={() => {
                  setIsLongPressing(false);
                  longPressTimer.current = setTimeout(() => {
                    setIsLongPressing(true);
                    setShowQuickAccessDialog(true);
                  }, 500);
                }}
                onTouchEnd={() => {
                  if (longPressTimer.current) {
                    clearTimeout(longPressTimer.current);
                  }
                  if (!isLongPressing) {
                    navigate(`/${quickAccessPage}`);
                  }
                  setIsLongPressing(false);
                }}
              >
                {quickAccessPage === "library" && (
                  <Library className="h-[18px] w-[18px]" strokeWidth={1.75} />
                )}
                {quickAccessPage === "downloads" && (
                  <Download className="h-[18px] w-[18px]" strokeWidth={1.75} />
                )}
                {quickAccessPage === "bigpicture" && (
                  <Gamepad2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
                )}
                {quickAccessPage === "ascend" && (
                  <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.75} />
                )}
                <span className="max-w-full truncate px-1">
                  {quickAccessPage === "library" && t("common.library")}
                  {quickAccessPage === "downloads" && t("common.downloads")}
                  {quickAccessPage === "bigpicture" && t("common.bigpicture")}
                  {quickAccessPage === "ascend" && t("common.ascend")}
                </span>
              </div>

              <button
                type="button"
                className={quickAccessTile}
                onClick={() => window.electron.openURL("https://ascendara.app/discord")}
              >
                <MessageSquare className="h-[18px] w-[18px]" strokeWidth={1.75} />
                {t("common.discord")}
              </button>

              <button
                type="button"
                className={quickAccessTile}
                onClick={() => window.electron.openURL("https://ascendara.app/docs")}
              >
                <HelpCircle className="h-[18px] w-[18px]" strokeWidth={1.75} />
                {t("common.help")}
              </button>
            </div>
          </section>
        )}

        {/* Quick Access Configuration Dialog */}
        {settings.homeSearch && (
          <AlertDialog
            open={showQuickAccessDialog}
            onOpenChange={setShowQuickAccessDialog}
          >
            <AlertDialogContent className="border-border">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-2xl font-bold text-foreground">
                  {t("home.quickAccess.title") || "Quick Access Button"}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground">
                  {t("home.quickAccess.description") ||
                    "Choose which page you want to quickly access from the home screen."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="mt-4">
                <RadioGroup
                  value={quickAccessPage}
                  onValueChange={value => {
                    setQuickAccessPage(value);
                    localStorage.setItem("homeQuickAccessPage", value);
                  }}
                  className="space-y-3"
                >
                  {[
                    ["library", Library, t("common.library")],
                    ["downloads", Download, t("common.downloads")],
                    ["bigpicture", Gamepad2, t("common.bigpicture")],
                    ["ascend", Sparkles, t("common.ascend")],
                  ].map(([value, Icon, label]) => (
                    <div
                      key={value}
                      className="flex items-center space-x-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent"
                    >
                      <RadioGroupItem value={value} id={value} />
                      <Label
                        htmlFor={value}
                        className="flex flex-1 cursor-pointer items-center gap-2"
                      >
                        <Icon className="h-4 w-4 text-primary" />
                        <span>{label}</span>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              <div className="mt-6 flex justify-end">
                <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* Popular Categories */}
        {Object.keys(popularCategories).length > 0 && (
          <section>
            <h2 className="mb-5 mt-0 text-[1.375rem] font-semibold tracking-tight text-foreground">
              {t("home.popularCategories")}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Object.entries(popularCategories).map(([category, games]) => (
                <div
                  key={category}
                  className="rounded-[16px] border border-border/70 bg-background p-2.5"
                >
                  <div className="mb-2.5 flex items-center justify-between rounded-[10px] bg-card px-4 py-3">
                    <h3 className="m-0 text-[15px] font-semibold text-foreground">
                      {category}
                    </h3>
                    <span className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {games.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {games.slice(0, 4).map(game => (
                      <MiniGameCard
                        key={game.game}
                        game={game}
                        onClick={() => handleCarouselGameClick(game)}
                        onContextMenu={handleContextMenu}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Footer - Support Section */}
        <footer className="border-t border-border/60 pb-8 pt-10">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <h3 className="mb-2 text-lg font-semibold text-foreground">
              {t("home.footer.title")}
            </h3>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
              {t("home.footer.description")}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                variant="outline"
                className="gap-2 rounded-[10px]"
                onClick={() => window.electron.openURL("https://ascendara.app/support")}
              >
                <HandCoins className="h-4 w-4" />
                {t("home.footer.donate")}
              </Button>
              <Button
                variant="ghost"
                className="gap-2 rounded-[10px] text-muted-foreground hover:text-foreground"
                onClick={() =>
                  window.electron.openURL("https://github.com/ascendara/ascendara")
                }
              >
                <ExternalLink className="h-4 w-4" />
                {t("home.footer.github")}
              </Button>
            </div>
            <p className="mt-8 text-xs text-muted-foreground/60">
              {t("home.footer.madeWith")}
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
});

export default Home;
