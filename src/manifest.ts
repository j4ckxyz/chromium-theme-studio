export type Rgb = [number, number, number];
import path from "node:path";
export type Rgba = [number, number, number, number];
export type Tint = [number, number, number];

export type ThemeManifest = {
  manifest_version: number;
  name: string;
  version: string;
  icons?: Record<string, string>;
  theme: {
    colors: {
      frame: Rgb;
      frame_inactive: Rgb;
      toolbar: Rgb;
      tab_text: Rgb;
      tab_background_text: Rgb;
      bookmark_text: Rgb;
      ntp_background: Rgb;
      ntp_text: Rgb;
      ntp_link: Rgb;
      button_background: Rgba;
    };
    tints: {
      buttons: Tint;
      frame: Tint;
      frame_inactive: Tint;
    };
    properties: {
      ntp_background_alignment: string;
      ntp_logo_alternate: number;
    };
  };
};

export type FirefoxThemeManifest = {
  manifest_version: number;
  name: string;
  version: string;
  theme: {
    colors: Record<string, unknown>;
    images: Record<string, unknown>;
    properties: Record<string, unknown>;
  };
};

export type ContrastCheck = {
  label: string;
  foreground: string;
  background: string;
  minRatio: number;
  ratio: number;
  score: string;
  pass: boolean;
};

export type ModePreference = "light" | "dark" | null;

export type ChatMessage = {
  role: "system" | "user";
  content: string | ChatContentPart[];
};

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type StreamThemeResult = {
  rawManifest: string;
  generationId: string | null;
  responseModel: string | null;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number | null } | null;
  } | null;
  requestDurationMs: number;
  timeToThinkingMs: number | null;
  requestedThinking: { effort: string } | null;
  usedThinking: { effort: string } | null;
  thinkingFallbackUsed: boolean;
  imageFallbackUsed: boolean;
};

export type GenerationMetadata = {
  id: string;
  model: string;
  provider_name: string | null;
  total_cost: number;
  usage: number;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  native_tokens_reasoning: number | null;
  generation_time: number | null;
  latency: number | null;
};

export type ImageReferenceOutcome = {
  requestedCount: number;
  status: "not requested" | "requested" | "prepared" | "used" | "fallback" | "ignored";
  detail: string;
};

export type ScreenshotArtifacts = {
  newTab: string;
  tabsLoaded: string;
  toolbar: string;
};

export type ThemeProcessingResult = {
  manifest: ThemeManifest;
  failedChecks: ContrastCheck[];
  stream: StreamThemeResult | null;
  outputDir: string;
  manifestPath: string;
  webStoreZipPath: string;
  iconPath: string | null;
  descriptionPath: string | null;
  metadataPath: string | null;
  screenshots: ScreenshotArtifacts | null;
  imageReference: ImageReferenceOutcome;
  fromExisting: boolean;
  firefoxManifestPath: string | null;
  command: string;
};

export function isIntegerInRange(v: unknown, min: number, max: number): v is number {
  return Number.isInteger(v) && typeof v === "number" && v >= min && v <= max;
}

export function isNumberInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

const REQUIRED_COLOR_KEYS = [
  "frame", "frame_inactive", "toolbar", "tab_text",
  "tab_background_text", "bookmark_text", "ntp_background",
  "ntp_text", "ntp_link", "button_background",
] as const;

const REQUIRED_TINT_KEYS = ["buttons", "frame", "frame_inactive"] as const;

export function validateManifest(data: unknown): string[] {
  const errors: string[] = [];
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return ["Root must be a JSON object"];
  }
  const manifest = data as Record<string, unknown>;
  if (manifest.manifest_version !== 3) errors.push("manifest_version must be exactly 3");
  if (typeof manifest.name !== "string" || !manifest.name.trim()) errors.push("name must be non-empty string");
  if (typeof manifest.version !== "string" || !manifest.version.trim()) errors.push("version must be non-empty string");

  const theme = manifest.theme;
  if (typeof theme !== "object" || theme === null || Array.isArray(theme)) {
    errors.push("theme must be an object");
    return errors;
  }
  const themeObj = theme as Record<string, unknown>;
  const colors = themeObj.colors;
  const tints = themeObj.tints;

  if (typeof colors !== "object" || colors === null || Array.isArray(colors)) {
    errors.push("theme.colors must be an object");
  } else {
    const c = colors as Record<string, unknown>;
    for (const key of REQUIRED_COLOR_KEYS) {
      if (!(key in c)) errors.push(`theme.colors.${key} is missing`);
    }
    for (const key of REQUIRED_COLOR_KEYS) {
      const value = c[key];
      if (key === "button_background") {
        if (!Array.isArray(value) || value.length !== 4) {
          errors.push("theme.colors.button_background must be [R, G, B, A]");
          continue;
        }
        const [r, g, b, a] = value;
        if (!isIntegerInRange(r, 0, 255)) errors.push("button_background[0] must be 0-255");
        if (!isIntegerInRange(g, 0, 255)) errors.push("button_background[1] must be 0-255");
        if (!isIntegerInRange(b, 0, 255)) errors.push("button_background[2] must be 0-255");
        if (!isNumberInRange(a, 0, 1)) errors.push("button_background[3] must be 0.0-1.0");
      } else {
        if (!Array.isArray(value) || value.length !== 3) {
          errors.push(`theme.colors.${key} must be [R, G, B]`);
          continue;
        }
        const [r, g, b] = value;
        if (!isIntegerInRange(r, 0, 255)) errors.push(`theme.colors.${key}[0] must be 0-255`);
        if (!isIntegerInRange(g, 0, 255)) errors.push(`theme.colors.${key}[1] must be 0-255`);
        if (!isIntegerInRange(b, 0, 255)) errors.push(`theme.colors.${key}[2] must be 0-255`);
      }
    }
  }

  if (typeof tints !== "object" || tints === null || Array.isArray(tints)) {
    errors.push("theme.tints must be an object");
  } else {
    const t = tints as Record<string, unknown>;
    for (const key of REQUIRED_TINT_KEYS) {
      if (!(key in t)) errors.push(`theme.tints.${key} is missing`);
    }
    for (const key of REQUIRED_TINT_KEYS) {
      const value = t[key];
      if (!Array.isArray(value) || value.length !== 3) {
        errors.push(`theme.tints.${key} must be [H, S, L]`);
        continue;
      }
      for (let i = 0; i < 3; i++) {
        if (!isNumberInRange(value[i], -1, 1)) errors.push(`theme.tints.${key}[${i}] must be -1.0 to 1.0`);
      }
    }
  }

  return errors;
}

export function validateFirefoxManifest(data: unknown): string[] {
  const errors: string[] = [];
  if (typeof data !== "object" || data === null || Array.isArray(data)) return ["Root must be a JSON object"];
  const manifest = data as Record<string, unknown>;
  if (manifest.manifest_version !== 2) errors.push("manifest_version must be exactly 2");
  if (typeof manifest.name !== "string" || !manifest.name.trim()) errors.push("name must be non-empty string");
  if (typeof manifest.version !== "string" || !manifest.version.trim()) errors.push("version must be non-empty string");
  const theme = manifest.theme;
  if (typeof theme !== "object" || theme === null || Array.isArray(theme)) {
    errors.push("theme must be an object");
    return errors;
  }
  const t = theme as Record<string, unknown>;
  if (typeof t.colors !== "object" || t.colors === null || Array.isArray(t.colors)) errors.push("theme.colors must be object");
  if (typeof t.images !== "object" || t.images === null || Array.isArray(t.images)) errors.push("theme.images must be object");
  if (typeof t.properties !== "object" || t.properties === null || Array.isArray(t.properties)) errors.push("theme.properties must be object");
  return errors;
}

export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

export function swatch(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\u001b[48;2;${r};${g};${b}m    \u001b[0m`;
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "theme";
}

export function normalizeGeneratedName(name: string): string {
  return name.trim().replace(/\s*-[ld]\s*$/i, "").trim() || "Theme";
}

export function detectModePreference(input: string): ModePreference {
  const source = input.toLowerCase();
  const wantsLight = /\blight\s+mode\b/.test(source) || /\blight\s+theme\b/.test(source) || /\bmode\s*[:=]\s*light\b/.test(source);
  const wantsDark = /\bdark\s+mode\b/.test(source) || /\bdark\s+theme\b/.test(source) || /\bmode\s*[:=]\s*dark\b/.test(source);
  if (wantsLight && !wantsDark) return "light";
  if (wantsDark && !wantsLight) return "dark";
  return null;
}

export function relativePathFromCwd(targetPath: string): string {
  const rel = path.relative(process.cwd(), targetPath);
  return rel && !rel.startsWith("..") ? rel : targetPath;
}

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export type ExplicitColors = {
  frame?: string;
  frame_inactive?: string;
  toolbar?: string;
  tab_text?: string;
  tab_background_text?: string;
  bookmark_text?: string;
  ntp_background?: string;
  ntp_text?: string;
  ntp_link?: string;
  button_background?: string;
  buttons?: string;
  tint_frame?: string;
  tint_frame_inactive?: string;
};

/**
 * Parse a hex string to [R, G, B]. Accepts "#rrggbb" or "rrggbb" or "rgb(r,g,b)"
 */
export function parseColor(value: string): [number, number, number] | null {
  const stripped = value.replace("#", "").trim();
  if (/^[0-9a-fA-F]{6}$/.test(stripped)) {
    return hexToRgb(stripped);
  }
  const rgbMatch = stripped.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
  }
  return null;
}

/**
 * Parse a tint string "h,s,l" where each value is -1.0 to 1.0
 */
export function parseTint(value: string): [number, number, number] | null {
  const parts = value.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some((v) => isNaN(v) || v < -1 || v > 1)) {
    return null;
  }
  return parts as [number, number, number];
}


/**
 * Build a complete ThemeManifest from explicit color values.
 * Colors not provided are auto-derived from provided ones.
 */
export function buildManifestFromColors(
  name: string,
  colors: ExplicitColors
): ThemeManifest {
  const hex = (v: string) => {
    const rgb = parseColor(v);
    if (!rgb) throw new Error(`Invalid color: ${v}`);
    return rgb;
  };

  // Frame must always be provided
  const frame = hex(colors.frame ?? "#1a1218");
  const frameHex = rgbToHex(frame);

  // Auto-derive inactive frame (slightly lighter)
  const frame_inactive = colors.frame_inactive
    ? hex(colors.frame_inactive)
    : ([Math.min(255, frame[0] + 10), Math.min(255, frame[1] + 10), Math.min(255, frame[2] + 15)] as [number, number, number]);

  // Toolbar defaults to frame color
  const toolbar = colors.toolbar ? hex(colors.toolbar) : [...frame];


  // Auto-generate text colors based on frame luminance
  const luminance = (rgb: [number, number, number]) =>
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const isDark = luminance(frame) < 128;

  const tab_text = colors.tab_text
    ? hex(colors.tab_text)
    : isDark
      ? ([235, 230, 250] as [number, number, number])
      : ([20, 15, 35] as [number, number, number]);


  const tab_background_text = colors.tab_background_text
    ? hex(colors.tab_background_text)
    : isDark
      ? ([130, 120, 170] as [number, number, number])
      : ([100, 95, 80] as [number, number, number]);

  const bookmark_text = colors.bookmark_text
    ? hex(colors.bookmark_text)
    : isDark
      ? ([210, 205, 240] as [number, number, number])
      : ([50, 40, 25] as [number, number, number]);


  // NTP background defaults to darker version of frame
  const ntp_background = colors.ntp_background
    ? hex(colors.ntp_background)
    : isDark
      ? ([Math.max(0, frame[0] - 8), Math.max(0, frame[1] - 8), Math.max(0, frame[2] - 8)] as [number, number, number])
      : ([Math.min(255, frame[0] + 15), Math.min(255, frame[1] + 15), Math.min(255, frame[2] + 15)] as [number, number, number]);


  const ntp_text = colors.ntp_text
    ? hex(colors.ntp_text)
    : tab_text;

  const ntp_link = colors.ntp_link
    ? hex(colors.ntp_link)
    : isDark
      ? ([100, 160, 230] as [number, number, number])
      : ([30, 80, 180] as [number, number, number]);

  const button_background = colors.button_background
    ? [...hex(colors.button_background), 0.0] as [number, number, number, number]
    : (isDark ? ([255, 255, 255, 0.0] as [number, number, number, number]) : ([0, 0, 0, 0.0] as [number, number, number, number]));


  // Tints: buttons from frame hue, frame inactive from luminance, rest neutral
  const buttons = colors.buttons
    ? parseTint(colors.buttons) ?? ([-1, -1, -1] as [number, number, number])
    : ([-1, -1, -1] as [number, number, number]);
  const tint_frame = colors.tint_frame
    ? parseTint(colors.tint_frame) ?? ([-1, -1, -1] as [number, number, number])
    : ([-1, -1, -1] as [number, number, number]);
  const tint_frame_inactive = colors.tint_frame_inactive
    ? parseTint(colors.tint_frame_inactive) ?? ([-1, -1, 0.5] as [number, number, number])
    : ([-1, -1, 0.5] as [number, number, number]);

  return {
    manifest_version: 3,
    name: name.trim() || "Custom Theme",
    version: "1.0",
    theme: {
      colors: {
        frame,
        frame_inactive,
        toolbar,
        tab_text,
        tab_background_text,
        bookmark_text,
        ntp_background,
        ntp_text,
        ntp_link,
        button_background,
      },
      tints: {
        buttons,
        frame: tint_frame,
        frame_inactive: tint_frame_inactive,
      },
      properties: {
        ntp_background_alignment: "bottom",
        ntp_logo_alternate: 1,
      },
    },
  };
}
