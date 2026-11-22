// The navigation rail is pinned to the left edge of the window, full height.
export const NAVIGATION_RAIL_WIDTH_PX = 80;
// Square page buttons and game covers stacked inside the rail
export const NAVIGATION_RAIL_TILE_PX = 52;

// Settings uses a bounded route scrollport so its header and sidebar can stay
// pinned while only the content scrolls. Nothing covers the bottom edge any
// more, so this is just enough room for the last section to come to rest.
export const NAVIGATION_SETTINGS_SAFE_AREA_PX = 32;

export function getNavigationBottomSafeArea(pathname) {
  return pathname === "/settings" ? NAVIGATION_SETTINGS_SAFE_AREA_PX : 0;
}
