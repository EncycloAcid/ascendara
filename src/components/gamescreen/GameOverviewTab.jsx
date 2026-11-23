import { useEffect, useState } from "react";
import SafeHtml from "@/components/SafeHtml";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLanguage } from "@/context/LanguageContext";
import HighballGameOptions from "@/components/gamescreen/HighballGameOptions";
import {
  ChevronLeft,
  ChevronRight,
  Edit3,
  ImageIcon,
  Info,
  Loader,
  Plus,
  Search,
  Terminal,
  X,
} from "lucide-react";

const PREVIEW_COUNT = 6;

function DetailGroup({ title, children }) {
  return (
    <div>
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="mt-1.5 text-sm text-foreground">{children}</div>
    </div>
  );
}

const isOnMac = window.electron?.getPlatform?.() === "darwin";

/** About the game, its screenshots, and the details that describe this install. */
export default function GameOverviewTab({
  game,
  steamData,
  steamLoading,
  screenshots,
  onEditGameInfo,
  isOnLinux,
  umuId,
  umuIdInput,
  onUmuIdInputChange,
  umuIdSaving,
  onSaveUmuId,
}) {
  const { t } = useLanguage();
  const [showAllScreenshots, setShowAllScreenshots] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const hasMatch = Boolean(steamData?.appid || steamData?.id || game?.steamAppId);
  const hasDescription = steamData?.about_the_game || steamData?.summary;
  const visibleScreenshots = showAllScreenshots
    ? screenshots
    : screenshots.slice(0, PREVIEW_COUNT);

  const matchSubtitle = (() => {
    if (!hasMatch) return t("gameScreen.noSteamMatchDescription");
    if (steamData?.source === "gog") return "Matched via GOG Catalog";
    if (steamData?.source === "wikipedia") return "Matched via Wikipedia & Wikidata";
    return `Steam App ID: ${steamData?.appid || game?.steamAppId}`;
  })();

  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKeyDown = e => {
      if (e.key === "Escape") setLightboxIndex(null);
      else if (e.key === "ArrowRight") {
        setLightboxIndex(idx => (idx + 1) % screenshots.length);
      } else if (e.key === "ArrowLeft") {
        setLightboxIndex(idx => (idx - 1 + screenshots.length) % screenshots.length);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, screenshots.length]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        {hasDescription ? (
          <section className="rounded-[12px] border border-border/70 bg-card p-6">
            <h2 className="mb-3 text-lg font-semibold tracking-tight text-foreground">
              {t("gameScreen.aboutGame")}
            </h2>
            {steamData.about_the_game ? (
              <SafeHtml
                className="steam-description leading-relaxed text-muted-foreground"
                html={steamData.about_the_game}
              />
            ) : (
              <p className="leading-relaxed text-muted-foreground">{steamData.summary}</p>
            )}
          </section>
        ) : (
          <section className="flex items-center justify-center rounded-[12px] border border-border/70 bg-card px-6 py-12 text-center text-sm text-muted-foreground">
            {steamLoading ? (
              <Loader className="h-5 w-5 animate-spin text-primary" />
            ) : (
              <div>
                <p className="font-medium text-foreground">
                  {t("gameScreen.noSteamMatch")}
                </p>
                <p className="mt-1">{t("gameScreen.noSteamMatchDescription")}</p>
              </div>
            )}
          </section>
        )}

        {screenshots.length > 0 && (
          <section className="rounded-[12px] border border-border/70 bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                {t("gameScreen.screenshots")}
              </h2>
              {!showAllScreenshots && screenshots.length > PREVIEW_COUNT && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-primary"
                  onClick={() => setShowAllScreenshots(true)}
                >
                  {t("gameScreen.viewAll")} ({screenshots.length})
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {visibleScreenshots.map((screenshot, index) => (
                <button
                  key={index}
                  type="button"
                  className="group relative aspect-video overflow-hidden rounded-[10px] border border-border/60 bg-muted transition-all hover:border-primary/60"
                  onClick={() => setLightboxIndex(index)}
                >
                  <img
                    src={screenshot.formatted_url}
                    alt={t("gameScreen.screenshotAlt", { number: index + 1 })}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="space-y-4">
        <section className="space-y-4 rounded-[12px] border border-border/70 bg-card p-5">
          {/* Matched store/catalog entry */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {steamData?.cover?.url ? (
                <img
                  src={steamData.cover.url}
                  alt={steamData.name}
                  className="h-12 w-20 shrink-0 rounded-[8px] border border-border/60 object-cover"
                />
              ) : (
                <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded-[8px] border border-border/60 bg-muted">
                  {hasMatch ? (
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <Search className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {hasMatch
                    ? steamData?.name || game?.game || game?.name
                    : t("gameScreen.noSteamMatch")}
                </p>
                <p className="text-xs text-muted-foreground">{matchSubtitle}</p>
              </div>
            </div>
            {onEditGameInfo && (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={onEditGameInfo}
              >
                {hasMatch ? <Edit3 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {hasMatch ? t("gameScreen.editGameInfo") : t("gameScreen.setGameInfo")}
              </Button>
            )}
          </div>

          {steamData?.release_date && (
            <DetailGroup title={t("download.releaseDate") || "Release Date"}>
              {steamData.release_date}
            </DetailGroup>
          )}
          {steamData?.developers?.length > 0 && (
            <DetailGroup title={t("download.developers")}>
              {steamData.developers.join(", ")}
            </DetailGroup>
          )}
          {steamData?.publishers?.length > 0 && (
            <DetailGroup title={t("download.publishers")}>
              {steamData.publishers.join(", ")}
            </DetailGroup>
          )}
          {steamData?.genres?.length > 0 && (
            <DetailGroup title={t("download.genres") || "Genres"}>
              <div className="flex flex-wrap gap-1.5">
                {steamData.genres.map(g => (
                  <span
                    key={g.id || g.name}
                    className="rounded-md border border-border/60 bg-muted/50 px-2 py-0.5 text-xs text-foreground"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            </DetailGroup>
          )}
          {steamData?.platforms?.length > 0 && (
            <DetailGroup title="Platforms">
              <div className="flex flex-wrap gap-1.5">
                {steamData.platforms.map(p => (
                  <span
                    key={p.id || p.name}
                    className="rounded-md border border-border/60 bg-background/60 px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {p.name}
                  </span>
                ))}
              </div>
            </DetailGroup>
          )}
        </section>

        {isOnMac && /\.(exe|msi|bat)$/i.test(game?.executable || "") && (
          <HighballGameOptions
            game={game}
            steamAppId={game?.steamAppId || steamData?.appid}
          />
        )}

        {isOnLinux && (
          <section className="space-y-2 rounded-[12px] border border-border/70 bg-card p-5">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{t("gameScreen.umuId")}</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs">
                      {t("gameScreen.umuIdDescription")}{" "}
                      <button
                        onClick={() =>
                          window.electron.openURL("https://umu.openwinecomponents.org")
                        }
                        className="underline"
                      >
                        umu.openwinecomponents.org
                      </button>
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex gap-2">
              <Input
                value={umuIdInput}
                onChange={e => onUmuIdInputChange(e.target.value)}
                placeholder="umu-default"
                className="h-8 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 text-xs text-primary"
                disabled={umuIdSaving || umuIdInput === umuId}
                onClick={onSaveUmuId}
              >
                {umuIdSaving ? (
                  <Loader className="h-3 w-3 animate-spin" />
                ) : (
                  t("common.save")
                )}
              </Button>
            </div>
            {umuId && (
              <p className="text-xs text-muted-foreground">
                {t("gameScreen.umuIdActive")}{" "}
                <span className="font-mono text-foreground">{umuId}</span>
              </p>
            )}
          </section>
        )}
      </aside>

      {/* In-app screenshot lightbox */}
      {lightboxIndex !== null && screenshots[lightboxIndex] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 backdrop-blur-sm"
          onClick={() => setLightboxIndex(null)}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setLightboxIndex(null)}
            className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white transition-colors hover:bg-white/15"
          >
            <X className="h-5 w-5" />
          </button>
          {screenshots.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous screenshot"
                onClick={e => {
                  e.stopPropagation();
                  setLightboxIndex(
                    idx => (idx - 1 + screenshots.length) % screenshots.length
                  );
                }}
                className="absolute left-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white transition-colors hover:bg-white/15"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Next screenshot"
                onClick={e => {
                  e.stopPropagation();
                  setLightboxIndex(idx => (idx + 1) % screenshots.length);
                }}
                className="absolute right-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white transition-colors hover:bg-white/15"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
          <img
            src={screenshots[lightboxIndex].formatted_url}
            alt={t("gameScreen.screenshotAlt", { number: lightboxIndex + 1 })}
            className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <span className="absolute bottom-5 rounded-full border border-white/15 bg-black/60 px-3 py-1 text-xs font-medium tabular-nums text-white/80">
            {lightboxIndex + 1} / {screenshots.length}
          </span>
        </div>
      )}
    </div>
  );
}
