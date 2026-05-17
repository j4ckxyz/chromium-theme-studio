import { 
  type Rgb, type InternalPalette, type PaletteSeed, type ThemeManifest, type ContrastCheck,
  rgbToHsl, hslToRgb, rgbToHex
} from "./manifest.js";
import contrastLib from "get-contrast";

export type PaletteMode = "balanced" | "vibrant" | "muted" | "monochrome";

export function generatePalette(seed: PaletteSeed): InternalPalette {
  const [bh, bs, bl] = rgbToHsl(...seed.base_color);
  const [ah, as, al] = rgbToHsl(...seed.accent_color);
  const mode = seed.mode;

  // Gradient Simulation logic
  // Frame (base_dark)
  const base_dark = seed.base_color;
  
  // Inactive Frame (base_mid) - slight hue drift (5-12°) and lightness shift
  // In balanced/muted modes, ensure we preserve the subtle saturation to avoid pure grey
  const drift = mode === "monochrome" ? 0 : 7;
  const targetSat = (mode === "balanced" || mode === "muted") ? Math.max(bs, 4) : bs;
  const base_mid = hslToRgb(bh + drift, targetSat, Math.min(100, bl + 5));
  
  // Toolbar (surface_tint_1) - further drift and lighter
  const surface_tint_1 = hslToRgb(bh + drift * 2, Math.max(0, targetSat - 2), Math.min(100, bl + 10));
  
  // Tab Surface (base_light) - if dark theme, much lighter; if light theme, much darker
  const isDark = bl < 50;
  const base_light = isDark 
    ? hslToRgb(bh, Math.max(0, targetSat - 5), Math.min(100, bl + 80))
    : hslToRgb(bh, Math.max(0, targetSat - 5), Math.max(0, bl - 80));

  // Accents
  const accent_primary = seed.accent_color;
  
  // Secondary Accent - shifted hue (complementary or triadic)
  const secondaryShift = mode === "monochrome" ? 0 : mode === "vibrant" ? 180 : 30;
  const accent_secondary = hslToRgb(ah + secondaryShift, as, al);
  
  // Environmental tints
  const accent_warm = hslToRgb(30, Math.min(100, as + 10), Math.max(al, 60));
  const accent_cool = hslToRgb(210, Math.min(100, as + 10), Math.max(al, 60));
  
  const surface_tint_2 = hslToRgb(bh + drift * 3, bs, Math.min(100, bl + 15));

  return {
    base_dark,
    base_mid,
    base_light,
    accent_primary,
    accent_secondary,
    accent_warm,
    accent_cool,
    surface_tint_1,
    surface_tint_2,
  };
}

export function mapPaletteToManifest(name: string, palette: InternalPalette): ThemeManifest {
  const isDark = rgbToHsl(...palette.base_dark)[2] < 50;
  
  return {
    manifest_version: 3,
    name: name || "Generated Theme",
    version: "1.0",
    theme: {
      colors: {
        frame: palette.base_dark,
        frame_inactive: palette.base_mid,
        toolbar: palette.surface_tint_1,
        tab_text: palette.base_light,
        tab_background_text: palette.base_mid,
        bookmark_text: palette.base_light,
        ntp_background: palette.base_dark,
        ntp_text: palette.base_light,
        ntp_link: palette.accent_primary,
        button_background: [255, 255, 255, 0.0],
      },
      tints: {
        buttons: [-1, -1, -1],
        frame: [-1, -1, -1],
        frame_inactive: [-1, -1, -1],
      },
      properties: {
        ntp_background_alignment: "bottom",
        ntp_logo_alternate: 1,
      },
    },
  };
}

export function rebalancePalette(palette: InternalPalette): InternalPalette {
  const p = { ...palette };
  
  const ensureContrast = (fg: Rgb, bg: Rgb, target: number): Rgb => {
    const fHex = rgbToHex(fg);
    const bHex = rgbToHex(bg);
    let ratio = Number(contrastLib.ratio(fHex, bHex));
    if (ratio >= target) return fg;
    
    // Adjust lightness of FG
    const [h, s, l] = rgbToHsl(...fg);
    const [bh, bs, bl] = rgbToHsl(...bg);
    
    let newL = l;
    if (bl < 50) {
      // Background is dark, make FG lighter
      newL = Math.min(100, l + 20);
      while (Number(contrastLib.ratio(rgbToHex(hslToRgb(h, s, newL)), bHex)) < target && newL < 100) {
        newL += 5;
      }
    } else {
      // Background is light, make FG darker
      newL = Math.max(0, l - 20);
      while (Number(contrastLib.ratio(rgbToHex(hslToRgb(h, s, newL)), bHex)) < target && newL > 0) {
        newL -= 5;
      }
    }
    return hslToRgb(h, s, newL);
  };

  // Check key pairs
  p.base_light = ensureContrast(p.base_light, p.surface_tint_1, 4.5); // tab_text on toolbar
  p.accent_primary = ensureContrast(p.accent_primary, p.base_dark, 3.0); // ntp_link on ntp_background (base_dark)
  
  // Also ensure base_light has contrast on base_dark (ntp_text on ntp_background)
  p.base_light = ensureContrast(p.base_light, p.base_dark, 4.5);
  
  // Ensure inactive tab text has contrast on frame (base_dark)
  p.base_mid = ensureContrast(p.base_mid, p.base_dark, 2.0);
  
  return p;
}

export function computeMaterialScore(palette: InternalPalette): {
  diversity: number;
  luminanceRange: number;
  contrast: number;
  total: number;
} {
  const hues = [
    rgbToHsl(...palette.base_dark)[0],
    rgbToHsl(...palette.accent_primary)[0],
    rgbToHsl(...palette.accent_secondary)[0],
  ];
  
  // Diversity: distance between hues
  const d1 = Math.abs(hues[0] - hues[1]);
  const d2 = Math.abs(hues[1] - hues[2]);
  const diversity = Math.min(1, (Math.max(d1, d2) > 30 ? 1 : 0.5));

  // Luminance range: diff between darkest and lightest
  const lDark = rgbToHsl(...palette.base_dark)[2];
  const lLight = rgbToHsl(...palette.base_light)[2];
  const luminanceRange = Math.min(1, Math.abs(lDark - lLight) / 60);

  // Contrast: sample check
  const contrastRatio = Number(contrastLib.ratio(rgbToHex(palette.base_light), rgbToHex(palette.surface_tint_1)));
  const contrast = contrastRatio >= 4.5 ? 1 : contrastRatio / 4.5;

  return {
    diversity,
    luminanceRange,
    contrast,
    total: (diversity + luminanceRange + contrast) / 3,
  };
}
