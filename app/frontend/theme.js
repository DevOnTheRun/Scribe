import Lego from "./lego.js";

export const THEME_STORAGE_KEY = "scribe-theme";

export const DEFAULT_PRIMARY = "#6e0a50";
export const DEFAULT_SECONDARY = "#fcff3d";
export const DEFAULT_MODE = "dark";

const PALETTES = {
  dark: { theme: "#12161c", contrast: "#f0eee8" },
  light: { theme: "#f5f3ee", contrast: "#1a1d24" },
};

/** @type {{ primary: string, secondary: string, mode: "dark" | "light" }} */
let current = {
  primary: DEFAULT_PRIMARY,
  secondary: DEFAULT_SECONDARY,
  mode: "dark",
};

function normalizeHex(value, fallback) {
  const hex = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  return fallback;
}

function readStoredTheme() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    const mode =
      stored.mode === "light" || stored.mode === "dark"
        ? stored.mode
        : stored.darkMode === false
          ? "light"
          : "dark";
    return {
      primary: normalizeHex(stored.primary, DEFAULT_PRIMARY),
      secondary: normalizeHex(stored.secondary, DEFAULT_SECONDARY),
      mode,
    };
  } catch {
    return null;
  }
}

export function getPreferredTheme() {
  return (
    readStoredTheme() || {
      primary: DEFAULT_PRIMARY,
      secondary: DEFAULT_SECONDARY,
      mode: window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark",
    }
  );
}

export function getThemeSettings() {
  return { ...current };
}

export function applyTheme(partial = {}, { reapply = false } = {}) {
  current = {
    primary: normalizeHex(partial.primary ?? current.primary, DEFAULT_PRIMARY),
    secondary: normalizeHex(partial.secondary ?? current.secondary, DEFAULT_SECONDARY),
    mode: partial.mode === "light" || partial.mode === "dark" ? partial.mode : current.mode,
  };
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
  const palette = PALETTES[current.mode] ?? PALETTES.dark;
  // Hollow buttons: Lego defaults to primary; override to secondary when styles inject.
  const hollowSecondary = {
    ".lego-style-bttnhollow": {
      border: "1px solid rgba(var(--lego-color-secondary-rgb), var(--lego-bord-a, 1))",
      "background-color": "transparent",
      color: "rgba(var(--lego-color-secondary-rgb), var(--lego-text-a, 1))",
    },
  };
  Lego.load(current.primary, current.secondary, current.mode === "dark", hollowSecondary, reapply, {
    themeColour: palette.theme,
    contrastColour: palette.contrast,
  });
}

applyTheme(getPreferredTheme());
