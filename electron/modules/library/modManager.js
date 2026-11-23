/**
 * Built-in Nexus Mod Manager (Staging, Deployment, Load Order, Vanilla Backups)
 *
 * Layout inside <gameDir>/AscendaraMods/:
 *   mods-manifest.json     - Ordered list of installed mods + deploySubpath
 *   .staging/<modId>/      - Extracted mod payload
 *   .backups/<relPath>     - Original vanilla files overwritten by enabled mods
 *   <downloaded archives>  - Archives downloaded via Nexus or imported manually
 */

const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const JSZip = require("jszip");
const { dialog } = require("electron");

const execFileAsync = promisify(execFile);

const MODS_FOLDER_NAME = "AscendaraMods";
const MANIFEST_FILE_NAME = "mods-manifest.json";
const STAGING_DIR_NAME = ".staging";
const BACKUPS_DIR_NAME = ".backups";

const SUPPORTED_ARCHIVE_EXTS = new Set([".zip", ".7z", ".rar"]);
const LOOSE_MOD_EXTS = new Set([
  ".pak",
  ".dll",
  ".asi",
  ".esp",
  ".esm",
  ".esl",
  ".ba2",
  ".bsa",
  ".ini",
  ".cfg",
  ".lua",
  ".jar",
  ".mod",
]);

// Known game root subfolders that should NOT be stripped when unwrapping an archive
const PRESERVE_ROOT_DIRS = new Set([
  "data",
  "bepinex",
  "mods",
  "plugins",
  "content",
  "binaries",
  "engine",
  "r6",
  "archive",
  "red4ext",
  "bin",
  "x64",
  "scripts",
  "mod_overrides",
  "nativepc",
  "reframework",
  "ue4ss",
  "melonloader",
  "shaderfixes",
  "reshade-shaders",
  "patch",
  "dlcs",
  "saves",
]);

function normalizeRelativeSubpath(subpath) {
  if (!subpath || typeof subpath !== "string") return "";
  const cleaned = subpath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .trim();
  if (!cleaned) return "";
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.some(p => p === "." || p === "..")) {
    throw new Error("Invalid deploy subfolder path");
  }
  return parts.join(path.sep);
}

function isInsideDir(parentDir, targetPath) {
  const resolvedParent = path.resolve(parentDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === resolvedParent) return true;
  const rel = path.relative(resolvedParent, resolvedTarget);
  return Boolean(rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function getPaths(gameDir) {
  const modsDir = path.join(gameDir, MODS_FOLDER_NAME);
  return {
    gameDir,
    modsDir,
    manifestPath: path.join(modsDir, MANIFEST_FILE_NAME),
    stagingRoot: path.join(modsDir, STAGING_DIR_NAME),
    backupsRoot: path.join(modsDir, BACKUPS_DIR_NAME),
  };
}

function ensureProfiles(manifest) {
  const mods = Array.isArray(manifest.mods) ? manifest.mods : [];
  const enabledIds = mods.filter(m => m.enabled).map(m => m.id);
  const orderedIds = [...mods]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(m => m.id);

  let profiles = Array.isArray(manifest.profiles) ? manifest.profiles : [];
  if (!profiles.some(p => p.id === "default")) {
    profiles = [
      {
        id: "default",
        name: "Default",
        enabledIds,
        orderedIds,
        updatedAt: Date.now(),
      },
      ...profiles,
    ];
  }
  const activeProfileId = profiles.some(p => p.id === manifest.activeProfileId)
    ? manifest.activeProfileId
    : "default";

  manifest.profiles = profiles;
  manifest.activeProfileId = activeProfileId;
  return manifest;
}

function syncActiveProfile(manifest) {
  ensureProfiles(manifest);
  const active = manifest.profiles.find(p => p.id === manifest.activeProfileId);
  if (!active) return;
  const sorted = [...manifest.mods].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  active.enabledIds = sorted.filter(m => m.enabled).map(m => m.id);
  active.orderedIds = sorted.map(m => m.id);
  active.updatedAt = Date.now();
}

async function readManifest(manifestPath) {
  try {
    if (await fs.pathExists(manifestPath)) {
      const data = await fs.readJson(manifestPath);
      return ensureProfiles({
        version: 1,
        deploySubpath: typeof data.deploySubpath === "string" ? data.deploySubpath : "",
        mods: Array.isArray(data.mods) ? data.mods : [],
        activeProfileId:
          typeof data.activeProfileId === "string" ? data.activeProfileId : "default",
        profiles: Array.isArray(data.profiles) ? data.profiles : [],
      });
    }
  } catch (err) {
    console.warn("[ModManager] Failed to read manifest, starting fresh:", err.message);
  }
  return ensureProfiles({
    version: 1,
    deploySubpath: "",
    mods: [],
    activeProfileId: "default",
    profiles: [],
  });
}

async function writeManifest(manifestPath, manifest) {
  syncActiveProfile(manifest);
  await fs.ensureDir(path.dirname(manifestPath));
  const tmpPath = `${manifestPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeJson(tmpPath, manifest, { spaces: 2 });
  await fs.rename(tmpPath, manifestPath);
}

/**
 * Recursively list all files inside a directory, returning relative POSIX-normalized paths.
 */
async function listFilesRecursive(rootDir, currentDir = rootDir) {
  const results = [];
  if (!(await fs.pathExists(currentDir))) return results;
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(rootDir, full);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(path.relative(rootDir, full));
    }
  }
  return results;
}

async function getDirectoryStats(dir) {
  const files = await listFilesRecursive(dir);
  let sizeBytes = 0;
  for (const rel of files) {
    try {
      const st = await fs.stat(path.join(dir, rel));
      sizeBytes += st.size;
    } catch {
      // ignore missing file
    }
  }
  return { fileCount: files.length, sizeBytes };
}

/**
 * If an archive extracted into a single wrapper directory (e.g. "MyMod-1.2/...")
 * that isn't a known game root folder (like "Data" or "BepInEx"), unwrap it one level.
 */
async function unwrapSingleFolderIfSafe(stagingDir) {
  const entries = (await fs.readdir(stagingDir, { withFileTypes: true })).filter(
    e => !e.name.startsWith("__MACOSX") && e.name !== ".DS_Store"
  );
  if (entries.length !== 1 || !entries[0].isDirectory()) return;

  const wrapperName = entries[0].name;
  if (PRESERVE_ROOT_DIRS.has(wrapperName.toLowerCase())) return;

  const wrapperPath = path.join(stagingDir, wrapperName);
  const innerEntries = await fs.readdir(wrapperPath);
  for (const name of innerEntries) {
    const src = path.join(wrapperPath, name);
    const dst = path.join(stagingDir, name);
    if (await fs.pathExists(dst)) continue;
    await fs.move(src, dst);
  }
  await fs.remove(wrapperPath);
}

/**
 * Extract a .zip archive safely using JSZip.
 */
async function extractZip(archivePath, destDir) {
  const buffer = await fs.readFile(archivePath);
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);

  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith("__MACOSX/")) continue;
    const targetPath = path.resolve(destDir, entry.name);
    if (!isInsideDir(destDir, targetPath)) {
      throw new Error(`Unsafe archive path detected: ${entry.name}`);
    }
    if (entry.dir) {
      await fs.ensureDir(targetPath);
    } else {
      await fs.ensureDir(path.dirname(targetPath));
      const content = await entry.async("nodebuffer");
      await fs.writeFile(targetPath, content);
    }
  }
}

/**
 * Extract .7z or .rar using system tar (Windows 10/11 libarchive) or 7z.
 */
async function extractExternalArchive(archivePath, destDir) {
  const candidates =
    process.platform === "win32"
      ? [
          { cmd: "tar", args: ["-xf", archivePath, "-C", destDir] },
          { cmd: "7z", args: ["x", "-y", `-o${destDir}`, archivePath] },
          {
            cmd: "C:\\Program Files\\7-Zip\\7z.exe",
            args: ["x", "-y", `-o${destDir}`, archivePath],
          },
        ]
      : [
          { cmd: "7z", args: ["x", "-y", `-o${destDir}`, archivePath] },
          { cmd: "unrar", args: ["x", "-o+", archivePath, `${destDir}/`] },
          { cmd: "tar", args: ["-xf", archivePath, "-C", destDir] },
        ];

  let lastError = null;
  for (const { cmd, args } of candidates) {
    try {
      await execFileAsync(cmd, args, { timeout: 120000 });
      const files = await listFilesRecursive(destDir);
      if (files.length > 0) return;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Could not extract ${path.basename(archivePath)} (${lastError?.message || "install 7-Zip or extract as .zip"})`
  );
}

/**
 * Cleanly remove all previously deployed mod files, restore any backed-up vanilla files,
 * then deploy all currently enabled mods in load order (earlier -> later, later wins).
 */
async function redeployAllMods(gameDir, manifest) {
  const { gameDir: rootDir, stagingRoot, backupsRoot } = getPaths(gameDir);
  const deployRoot = manifest.deploySubpath
    ? path.join(rootDir, normalizeRelativeSubpath(manifest.deploySubpath))
    : rootDir;

  if (!isInsideDir(rootDir, deployRoot)) {
    throw new Error("Deploy target escapes game directory");
  }

  // 1. Collect all files previously deployed by any mod
  const previouslyDeployed = new Set();
  for (const mod of manifest.mods) {
    if (Array.isArray(mod.deployedFiles)) {
      for (const rel of mod.deployedFiles) previouslyDeployed.add(rel);
    }
    mod.deployedFiles = [];
  }

  // 2. Remove previously deployed files and restore vanilla backups if present
  for (const rel of previouslyDeployed) {
    const targetPath = path.resolve(rootDir, rel);
    if (!isInsideDir(rootDir, targetPath)) continue;
    // Never touch AscendaraMods itself
    if (rel.split(/[\\/]/)[0] === MODS_FOLDER_NAME) continue;

    try {
      if (await fs.pathExists(targetPath)) {
        await fs.remove(targetPath);
      }
      const backupPath = path.resolve(backupsRoot, rel);
      if (isInsideDir(backupsRoot, backupPath) && (await fs.pathExists(backupPath))) {
        await fs.ensureDir(path.dirname(targetPath));
        await fs.move(backupPath, targetPath, { overwrite: true });
      }
    } catch (err) {
      console.warn(`[ModManager] Failed to clean/restore ${rel}:`, err.message);
    }
  }

  // 3. Deploy enabled mods in load order
  const sortedMods = [...manifest.mods].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const placedByMod = new Set();

  for (const mod of sortedMods) {
    if (!mod.enabled) continue;
    const stagingDir = path.join(stagingRoot, mod.id);
    if (!(await fs.pathExists(stagingDir))) continue;

    const files = await listFilesRecursive(stagingDir);
    const deployedForThisMod = [];

    for (const relWithinStaging of files) {
      const srcFile = path.join(stagingDir, relWithinStaging);
      const targetFile = path.resolve(deployRoot, relWithinStaging);
      if (!isInsideDir(rootDir, targetFile)) continue;

      const relFromGameRoot = path.relative(rootDir, targetFile);
      if (relFromGameRoot.split(/[\\/]/)[0] === MODS_FOLDER_NAME) continue;

      // If a vanilla file already exists here (and wasn't placed by an earlier mod), back it up
      if (!placedByMod.has(relFromGameRoot) && (await fs.pathExists(targetFile))) {
        const backupPath = path.resolve(backupsRoot, relFromGameRoot);
        if (isInsideDir(backupsRoot, backupPath) && !(await fs.pathExists(backupPath))) {
          await fs.ensureDir(path.dirname(backupPath));
          await fs.copy(targetFile, backupPath);
        }
      }

      await fs.ensureDir(path.dirname(targetFile));
      await fs.copy(srcFile, targetFile, { overwrite: true });
      placedByMod.add(relFromGameRoot);
      deployedForThisMod.push(relFromGameRoot);
    }

    mod.deployedFiles = deployedForThisMod;
  }

  // Re-normalize order numbers
  sortedMods.forEach((mod, idx) => {
    mod.order = idx;
  });
  manifest.mods = sortedMods;
}

/**
 * Scan <gameDir>/AscendaraMods/ for downloaded archives not yet installed in manifest.
 */
async function scanPendingArchives(modsDir, manifest) {
  if (!(await fs.pathExists(modsDir))) return [];
  const installedArchiveNames = new Set(
    manifest.mods.map(m => (m.archiveName || "").toLowerCase()).filter(Boolean)
  );
  const entries = await fs.readdir(modsDir, { withFileTypes: true });
  const pending = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === MANIFEST_FILE_NAME || entry.name.startsWith(".")) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_ARCHIVE_EXTS.has(ext) && !LOOSE_MOD_EXTS.has(ext)) continue;
    if (installedArchiveNames.has(entry.name.toLowerCase())) continue;

    const fullPath = path.join(modsDir, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      pending.push({
        fileName: entry.name,
        path: fullPath,
        sizeBytes: stat.size,
        modifiedAt: stat.mtimeMs,
      });
    } catch {
      // ignore unreadable entry
    }
  }

  pending.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return pending;
}

/**
 * Detect file-level conflicts across all enabled mods (in load order, where later wins).
 */
function computeModConflicts(manifest) {
  const sortedEnabled = [...manifest.mods]
    .filter(m => m.enabled && Array.isArray(m.deployedFiles) && m.deployedFiles.length > 0)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const fileOwners = new Map();
  for (const mod of sortedEnabled) {
    for (const rel of mod.deployedFiles) {
      const key = rel.replace(/\\/g, "/").toLowerCase();
      if (!fileOwners.has(key)) {
        fileOwners.set(key, { displayPath: rel.replace(/\\/g, "/"), owners: [] });
      }
      fileOwners.get(key).owners.push(mod);
    }
  }

  const conflicts = [];
  const winsByMod = new Map();
  const overriddenByMod = new Map();

  for (const { displayPath, owners } of fileOwners.values()) {
    if (owners.length < 2) continue;
    const winner = owners[owners.length - 1];
    const overridden = owners.slice(0, -1);

    winsByMod.set(winner.id, (winsByMod.get(winner.id) || 0) + 1);
    for (const loser of overridden) {
      overriddenByMod.set(loser.id, (overriddenByMod.get(loser.id) || 0) + 1);
    }

    conflicts.push({
      file: displayPath,
      winnerId: winner.id,
      winnerName: winner.name,
      overriddenIds: overridden.map(m => m.id),
      overriddenNames: overridden.map(m => m.name),
    });
  }

  return { conflicts, winsByMod, overriddenByMod };
}

async function listGameMods(gameDir) {
  const { modsDir, manifestPath } = getPaths(gameDir);
  const manifest = await readManifest(manifestPath);
  const pendingArchives = await scanPendingArchives(modsDir, manifest);
  const { conflicts, winsByMod, overriddenByMod } = computeModConflicts(manifest);

  return {
    gameDir,
    modsDir,
    deploySubpath: manifest.deploySubpath || "",
    activeProfileId: manifest.activeProfileId || "default",
    profiles: (manifest.profiles || []).map(p => ({
      id: p.id,
      name: p.name,
      enabledCount: Array.isArray(p.enabledIds) ? p.enabledIds.length : 0,
      updatedAt: p.updatedAt || null,
    })),
    conflicts,
    installedMods: manifest.mods.map(m => ({
      id: m.id,
      name: m.name,
      archiveName: m.archiveName,
      version: m.version || null,
      author: m.author || null,
      nexusModId: m.nexusModId || null,
      nexusDomain: m.nexusDomain || null,
      enabled: Boolean(m.enabled),
      order: m.order ?? 0,
      installedAt: m.installedAt || null,
      fileCount: m.fileCount || 0,
      sizeBytes: m.sizeBytes || 0,
      deployedCount: Array.isArray(m.deployedFiles) ? m.deployedFiles.length : 0,
      winsCount: winsByMod.get(m.id) || 0,
      overriddenCount: overriddenByMod.get(m.id) || 0,
    })),
    pendingArchives,
  };
}

function prettifyModName(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .replace(/[-_]+/g, " ")
    .replace(/\s+\d{4,}.*$/, "")
    .trim() || fileName;
}

async function installModFromArchive(gameDir, archivePath, meta = {}) {
  const { modsDir, manifestPath, stagingRoot } = getPaths(gameDir);
  if (!archivePath || !(await fs.pathExists(archivePath))) {
    throw new Error("Mod archive not found");
  }

  await fs.ensureDir(modsDir);
  await fs.ensureDir(stagingRoot);

  const fileName = path.basename(archivePath);
  const ext = path.extname(fileName).toLowerCase();

  // Copy imported archive into AscendaraMods if it came from outside
  let storedArchivePath = archivePath;
  if (!isInsideDir(modsDir, archivePath)) {
    storedArchivePath = path.join(modsDir, fileName);
    if (!(await fs.pathExists(storedArchivePath))) {
      await fs.copy(archivePath, storedArchivePath);
    }
  }

  const modId = `mod-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const stagingDir = path.join(stagingRoot, modId);
  await fs.ensureDir(stagingDir);

  try {
    if (ext === ".zip") {
      await extractZip(storedArchivePath, stagingDir);
      await unwrapSingleFolderIfSafe(stagingDir);
    } else if (ext === ".7z" || ext === ".rar") {
      await extractExternalArchive(storedArchivePath, stagingDir);
      await unwrapSingleFolderIfSafe(stagingDir);
    } else {
      // Loose single mod file (.pak, .dll, .asi, .esp, etc.)
      await fs.copy(storedArchivePath, path.join(stagingDir, fileName));
    }
  } catch (err) {
    await fs.remove(stagingDir).catch(() => {});
    throw err;
  }

  const { fileCount, sizeBytes } = await getDirectoryStats(stagingDir);
  if (fileCount === 0) {
    await fs.remove(stagingDir).catch(() => {});
    throw new Error("Archive contained no extractable files");
  }

  const manifest = await readManifest(manifestPath);
  const newMod = {
    id: modId,
    name: meta.name || prettifyModName(fileName),
    archiveName: fileName,
    version: meta.version || null,
    author: meta.author || null,
    nexusModId: meta.nexusModId || null,
    nexusDomain: meta.nexusDomain || null,
    enabled: meta.enable !== false,
    order: manifest.mods.length,
    installedAt: Date.now(),
    fileCount,
    sizeBytes,
    deployedFiles: [],
  };

  manifest.mods.push(newMod);
  await redeployAllMods(gameDir, manifest);
  await writeManifest(manifestPath, manifest);

  return listGameMods(gameDir);
}

async function importModArchiveDialog(gameDir, parentWindow) {
  const result = await dialog.showOpenDialog(parentWindow || undefined, {
    title: "Select Mod Archive or File",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Mod Archives & Files",
        extensions: ["zip", "7z", "rar", "pak", "dll", "asi", "esp", "esm", "esl"],
      },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true };
  }

  let state = null;
  const errors = [];
  for (const filePath of result.filePaths) {
    try {
      state = await installModFromArchive(gameDir, filePath, { enable: true });
    } catch (err) {
      errors.push(`${path.basename(filePath)}: ${err.message}`);
    }
  }

  return {
    canceled: false,
    state: state || (await listGameMods(gameDir)),
    errors,
  };
}

async function toggleModEnabled(gameDir, modId, enabled) {
  const { manifestPath } = getPaths(gameDir);
  const manifest = await readManifest(manifestPath);
  const target = manifest.mods.find(m => m.id === modId);
  if (!target) throw new Error("Mod not found");

  target.enabled = Boolean(enabled);
  await redeployAllMods(gameDir, manifest);
  await writeManifest(manifestPath, manifest);
  return listGameMods(gameDir);
}

async function reorderMods(gameDir, orderedIds) {
  const { manifestPath } = getPaths(gameDir);
  const manifest = await readManifest(manifestPath);
  const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]));

  manifest.mods.forEach((mod, idx) => {
    mod.order = orderMap.has(mod.id) ? orderMap.get(mod.id) : orderedIds.length + idx;
  });

  await redeployAllMods(gameDir, manifest);
  await writeManifest(manifestPath, manifest);
  return listGameMods(gameDir);
}

async function setDeploySubpath(gameDir, subpath) {
  const { manifestPath } = getPaths(gameDir);
  const manifest = await readManifest(manifestPath);
  manifest.deploySubpath = normalizeRelativeSubpath(subpath);
  await redeployAllMods(gameDir, manifest);
  await writeManifest(manifestPath, manifest);
  return listGameMods(gameDir);
}

async function uninstallMod(gameDir, modId, deleteArchive = false) {
  const { modsDir, manifestPath, stagingRoot } = getPaths(gameDir);
  const manifest = await readManifest(manifestPath);
  const target = manifest.mods.find(m => m.id === modId);
  if (!target) throw new Error("Mod not found");

  // Disable first & redeploy so vanilla backups are restored properly
  target.enabled = false;
  await redeployAllMods(gameDir, manifest);

  manifest.mods = manifest.mods.filter(m => m.id !== modId);
  manifest.mods.forEach((m, idx) => {
    m.order = idx;
  });

  await fs.remove(path.join(stagingRoot, modId)).catch(() => {});
  if (deleteArchive && target.archiveName) {
    const archivePath = path.resolve(modsDir, target.archiveName);
    if (isInsideDir(modsDir, archivePath)) {
      await fs.remove(archivePath).catch(() => {});
    }
  }

  await writeManifest(manifestPath, manifest);
  return listGameMods(gameDir);
}

async function purgeAllMods(gameDir) {
  const { manifestPath } = getPaths(gameDir);
  const manifest = await readManifest(manifestPath);
  manifest.mods.forEach(m => {
    m.enabled = false;
  });
  await redeployAllMods(gameDir, manifest);
  await writeManifest(manifestPath, manifest);
  return listGameMods(gameDir);
}

async function saveProfile(gameDir, name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new Error("Profile name is required");

  const { manifestPath } = getPaths(gameDir);
  const manifest = await readManifest(manifestPath);

  // Sync current active profile before branching off
  syncActiveProfile(manifest);

  const sorted = [...manifest.mods].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const id = `profile-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;
  manifest.profiles.push({
    id,
    name: trimmed.slice(0, 40),
    enabledIds: sorted.filter(m => m.enabled).map(m => m.id),
    orderedIds: sorted.map(m => m.id),
    updatedAt: Date.now(),
  });
  manifest.activeProfileId = id;

  await writeManifest(manifestPath, manifest);
  return listGameMods(gameDir);
}

async function switchProfile(gameDir, profileId) {
  const { manifestPath } = getPaths(gameDir);
  const manifest = await readManifest(manifestPath);
  const target = manifest.profiles.find(p => p.id === profileId);
  if (!target) throw new Error("Profile not found");

  // Save current profile state before switching away
  syncActiveProfile(manifest);

  const enabledSet = new Set(Array.isArray(target.enabledIds) ? target.enabledIds : []);
  const orderMap = new Map(
    (Array.isArray(target.orderedIds) ? target.orderedIds : []).map((id, idx) => [id, idx])
  );

  manifest.mods.forEach((mod, idx) => {
    mod.enabled = enabledSet.has(mod.id);
    mod.order = orderMap.has(mod.id) ? orderMap.get(mod.id) : manifest.mods.length + idx;
  });

  manifest.activeProfileId = target.id;
  await redeployAllMods(gameDir, manifest);
  await writeManifest(manifestPath, manifest);
  return listGameMods(gameDir);
}

async function deleteProfile(gameDir, profileId) {
  if (!profileId || profileId === "default") {
    throw new Error("Cannot delete the Default profile");
  }
  const { manifestPath } = getPaths(gameDir);
  const manifest = await readManifest(manifestPath);
  const exists = manifest.profiles.some(p => p.id === profileId);
  if (!exists) throw new Error("Profile not found");

  const wasActive = manifest.activeProfileId === profileId;
  manifest.profiles = manifest.profiles.filter(p => p.id !== profileId);

  if (wasActive) {
    manifest.activeProfileId = "default";
    const def = manifest.profiles.find(p => p.id === "default");
    if (def) {
      const enabledSet = new Set(Array.isArray(def.enabledIds) ? def.enabledIds : []);
      const orderMap = new Map(
        (Array.isArray(def.orderedIds) ? def.orderedIds : []).map((id, idx) => [id, idx])
      );
      manifest.mods.forEach((mod, idx) => {
        mod.enabled = enabledSet.has(mod.id);
        mod.order = orderMap.has(mod.id) ? orderMap.get(mod.id) : manifest.mods.length + idx;
      });
      await redeployAllMods(gameDir, manifest);
    }
  }

  await writeManifest(manifestPath, manifest);
  return listGameMods(gameDir);
}

module.exports = {
  listGameMods,
  installModFromArchive,
  importModArchiveDialog,
  toggleModEnabled,
  reorderMods,
  setDeploySubpath,
  uninstallMod,
  purgeAllMods,
  saveProfile,
  switchProfile,
  deleteProfile,
};
