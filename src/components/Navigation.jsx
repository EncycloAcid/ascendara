import React, { useState, useEffect, memo, useCallback, useMemo, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { getConfiguredProviders } from "@/services/downloads/debridService";
import {
  Home,
  Search,
  Library,
  Settings2,
  Package,
  User,
  ServerIcon,
  CircleArrowDown,
  AtSign,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAscendNotificationCount } from "@/services/ascend/ascendNotificationBadgeService";
import { useNewSecurityFeature } from "@/services/ascend/newFeatureBadgeService";
import { prefetchAscendData } from "@/services/ascend/ascendPrefetch";
import recentGamesService from "@/services/library/recentGamesService";
import { recordLibrarySnapshot } from "@/services/library/weeklyActivityService";
import {
  NAVIGATION_RAIL_WIDTH_PX,
  NAVIGATION_RAIL_TILE_PX,
} from "@/lib/navigationGeometry";
import { MENU_BAR_HEIGHT_PX } from "@/lib/appChromeGeometry";
import { cn, imageDataUrlFromBase64, sanitizeText } from "@/lib/utils";

// Recently played games shown as cover tiles in the rail
const MAX_RAIL_GAMES = 4;
const railImageCache = new Map(); // game name -> data URL

const tileClass = active =>
  cn(
    "group relative flex shrink-0 items-center justify-center rounded-[10px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-primary text-secondary shadow-[0_0_24px_rgb(var(--color-primary)/0.15)]"
      : "bg-muted/70 text-muted-foreground hover:bg-accent hover:text-foreground"
  );

const Badge = ({ count }) =>
  count > 0 ? (
    <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-background bg-primary px-1 text-[10px] font-semibold text-secondary">
      {count > 99 ? "99+" : count}
    </span>
  ) : null;

const RailTooltip = ({ label, children }) => (
  <Tooltip delayDuration={150}>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side="right" sideOffset={12}>
      {label}
    </TooltipContent>
  </Tooltip>
);

const RailGameThumb = memo(({ game, active, onOpen }) => {
  const name = game.game || game.name;
  const [image, setImage] = useState(() => railImageCache.get(name) || null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const base64 = await window.electron.getGameImage(name);
        if (!base64 || !mounted) return;
        const dataUrl = imageDataUrlFromBase64(base64);
        railImageCache.set(name, dataUrl);
        setImage(dataUrl);
      } catch {
        // No cover on disk yet; the initial stays
      }
    };
    if (!railImageCache.has(name)) load();
    const handleCoverUpdate = event => {
      const { gameName, dataUrl } = event.detail || {};
      if (gameName === name && dataUrl && mounted) {
        railImageCache.set(name, dataUrl);
        setImage(dataUrl);
      }
    };
    window.addEventListener("game-cover-updated", handleCoverUpdate);
    return () => {
      mounted = false;
      window.removeEventListener("game-cover-updated", handleCoverUpdate);
    };
  }, [name]);

  const label = sanitizeText(name);
  return (
    <RailTooltip label={label}>
      <button
        type="button"
        onClick={() => onOpen(game)}
        aria-label={label}
        className={cn(tileClass(false), active && "ring-2 ring-primary")}
        style={{ width: NAVIGATION_RAIL_TILE_PX, height: NAVIGATION_RAIL_TILE_PX }}
      >
        <span className="absolute inset-1 overflow-hidden rounded-md bg-card">
          {image ? (
            <img
              src={image}
              alt=""
              draggable="false"
              className="h-full w-full object-cover grayscale-[35%] transition duration-300 group-hover:scale-105 group-hover:grayscale-0"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-sm font-semibold text-muted-foreground">
              {label.charAt(0).toUpperCase()}
            </span>
          )}
        </span>
      </button>
    </RailTooltip>
  );
});
RailGameThumb.displayName = "RailGameThumb";

const RailAvatar = ({ active, label }) => {
  const { user, userData } = useAuth();
  const [localImage] = useState(() => {
    try {
      return localStorage.getItem("profileImage");
    } catch {
      return null;
    }
  });
  const [failed, setFailed] = useState(false);
  const photo = user?.photoURL || userData?.photoURL || localImage;

  return (
    <RailTooltip label={label}>
      <Link
        to="/profile"
        data-nav-path="/profile"
        aria-label={label}
        className={cn(
          "group relative flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full bg-background/60 outline-none ring-1 ring-border/70 transition focus-visible:ring-2 focus-visible:ring-ring",
          active && "ring-2 ring-primary"
        )}
      >
        <span className="flex h-[48px] w-[48px] items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
          {photo && !failed ? (
            <img
              src={photo}
              alt=""
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
              onError={() => setFailed(true)}
            />
          ) : (
            <User className="h-5 w-5" />
          )}
        </span>
      </Link>
    </RailTooltip>
  );
};

const Navigation = memo(() => {
  const { t } = useLanguage();
  const { settings } = useSettings();
  // One entry for all services with a downloads page, shown only while one is in use
  const debridNavVisible = getConfiguredProviders(settings).some(
    provider => provider.hasDownloadsPage !== false
  );
  const location = useLocation();
  const navigate = useNavigate();
  const [downloadCount, setDownloadCount] = useState(0);
  const [recentGames, setRecentGames] = useState([]);
  // Unseen notifications, plus one while two-step verification is new to this member
  const ascendNotificationCount =
    useAscendNotificationCount() + (useNewSecurityFeature() ? 1 : 0);
  const downloadCountRef = useRef(0);
  // The router renders the next page in a transition, so location only
  // changes once that page is ready. Track the clicked path separately so the
  // rail highlights it on the very next frame instead of after the render.
  const [pendingPath, setPendingPath] = useState(null);
  useEffect(() => setPendingPath(null), [location.pathname]);
  const activePath = pendingPath ?? location.pathname;
  const openGameName =
    location.pathname === "/gamescreen"
      ? location.state?.gameData?.game || location.state?.gameData?.name
      : null;

  const isActive = useCallback(
    path => {
      if (path === "/search" && activePath === "/download") {
        return true;
      }
      if (
        path === "/settings" &&
        [
          "/settings",
          "/themes",
          "/extralanguages",
          "/sidecaranddependencies",
          "/sources",
        ].includes(activePath)
      ) {
        return true;
      }
      if (
        path === "/library" &&
        (activePath === "/gamescreen" ||
          activePath === "/retro" ||
          activePath.startsWith("/folderview"))
      ) {
        return true;
      }
      return activePath === path;
    },
    [activePath]
  );

  const { pageItems, footerItems } = useMemo(
    () => ({
      pageItems: [
        { path: "/", label: t("common.home"), icon: Home },
        { path: "/library", label: t("common.library"), icon: Library },
        { path: "/downloads", label: t("common.downloads"), icon: CircleArrowDown },
        {
          path: "/debriddownloads",
          label: t("debrid.downloadsTitle"),
          icon: ServerIcon,
          hidden: !debridNavVisible,
        },
      ],
      footerItems: [
        { path: "/ascend", label: t("common.ascend"), icon: AtSign },
        {
          path: "/workshopdownloader",
          label: t("common.workshopDownloader"),
          icon: Package,
          hidden: !settings.viewWorkshopPage,
        },
        { path: "/settings", label: t("common.preferences"), icon: Settings2 },
      ],
    }),
    [t, settings.viewWorkshopPage, debridNavVisible]
  );

  useEffect(() => {
    const checkDownloaderStatus = async () => {
      if (!settings?.downloadDirectory || settings.downloadDirectory === "") return;
      try {
        const games = await window.electron.getGames();
        if (!games || !Array.isArray(games)) {
          if (downloadCountRef.current !== 0) {
            downloadCountRef.current = 0;
            setDownloadCount(0);
          }
          return;
        }
        const downloadingGames = games.filter(game => {
          const { downloadingData } = game;
          return (
            downloadingData &&
            (downloadingData.downloading ||
              downloadingData.extracting ||
              downloadingData.updating ||
              downloadingData.error)
          );
        });
        const count = downloadingGames.length;
        // Only update state if count changed to prevent unnecessary rerenders
        if (count !== downloadCountRef.current) {
          downloadCountRef.current = count;
          setDownloadCount(count);
        }
      } catch (error) {
        console.error("Error checking downloading games:", error);
      }
    };

    // Poll quickly only while something is downloading; download events and
    // page changes trigger an immediate recheck in between.
    let timeout = null;
    let canceled = false;
    const schedule = () => {
      clearTimeout(timeout);
      if (canceled) return;
      timeout = setTimeout(
        async () => {
          await checkDownloaderStatus();
          schedule();
        },
        downloadCountRef.current > 0 ? 3000 : 15000
      );
    };
    let lastCheck = 0;
    const recheck = async () => {
      lastCheck = Date.now();
      await checkDownloaderStatus();
      schedule();
    };
    const handleProgress = () => {
      if (downloadCountRef.current === 0 && Date.now() - lastCheck > 2000) recheck();
    };

    recheck();
    const unsubProgress = window.electron.onDownloadProgress?.(handleProgress);
    const unsubComplete = window.electron.onDownloadComplete?.(recheck);
    const unsubError = window.electron.onDownloadError?.(recheck);
    return () => {
      canceled = true;
      clearTimeout(timeout);
      if (typeof unsubProgress === "function") unsubProgress();
      if (typeof unsubComplete === "function") unsubComplete();
      if (typeof unsubError === "function") unsubError();
    };
  }, [settings?.downloadDirectory, location.pathname]);

  // Recently played games for the rail. Reading the library here also records
  // today's playtime totals for Home's weekly stats, since the rail is always
  // mounted and refreshes whenever a game closes.
  useEffect(() => {
    let canceled = false;
    const load = async () => {
      try {
        const [installed, custom] = await Promise.all([
          window.electron.getGames(),
          window.electron.getCustomGames(),
        ]);
        const library = [
          ...(installed || []).map(game => ({ ...game, isCustom: false })),
          ...(custom || []).map(game => ({ ...game, isCustom: true })),
        ];
        recordLibrarySnapshot(library);
        const list = recentGamesService
          .getRecentGames()
          .map(recent => library.find(game => (game.game || game.name) === recent.game))
          .filter(Boolean)
          .slice(0, MAX_RAIL_GAMES);
        if (canceled) return;
        setRecentGames(previous =>
          previous.length === list.length &&
          previous.every((game, index) => game.game === list[index].game)
            ? previous
            : list
        );
      } catch (error) {
        console.error("Error loading recent games for the rail:", error);
      }
    };
    load();
    const unsubLaunch = window.electron.onGameLaunchSuccess?.(load);
    const unsubClosed = window.electron.onGameClosed?.(load);
    return () => {
      canceled = true;
      if (typeof unsubLaunch === "function") unsubLaunch();
      if (typeof unsubClosed === "function") unsubClosed();
    };
  }, [location.pathname]);

  useEffect(() => {
    /**  @param {KeyboardEvent} event */
    const handleCtrlNavigation = event => {
      if (!(event.ctrlKey || event.metaKey)) return;
      switch (event.key) {
        case "1": {
          navigate("/");
          break;
        }
        case "2": {
          navigate("/search");
          break;
        }
        case "3": {
          navigate("/library");
          break;
        }
        case "4": {
          navigate("/downloads");
          break;
        }
        case "5": {
          navigate("/profile");
          break;
        }
        case "6": {
          navigate("/settings");
          break;
        }
      }
    };

    window.addEventListener("keydown", handleCtrlNavigation);
    return () => window.removeEventListener("keydown", handleCtrlNavigation);
  }, []);

  const openGame = useCallback(
    game => navigate("/gamescreen", { state: { gameData: game } }),
    [navigate]
  );

  const renderItem = item => {
    if (item.hidden) return null;
    const active = isActive(item.path);
    const badge =
      item.path === "/downloads"
        ? downloadCount
        : item.path === "/ascend"
          ? ascendNotificationCount
          : 0;
    return (
      <RailTooltip key={item.path} label={item.label}>
        <Link
          to={item.path}
          // A stable selector for plugins and themes
          data-nav-path={item.path}
          aria-label={item.label}
          aria-current={active ? "page" : undefined}
          onClick={() => {
            if (item.path !== location.pathname) setPendingPath(item.path);
          }}
          // Fetch Ascend's data on the way to the click
          onPointerEnter={item.path === "/ascend" ? prefetchAscendData : undefined}
          className={tileClass(active)}
          style={{ width: NAVIGATION_RAIL_TILE_PX, height: NAVIGATION_RAIL_TILE_PX }}
        >
          <item.icon className="h-5 w-5" strokeWidth={1.75} />
          <Badge count={badge} />
        </Link>
      </RailTooltip>
    );
  };

  const searchItem = { path: "/search", label: t("common.search"), icon: Search };

  return (
    <TooltipProvider>
      <nav
        aria-label={t("tour.navigationBar.title")}
        className="fixed bottom-0 left-0 top-0 z-40 flex select-none flex-col items-center border-r border-border/60 pb-4 backdrop-blur-xl"
        style={{
          width: NAVIGATION_RAIL_WIDTH_PX,
          paddingTop: MENU_BAR_HEIGHT_PX + 4,
          backgroundColor:
            "rgb(var(--color-nav-background, var(--color-background)) / 0.78)",
        }}
        data-tour="navigation"
        // Slides in from the window edge as the boot logo lands (app.css)
        data-boot-dock
      >
        <RailAvatar active={isActive("/profile")} label={t("common.profile")} />

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-4">
          <div className="flex flex-col items-center gap-1.5 rounded-[14px] border border-border/60 bg-card/80 p-1.5 shadow-[0_8px_32px_rgb(0_0_0/0.35)]">
            {pageItems.map(renderItem)}
            {recentGames.length > 0 && (
              // Short windows keep the page buttons and drop the game covers
              <div
                data-tour="home-recent"
                className="flex flex-col items-center gap-1.5 [@media(max-height:760px)]:hidden"
              >
                <div className="my-0.5 h-px w-8 bg-border/70" aria-hidden="true" />
                {recentGames.map(game => (
                  <RailGameThumb
                    key={game.game || game.name}
                    game={game}
                    active={openGameName === (game.game || game.name)}
                    onOpen={openGame}
                  />
                ))}
                <div className="my-0.5 h-px w-8 bg-border/70" aria-hidden="true" />
              </div>
            )}
            {renderItem(searchItem)}
          </div>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          {footerItems.map(renderItem)}
        </div>
      </nav>
    </TooltipProvider>
  );
});

Navigation.displayName = "Navigation";

export default Navigation;
