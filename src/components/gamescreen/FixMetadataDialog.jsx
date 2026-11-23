import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import steamService from "@/services/games/gameInfoService";
import gameApiCache from "@/services/games/gameInfoCacheService";
import { gameImageCache, heroImageCache } from "@/lib/gameImageCache";

const ALIAS_STORAGE_PREFIX = "ascendara-metadata-alias::";

export function getMetadataAlias(gameId) {
  if (!gameId) return null;
  try {
    return localStorage.getItem(`${ALIAS_STORAGE_PREFIX}${gameId}`) || null;
  } catch {
    return null;
  }
}

export function setMetadataAlias(gameId, alias) {
  if (!gameId) return;
  try {
    if (!alias || alias === gameId) {
      localStorage.removeItem(`${ALIAS_STORAGE_PREFIX}${gameId}`);
    } else {
      localStorage.setItem(`${ALIAS_STORAGE_PREFIX}${gameId}`, alias);
    }
  } catch {
    // ignore storage errors
  }
}

export default function FixMetadataDialog({
  open,
  onOpenChange,
  gameName,
  onMetadataUpdated,
  onArtworkUpdated,
}) {
  const [query, setQuery] = useState("");
  const [refreshArtwork, setRefreshArtwork] = useState(true);
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    if (open && gameName) {
      setQuery(getMetadataAlias(gameName) || gameName);
    }
  }, [open, gameName]);

  const runRefresh = async targetTitle => {
    const cleanQuery = (targetTitle || "").trim();
    if (!cleanQuery || !gameName) return;

    setIsFetching(true);
    try {
      // Clear cached Steam/GOG/Wikipedia + HLTB entries for both original name and new query
      gameApiCache.clearCachedGame(gameName);
      if (cleanQuery !== gameName) {
        gameApiCache.clearCachedGame(cleanQuery);
      }

      // Fetch fresh details (automatically cascades Steam -> GOG -> Wikipedia + Wikidata)
      const data = await steamService.getGameDetails(cleanQuery);

      if (data) {
        if (data.screenshots && data.screenshots.length > 0) {
          data.formatted_screenshots = data.screenshots.map(shot => ({
            ...shot,
            formatted_url: steamService.formatImageUrl(shot.url, "screenshot_huge"),
          }));
        }
        // Persist alias & cache under the library's gameName so Library cards & future loads hit immediately
        setMetadataAlias(gameName, cleanQuery);
        gameApiCache.cacheGame(gameName, data, "steam");
        onMetadataUpdated?.(data);
      } else {
        onMetadataUpdated?.(null);
      }

      let artUpdated = false;
      if (refreshArtwork) {
        try {
          let coverUrl = null;
          let heroUrl = null;

          if (window.electron?.getSteamGridUrls) {
            const art = await window.electron.getSteamGridUrls(cleanQuery);
            coverUrl = art?.grid || art?.header || null;
            heroUrl = art?.hero || null;
          }

          if (!coverUrl && data?.cover?.url) coverUrl = data.cover.url;
          if (!heroUrl && data?.screenshots?.[0]?.url) heroUrl = data.screenshots[0].url;

          if (coverUrl && window.electron?.updateGameCover) {
            await window.electron.updateGameCover(gameName, null, coverUrl);
            gameImageCache.set(gameName, coverUrl);
            window.dispatchEvent(
              new CustomEvent("game-cover-updated", {
                detail: { gameName, dataUrl: coverUrl },
              })
            );
            artUpdated = true;
          }

          if (heroUrl && window.electron?.saveGameAsset) {
            await window.electron.saveGameAsset(gameName, "hero.ascendara.jpg", heroUrl);
            heroImageCache.set(gameName, heroUrl);
            onArtworkUpdated?.({ coverUrl, heroUrl });
            artUpdated = true;
          } else if (coverUrl) {
            onArtworkUpdated?.({ coverUrl, heroUrl: null });
          }
        } catch (artErr) {
          console.warn("[FixMetadataDialog] Artwork refresh failed:", artErr);
        }
      }

      if (data) {
        const sourceLabel =
          data.source === "gog"
            ? "GOG"
            : data.source === "wikipedia"
              ? "Wikipedia"
              : "Steam";
        toast.success(`Matched "${data.name}" (${sourceLabel})`, {
          description: artUpdated ? "Game info and artwork updated" : "Game info updated",
        });
        onOpenChange(false);
      } else if (artUpdated) {
        toast.success("Artwork refreshed", {
          description: `No text info found for "${cleanQuery}", but artwork was updated.`,
        });
        onOpenChange(false);
      } else {
        toast.error(`No match found for "${cleanQuery}"`, {
          description: "Try a shorter or official title (e.g. without version or repack tags).",
        });
      }
    } catch (error) {
      console.error("[FixMetadataDialog] Refresh failed:", error);
      toast.error("Failed to refresh metadata", { description: error.message });
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fix Game Info &amp; Artwork</DialogTitle>
          <DialogDescription>
            Clear cached metadata for <strong>{gameName}</strong> and search Steam, GOG,
            and Wikipedia with a custom title.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={e => {
            e.preventDefault();
            runRefresh(query);
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="fix-metadata-query"
              className="text-xs font-medium text-muted-foreground"
            >
              Search Title
            </label>
            <Input
              id="fix-metadata-query"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="e.g. The Legend of Zelda: Breath of the Wild"
              disabled={isFetching}
              autoFocus
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={refreshArtwork}
              onCheckedChange={checked => setRefreshArtwork(Boolean(checked))}
              disabled={isFetching}
            />
            <span>Also refresh Cover &amp; Hero Banner artwork</span>
          </label>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={isFetching}
              onClick={() => {
                setQuery(gameName || "");
                runRefresh(gameName);
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reset &amp; Refresh
            </Button>
            <Button
              type="submit"
              size="sm"
              className="gap-1.5 text-secondary"
              disabled={isFetching || !query.trim()}
            >
              {isFetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              Fetch Match
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
