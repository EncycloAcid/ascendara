const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const geometrySource = fs.readFileSync(
  path.join(root, "src/lib/navigationGeometry.js"),
  "utf8"
);
const layoutSource = fs.readFileSync(
  path.join(root, "src/components/Layout.jsx"),
  "utf8"
);
const navigationSource = fs.readFileSync(
  path.join(root, "src/components/Navigation.jsx"),
  "utf8"
);
const settingsSource = fs.readFileSync(
  path.join(root, "src/pages/Settings.jsx"),
  "utf8"
);

let moduleInstance = 0;
async function loadGeometry() {
  const url = `data:text/javascript;base64,${Buffer.from(geometrySource).toString("base64")}#${moduleInstance++}`;
  return import(url);
}

test("Settings keeps a bounded scrollport with room at the bottom", async () => {
  const geometry = await loadGeometry();

  assert.ok(geometry.NAVIGATION_SETTINGS_SAFE_AREA_PX > 0);
  assert.equal(
    geometry.getNavigationBottomSafeArea("/settings"),
    geometry.NAVIGATION_SETTINGS_SAFE_AREA_PX
  );
});

test("navigation rail is wider than the tiles stacked inside it", async () => {
  const geometry = await loadGeometry();

  assert.ok(geometry.NAVIGATION_RAIL_TILE_PX > 0);
  assert.ok(
    geometry.NAVIGATION_RAIL_WIDTH_PX > geometry.NAVIGATION_RAIL_TILE_PX,
    "Tiles need side padding inside the rail"
  );
});

test("other pages keep their full scrollport height", async () => {
  const { getNavigationBottomSafeArea } = await loadGeometry();

  for (const pathname of ["/", "/search", "/library", "/downloads", "/ascend"]) {
    assert.equal(getNavigationBottomSafeArea(pathname, true), 0, pathname);
  }
});

test("Layout reserves a persistent Settings viewport exclusion zone", () => {
  assert.match(
    layoutSource,
    /getNavigationBottomSafeArea\(location\.pathname\)/
  );
  assert.match(layoutSource, /const hasNavigationBottomSafeArea = navigationBottomSafeArea > 0/);
  assert.match(
    layoutSource,
    /hasNavigationBottomSafeArea \? "h-screen overflow-hidden" : "min-h-screen"/
  );
  assert.match(layoutSource, /data-route-scroll-container/);
  assert.match(layoutSource, /style=\{PAGE_CONTENT_TOP_OFFSET_STYLE\}/);
  assert.match(layoutSource, /hasNavigationBottomSafeArea \? "min-h-0" : ""/);
  assert.match(layoutSource, /paddingBottom: navigationBottomSafeArea \|\| undefined/);
  assert.match(layoutSource, /scrollPaddingBottom: navigationBottomSafeArea \|\| undefined/);

  // The bounded scrollport runs to the window edge; the safe-area value is its
  // bottom padding, so the last content rests clear of it.
  const mainIndex = layoutSource.indexOf("data-route-scroll-container");
  const navIndex = layoutSource.indexOf("<Navigation", mainIndex);
  const mainBlock = layoutSource.slice(mainIndex, navIndex);
  assert.match(mainBlock, /overflow-y-auto/);
  assert.match(mainBlock, /paddingBottom: navigationBottomSafeArea/);

  for (const token of ["NAVIGATION_RAIL_WIDTH_PX", "NAVIGATION_RAIL_TILE_PX"]) {
    assert.match(navigationSource, new RegExp(token));
  }

  // Content starts to the right of the rail, and pages pinned to the window
  // read the same width from a CSS variable
  assert.match(layoutSource, /NAVIGATION_RAIL_WIDTH_PX/);
  assert.match(layoutSource, /"--app-rail-width"/);
});

test("Settings treats the bounded route scrollport as its scroll authority", () => {
  assert.match(
    settingsSource,
    /settingsRootRef\.current\?\.closest\("\[data-route-scroll-container\]"\)/
  );
  assert.match(settingsSource, /scrollContainer\.scrollTo\(\{ top: 0, behavior \}\)/);
  assert.match(settingsSource, /scrollContainer\.scrollTop/);
  assert.match(settingsSource, /scrollContainer\.scrollHeight - scrollContainer\.clientHeight/);
  assert.match(settingsSource, /scrollContainer\.addEventListener\("scrollend", onArrive\)/);
  assert.match(settingsSource, /scrollToElement\(element, scrollContainer\)/);
  // The header is pinned to the top of the route scrollport and the sidebar
  // is pinned just below it, so only the settings content scrolls.
  assert.match(settingsSource, /sticky top-0 z-20/);
  assert.match(settingsSource, /lg:sticky lg:top-\[var\(--settings-aside-top\)\]/);

  assert.doesNotMatch(settingsSource, /window\.scrollTo\(/);
  assert.doesNotMatch(settingsSource, /window\.scrollY/);
  assert.doesNotMatch(settingsSource, /document\.documentElement\.scrollHeight/);
  assert.doesNotMatch(settingsSource, /window\.addEventListener\("scrollend"/);
});
