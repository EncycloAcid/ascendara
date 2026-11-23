import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Layers,
  Loader2,
  Package,
  PackagePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const DEPLOY_PRESETS = [
  { label: "Game Root", value: "" },
  { label: "Data", value: "Data" },
  { label: "Mods", value: "Mods" },
  { label: "BepInEx/plugins", value: "BepInEx/plugins" },
];

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(val >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export default function ModManagerPanel({ gameName, isCustom = false }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [subpathDraft, setSubpathDraft] = useState("");
  const [savingSubpath, setSavingSubpath] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  // Keep metadata from recent Nexus downloads keyed by filename
  const recentMetaRef = useRef(new Map());

  const loadMods = useCallback(async () => {
    if (!gameName || !window.electron?.modManagerList) {
      setLoading(false);
      return;
    }
    try {
      const data = await window.electron.modManagerList(gameName, Boolean(isCustom));
      setState(data);
      setSubpathDraft(data?.deploySubpath || "");
    } catch (err) {
      console.error("[ModManager] Failed to list mods:", err);
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [gameName, isCustom]);

  useEffect(() => {
    setLoading(true);
    loadMods();
  }, [loadMods]);

  // Listen for completed Nexus mod downloads and refresh automatically
  useEffect(() => {
    const onDownloaded = event => {
      const detail = event.detail;
      if (!detail || detail.gameName !== gameName) return;
      if (detail.fileName && detail.mod) {
        recentMetaRef.current.set(detail.fileName.toLowerCase(), detail.mod);
      }
      loadMods();
    };
    window.addEventListener("ascendara-mod-downloaded", onDownloaded);
    return () => window.removeEventListener("ascendara-mod-downloaded", onDownloaded);
  }, [gameName, loadMods]);

  const handleImport = async () => {
    if (!window.electron?.modManagerImportDialog) return;
    setBusyId("import");
    try {
      const res = await window.electron.modManagerImportDialog(
        gameName,
        Boolean(isCustom)
      );
      if (res?.canceled) return;
      if (res?.state) setState(res.state);
      if (res?.errors?.length) {
        toast.error("Some mods could not be installed", {
          description: res.errors.join(" · "),
        });
      } else {
        toast.success("Mod installed and enabled");
      }
    } catch (err) {
      toast.error("Failed to import mod", { description: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const handleDropFiles = async e => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragOver(false);

    if (!window.electron?.modManagerInstallArchive) return;
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;

    const ALLOWED_RE = /\.(zip|7z|rar|pak|dll|asi|esp|esm|esl|ba2|bsa|ini|cfg|lua|jar|mod)$/i;
    const validFiles = files.filter(f => ALLOWED_RE.test(f.name || ""));
    if (!validFiles.length) {
      toast.error("Drop a .zip, .7z, .rar, or mod file (.pak, .dll, .asi, .esp)");
      return;
    }

    setBusyId("drop");
    let installedCount = 0;
    const errors = [];
    let latestState = null;

    for (const file of validFiles) {
      try {
        const filePath = window.electron?.getPathForFile
          ? window.electron.getPathForFile(file)
          : file.path;
        if (!filePath) throw new Error("Could not resolve local file path");
        latestState = await window.electron.modManagerInstallArchive(
          gameName,
          Boolean(isCustom),
          filePath,
          { enable: true }
        );
        installedCount++;
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }

    if (latestState) setState(latestState);
    if (installedCount > 0) {
      toast.success(
        installedCount === 1
          ? `Installed and enabled ${validFiles[0].name}`
          : `Installed and enabled ${installedCount} mods`
      );
    }
    if (errors.length > 0) {
      toast.error("Some dropped mods failed to install", {
        description: errors.join(" · "),
      });
    }
    setBusyId(null);
  };

  const handleInstallPending = async archive => {
    if (!window.electron?.modManagerInstallArchive) return;
    setBusyId(archive.fileName);
    try {
      const meta = recentMetaRef.current.get(archive.fileName.toLowerCase()) || {};
      const next = await window.electron.modManagerInstallArchive(
        gameName,
        Boolean(isCustom),
        archive.path,
        { ...meta, enable: true }
      );
      setState(next);
      toast.success(`Installed ${meta.name || archive.fileName}`);
    } catch (err) {
      toast.error("Failed to install mod archive", { description: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const handleToggle = async (mod, nextEnabled) => {
    if (!window.electron?.modManagerToggle) return;
    setBusyId(mod.id);
    try {
      const next = await window.electron.modManagerToggle(
        gameName,
        Boolean(isCustom),
        mod.id,
        nextEnabled
      );
      setState(next);
      toast.success(nextEnabled ? `Enabled ${mod.name}` : `Disabled ${mod.name}`);
    } catch (err) {
      toast.error("Failed to update mod", { description: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const handleMove = async (index, direction) => {
    if (!state?.installedMods || !window.electron?.modManagerReorder) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= state.installedMods.length) return;

    const ids = state.installedMods.map(m => m.id);
    [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];

    setBusyId(state.installedMods[index].id);
    try {
      const next = await window.electron.modManagerReorder(
        gameName,
        Boolean(isCustom),
        ids
      );
      setState(next);
    } catch (err) {
      toast.error("Failed to reorder mods", { description: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const handleUninstall = async mod => {
    if (!window.electron?.modManagerUninstall) return;
    setBusyId(mod.id);
    try {
      const next = await window.electron.modManagerUninstall(
        gameName,
        Boolean(isCustom),
        mod.id,
        false
      );
      setState(next);
      toast.success(`Uninstalled ${mod.name} (vanilla files restored)`);
    } catch (err) {
      toast.error("Failed to uninstall mod", { description: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const handleApplySubpath = async nextPath => {
    if (!window.electron?.modManagerSetSubpath) return;
    setSavingSubpath(true);
    try {
      const next = await window.electron.modManagerSetSubpath(
        gameName,
        Boolean(isCustom),
        nextPath
      );
      setState(next);
      setSubpathDraft(next?.deploySubpath || "");
      toast.success(
        next?.deploySubpath
          ? `Deploy target set to "${next.deploySubpath}"`
          : "Deploy target set to Game Root"
      );
    } catch (err) {
      toast.error("Invalid deploy folder", { description: err.message });
    } finally {
      setSavingSubpath(false);
    }
  };

  const [newProfileName, setNewProfileName] = useState("");
  const [showNewProfile, setShowNewProfile] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);

  const handlePurgeAll = async () => {
    if (!window.electron?.modManagerPurge) return;
    setBusyId("purge");
    try {
      const next = await window.electron.modManagerPurge(gameName, Boolean(isCustom));
      setState(next);
      toast.success("All mods disabled and vanilla files restored");
    } catch (err) {
      toast.error("Failed to purge mods", { description: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveProfile = async e => {
    e?.preventDefault();
    const name = newProfileName.trim();
    if (!name || !window.electron?.modManagerSaveProfile) return;
    setBusyId("profile-save");
    try {
      const next = await window.electron.modManagerSaveProfile(
        gameName,
        Boolean(isCustom),
        name
      );
      setState(next);
      setNewProfileName("");
      setShowNewProfile(false);
      toast.success(`Saved profile "${name}"`);
    } catch (err) {
      toast.error("Failed to save profile", { description: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const handleSwitchProfile = async profile => {
    if (!window.electron?.modManagerSwitchProfile) return;
    if (profile.id === state?.activeProfileId) return;
    setBusyId(`profile-${profile.id}`);
    try {
      const next = await window.electron.modManagerSwitchProfile(
        gameName,
        Boolean(isCustom),
        profile.id
      );
      setState(next);
      toast.success(`Switched to profile "${profile.name}"`);
    } catch (err) {
      toast.error("Failed to switch profile", { description: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteProfile = async (e, profile) => {
    e.stopPropagation();
    if (!window.electron?.modManagerDeleteProfile || profile.id === "default") return;
    setBusyId(`profile-del-${profile.id}`);
    try {
      const next = await window.electron.modManagerDeleteProfile(
        gameName,
        Boolean(isCustom),
        profile.id
      );
      setState(next);
      toast.success(`Deleted profile "${profile.name}"`);
    } catch (err) {
      toast.error("Failed to delete profile", { description: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const installedMods = state?.installedMods || [];
  const pendingArchives = state?.pendingArchives || [];
  const profiles = state?.profiles || [{ id: "default", name: "Default", enabledCount: 0 }];
  const activeProfileId = state?.activeProfileId || "default";
  const conflicts = state?.conflicts || [];
  const enabledCount = installedMods.filter(m => m.enabled).length;

  return (
    <section
      className={cn(
        "relative rounded-[12px] border bg-card p-5 transition-colors",
        isDragOver ? "border-primary bg-primary/5" : "border-border/70"
      )}
      onDragEnter={e => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current += 1;
        setIsDragOver(true);
      }}
      onDragOver={e => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragLeave={e => {
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDragOver(false);
      }}
      onDrop={handleDropFiles}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-[12px] border-2 border-dashed border-primary bg-background/85 backdrop-blur-sm">
          <PackagePlus className="h-8 w-8 text-primary" />
          <p className="text-sm font-semibold text-foreground">
            Drop mod archive to install &amp; enable
          </p>
          <p className="text-xs text-muted-foreground">
            Supports .zip, .7z, .rar, .pak, .dll, .asi, .esp
          </p>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Nexus Mod Manager
              </h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {enabledCount} / {installedMods.length} active
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Stage, enable, reorder load order, and safely back up overwritten vanilla
              files automatically.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="gap-1.5 text-secondary"
            onClick={handleImport}
            disabled={busyId !== null}
          >
            {busyId === "import" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PackagePlus className="h-3.5 w-3.5" />
            )}
            Import Mod
          </Button>
          {state?.modsDir && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => window.electron?.openFolderPath?.(state.modsDir)}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Mods Folder
            </Button>
          )}
          {enabledCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-muted-foreground hover:text-destructive"
              onClick={handlePurgeAll}
              disabled={busyId !== null}
              title="Disable all mods and restore backed-up vanilla files"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Purge All
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={loadMods}
            disabled={loading}
            title="Refresh mod list"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Mod Profiles switcher bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-border/60 bg-background/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">
            Profile:
          </span>
          {profiles.map(profile => {
            const isActive = profile.id === activeProfileId;
            return (
              <div
                key={profile.id}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  isActive
                    ? "bg-primary text-secondary shadow-sm"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => handleSwitchProfile(profile)}
                  className="flex items-center gap-1"
                >
                  <span>{profile.name}</span>
                  <span className={cn("text-[10px] opacity-75")}>
                    ({profile.enabledCount})
                  </span>
                </button>
                {profile.id !== "default" && (
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={e => handleDeleteProfile(e, profile)}
                    title={`Delete profile "${profile.name}"`}
                    className="ml-0.5 rounded p-0.5 opacity-70 hover:bg-black/15 hover:opacity-100"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {showNewProfile ? (
          <form onSubmit={handleSaveProfile} className="flex items-center gap-1.5">
            <Input
              value={newProfileName}
              onChange={e => setNewProfileName(e.target.value)}
              placeholder="e.g. Vanilla+, Co-op"
              className="h-7 w-40 text-xs"
              autoFocus
            />
            <Button
              type="submit"
              size="sm"
              className="h-7 px-2.5 text-xs text-secondary"
              disabled={!newProfileName.trim() || busyId !== null}
            >
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setShowNewProfile(false);
                setNewProfileName("");
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2.5 text-xs"
            disabled={busyId !== null}
            onClick={() => setShowNewProfile(true)}
          >
            <Plus className="h-3 w-3" />
            New Profile
          </Button>
        )}
      </div>

      {/* Deploy target subfolder bar */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-border/60 bg-background/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">
            Deploy Target:
          </span>
          {DEPLOY_PRESETS.map(preset => {
            const active = (state?.deploySubpath || "") === preset.value;
            return (
              <button
                key={preset.label}
                type="button"
                disabled={savingSubpath}
                onClick={() => handleApplySubpath(preset.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-primary text-secondary shadow-sm"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <form
          className="flex items-center gap-1.5"
          onSubmit={e => {
            e.preventDefault();
            handleApplySubpath(subpathDraft);
          }}
        >
          <Input
            value={subpathDraft}
            onChange={e => setSubpathDraft(e.target.value)}
            placeholder="Custom subfolder (e.g. Data)"
            className="h-7 w-48 text-xs"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs"
            disabled={savingSubpath || subpathDraft === (state?.deploySubpath || "")}
          >
            Apply
          </Button>
        </form>
      </div>

      {/* Pending / Downloaded archives ready to install */}
      {pendingArchives.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
            <Package className="h-3.5 w-3.5" />
            Downloaded & Ready to Install ({pendingArchives.length})
          </div>
          <div className="space-y-1.5">
            {pendingArchives.map(archive => (
              <div
                key={archive.fileName}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-primary/25 bg-primary/5 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {archive.fileName}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatBytes(archive.sizeBytes)}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 text-xs text-secondary"
                  disabled={busyId !== null}
                  onClick={() => handleInstallPending(archive)}
                >
                  {busyId === archive.fileName ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <PackagePlus className="h-3 w-3" />
                  )}
                  Install & Enable
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* File conflict detection banner */}
      {conflicts.length > 0 && (
        <div className="mt-4 rounded-[10px] border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5">
          <button
            type="button"
            onClick={() => setShowConflicts(prev => !prev)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {conflicts.length} file {conflicts.length === 1 ? "conflict" : "conflicts"}{" "}
                between enabled mods — later in load order wins
              </span>
            </div>
            {showConflicts ? (
              <ChevronUp className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            )}
          </button>
          {showConflicts && (
            <div className="mt-2.5 max-h-48 space-y-1.5 overflow-y-auto border-t border-amber-500/20 pt-2">
              {conflicts.slice(0, 50).map(conflict => (
                <div
                  key={conflict.file}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/60 px-2.5 py-1.5 text-[11px]"
                >
                  <code className="truncate font-mono text-foreground">
                    {conflict.file}
                  </code>
                  <span className="shrink-0 text-muted-foreground">
                    <strong className="text-emerald-600 dark:text-emerald-400">
                      {conflict.winnerName}
                    </strong>{" "}
                    overrides {conflict.overriddenNames.join(", ")}
                  </span>
                </div>
              ))}
              {conflicts.length > 50 && (
                <p className="text-[11px] text-muted-foreground">
                  +{conflicts.length - 50} more conflicting files
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Installed mods load order list */}
      <div className="mt-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading mods...
          </div>
        ) : installedMods.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-border/70 py-8 text-center">
            <ShieldCheck className="h-7 w-7 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No mods installed yet</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Download a mod from Nexus Mods below or click <strong>Import Mod</strong> to
              install any <code>.zip</code>, <code>.7z</code>, <code>.rar</code>, or loose
              mod file. Overwritten vanilla files are backed up automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {installedMods.map((mod, idx) => (
              <div
                key={mod.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 rounded-[10px] border px-3 py-2.5 transition-colors",
                  mod.enabled && mod.overriddenCount > 0
                    ? "border-amber-500/40 bg-amber-500/[0.04]"
                    : mod.enabled
                      ? "border-border/80 bg-background/60"
                      : "border-border/40 bg-background/25 opacity-75"
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {idx + 1}
                  </span>
                  <Switch
                    checked={mod.enabled}
                    disabled={busyId !== null}
                    onCheckedChange={checked => handleToggle(mod, checked)}
                    aria-label={`Toggle ${mod.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {mod.name}
                      </span>
                      {mod.version && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          v{mod.version}
                        </span>
                      )}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          mod.enabled
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {mod.enabled ? "Active" : "Disabled"}
                      </span>
                      {mod.enabled && mod.winsCount > 0 && (
                        <span
                          className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"
                          title={`Wins ${mod.winsCount} file ${mod.winsCount === 1 ? "conflict" : "conflicts"} (loaded later)`}
                        >
                          Overrides {mod.winsCount}
                        </span>
                      )}
                      {mod.enabled && mod.overriddenCount > 0 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
                          title={`${mod.overriddenCount} ${mod.overriddenCount === 1 ? "file is" : "files are"} overwritten by a later mod — move down in load order to give this mod priority`}
                        >
                          <AlertTriangle className="h-2.5 w-2.5" />
                          {mod.overriddenCount} overwritten
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {mod.author ? `by ${mod.author} · ` : ""}
                      {mod.fileCount} {mod.fileCount === 1 ? "file" : "files"} ·{" "}
                      {formatBytes(mod.sizeBytes)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={idx === 0 || busyId !== null}
                    onClick={() => handleMove(idx, -1)}
                    title="Move earlier in load order"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    disabled={idx === installedMods.length - 1 || busyId !== null}
                    onClick={() => handleMove(idx, 1)}
                    title="Move later in load order (higher priority)"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={busyId !== null}
                    onClick={() => handleUninstall(mod)}
                    title="Uninstall mod and restore vanilla files"
                  >
                    {busyId === mod.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
