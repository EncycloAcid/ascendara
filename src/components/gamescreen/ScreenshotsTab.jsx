import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { heroImageCache } from "@/lib/gameImageCache";

const DB_NAME = "ascendara-screenshots-db";
const DB_VERSION = 1;
const STORE_NAME = "screenshots";

function openScreenshotsDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("gameName", "gameName", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadGameScreenshots(gameName) {
  if (!gameName || typeof indexedDB === "undefined") return [];
  const db = await openScreenshotsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const index = tx.objectStore(STORE_NAME).index("gameName");
    const request = index.getAll(IDBKeyRange.only(gameName));
    request.onsuccess = () => {
      const items = (request.result || []).sort((a, b) => b.addedAt - a.addedAt);
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

async function saveScreenshotRecord(record) {
  const db = await openScreenshotsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteScreenshotRecord(id) {
  const db = await openScreenshotsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function getImageDimensions(dataUrl) {
  return new Promise(resolve => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

export default function ScreenshotsTab({ gameName, onHeroUpdated }) {
  const [screenshots, setScreenshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [settingHeroId, setSettingHeroId] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadGameScreenshots(gameName)
      .then(items => {
        if (!cancelled) setScreenshots(items);
      })
      .catch(error => {
        console.error("[ScreenshotsTab] Failed to load screenshots:", error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameName]);

  const handleFiles = useCallback(
    async fileList => {
      const files = Array.from(fileList || []).filter(file =>
        file.type?.startsWith("image/")
      );
      if (files.length === 0) return;
      setAdding(true);
      try {
        const added = [];
        for (const file of files) {
          const dataUrl = await readFileAsDataUrl(file);
          const { width, height } = await getImageDimensions(dataUrl);
          const record = {
            id: `${gameName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            gameName,
            fileName: file.name || "Screenshot",
            dataUrl,
            width,
            height,
            addedAt: Date.now(),
          };
          await saveScreenshotRecord(record);
          added.push(record);
        }
        setScreenshots(prev => [...added.reverse(), ...prev]);
        toast.success(
          added.length === 1
            ? "Screenshot added to gallery"
            : `${added.length} screenshots added to gallery`
        );
      } catch (error) {
        console.error("[ScreenshotsTab] Error adding screenshots:", error);
        toast.error("Failed to save screenshot");
      } finally {
        setAdding(false);
      }
    },
    [gameName]
  );

  const handleDelete = useCallback(async item => {
    try {
      await deleteScreenshotRecord(item.id);
      setScreenshots(prev => {
        const next = prev.filter(s => s.id !== item.id);
        setLightboxIndex(curr => {
          if (curr === null) return null;
          if (next.length === 0) return null;
          return Math.min(curr, next.length - 1);
        });
        return next;
      });
      toast.success("Screenshot removed");
    } catch (error) {
      console.error("[ScreenshotsTab] Failed to delete screenshot:", error);
      toast.error("Failed to remove screenshot");
    }
  }, []);

  const handleSetAsHero = useCallback(
    async item => {
      if (!gameName || !item?.dataUrl) return;
      setSettingHeroId(item.id);
      try {
        if (window.electron?.saveGameAsset) {
          await window.electron.saveGameAsset(
            gameName,
            "hero.ascendara.jpg",
            item.dataUrl
          );
        }
        heroImageCache.set(gameName, item.dataUrl);
        onHeroUpdated?.(item.dataUrl);
        toast.success("Hero banner updated");
      } catch (error) {
        console.error("[ScreenshotsTab] Failed to set hero banner:", error);
        toast.error("Could not update hero banner");
      } finally {
        setSettingHeroId(null);
      }
    },
    [gameName, onHeroUpdated]
  );

  useEffect(() => {
    if (lightboxIndex === null) return undefined;
    const onKeyDown = e => {
      if (e.key === "Escape") {
        setLightboxIndex(null);
      } else if (e.key === "ArrowLeft") {
        setLightboxIndex(idx =>
          idx === null ? null : (idx - 1 + screenshots.length) % screenshots.length
        );
      } else if (e.key === "ArrowRight") {
        setLightboxIndex(idx => (idx === null ? null : (idx + 1) % screenshots.length));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, screenshots.length]);

  const activeLightbox =
    lightboxIndex !== null && screenshots[lightboxIndex]
      ? screenshots[lightboxIndex]
      : null;

  return (
    <div
      className="space-y-5"
      onDragOver={e => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false);
      }}
      onDrop={e => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer?.files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 text-[1.375rem] font-semibold tracking-tight text-foreground">
            Screenshots
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Drop or attach local screenshots for {gameName}. Click any shot to view
            fullscreen or set it as your Hero Banner.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-2 rounded-[10px] font-semibold text-secondary"
          disabled={adding}
          onClick={() => fileInputRef.current?.click()}
        >
          {adding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add Screenshots
        </Button>
      </div>

      {/* Dropzone / Gallery */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : screenshots.length === 0 ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-3 rounded-[16px] border-2 border-dashed bg-card px-6 py-16 text-center transition-colors",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border/70 hover:border-foreground/25"
          )}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-primary/10 text-primary">
            <Camera className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold text-foreground">
              No screenshots yet
            </p>
            <p className="text-sm text-muted-foreground">
              Drag & drop PNG, JPG, or WebP images here—or click to browse.
            </p>
          </div>
        </button>
      ) : (
        <div
          className={cn(
            "rounded-[16px] transition-colors",
            isDragging && "ring-2 ring-primary ring-offset-2 ring-offset-background"
          )}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {screenshots.map((shot, idx) => (
              <div
                key={shot.id}
                onClick={() => setLightboxIndex(idx)}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setLightboxIndex(idx);
                  }
                }}
                className="group relative aspect-video cursor-pointer overflow-hidden rounded-[10px] border border-border/70 bg-card transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-foreground/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <img
                  src={shot.dataUrl}
                  alt={shot.fileName}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/85 via-black/15 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={settingHeroId === shot.id}
                      onClick={e => {
                        e.stopPropagation();
                        handleSetAsHero(shot);
                      }}
                      title="Set as Hero Banner"
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md transition-colors hover:bg-primary hover:text-secondary"
                    >
                      {settingHeroId === shot.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      Set as Hero
                    </button>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        handleDelete(shot);
                      }}
                      title="Remove screenshot"
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white backdrop-blur-md transition-colors hover:bg-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-white/90">
                    <span className="truncate font-medium">{shot.fileName}</span>
                    {shot.width > 0 && shot.height > 0 && (
                      <span className="shrink-0 tabular-nums text-[11px] text-white/70">
                        {shot.width}×{shot.height}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Quick add card */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex aspect-video flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed border-border/70 bg-card/50 text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-card hover:text-foreground"
            >
              <Upload className="h-5 w-5" />
              <span className="text-xs font-medium">Add or drop more</span>
            </button>
          </div>
        </div>
      )}

      {/* Fullscreen Lightbox */}
      {activeLightbox && (
        <div
          className="fixed inset-0 z-[10000] flex flex-col bg-black/92 backdrop-blur-md"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Top lightbox bar */}
          <div
            className="flex items-center justify-between gap-4 px-6 py-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex min-w-0 items-center gap-3 text-white">
              <ImageIcon className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-sm font-semibold">
                {activeLightbox.fileName}
              </span>
              {activeLightbox.width > 0 && (
                <span className="text-xs tabular-nums text-white/60">
                  {activeLightbox.width}×{activeLightbox.height}
                </span>
              )}
              <span className="text-xs tabular-nums text-white/50">
                {lightboxIndex + 1} / {screenshots.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="gap-1.5 rounded-[10px] font-semibold text-secondary"
                disabled={settingHeroId === activeLightbox.id}
                onClick={() => handleSetAsHero(activeLightbox)}
              >
                {settingHeroId === activeLightbox.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Set as Hero Banner
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 rounded-[10px] border-white/20 bg-white/10 text-white hover:bg-red-600 hover:text-white"
                onClick={() => handleDelete(activeLightbox)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
              <button
                type="button"
                onClick={() => setLightboxIndex(null)}
                aria-label="Close lightbox"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Center image + prev/next controls */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-8">
            {screenshots.length > 1 && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  setLightboxIndex(
                    idx => (idx - 1 + screenshots.length) % screenshots.length
                  );
                }}
                aria-label="Previous screenshot"
                className="absolute left-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/25"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            <img
              src={activeLightbox.dataUrl}
              alt={activeLightbox.fileName}
              onClick={e => e.stopPropagation()}
              className="max-h-full max-w-full rounded-[12px] object-contain shadow-2xl"
            />
            {screenshots.length > 1 && (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  setLightboxIndex(idx => (idx + 1) % screenshots.length);
                }}
                aria-label="Next screenshot"
                className="absolute right-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/25"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
