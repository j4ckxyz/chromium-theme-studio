import contrastLib from "get-contrast";
import pc from "picocolors";

type Role = "system" | "user";

type ChatMessage = {
  role: Role;
  content: string;
};

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];
type Tint = [number, number, number];

type ThemeManifest = {
  manifest_version: number;
  name: string;
  version: string;
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

type ContrastLibrary = {
  ratio: (hex1: string, hex2: string) => number;
  score: (hex1: string, hex2: string) => string;
  isAccessible: (hex1: string, hex2: string) => boolean;
};

type ContrastCheck = {
  label: string;
  foreground: string;
  background: string;
  minRatio: number;
  ratio: number;
  score: string;
  pass: boolean;
};

type ModePreference = "light" | "dark" | null;

type ThinkingEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

type ThinkingConfig = {
  effort: ThinkingEffort;
};

type ChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number | null;
  } | null;
};

type StreamThemeResult = {
  rawManifest: string;
  generationId: string | null;
  responseModel: string | null;
  usage: ChatUsage | null;
  requestDurationMs: number;
  timeToThinkingMs: number | null;
  requestedThinking: ThinkingConfig | null;
  usedThinking: ThinkingConfig | null;
  thinkingFallbackUsed: boolean;
};

type GenerationMetadata = {
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

const contrast = contrastLib as unknown as ContrastLibrary;

const SYSTEM_PROMPT = `You are an expert UI colour designer specialising in browser chrome and interface themes.
Given a description, mood, or palette, you output ONLY a valid Chromium theme manifest.json.
No markdown, no explanation, no backticks — raw JSON only.

You must apply professional colour theory principles:

COLOUR HARMONY:
- Choose colours from a coherent palette: analogous, complementary, triadic, or monochromatic
- Active tab should feel clearly distinct from inactive tabs, but remain part of the same family
- The NTP (new tab page) background should feel like a natural extension of the frame

CONTRAST & ACCESSIBILITY:
- Prioritise the requested palette, emotional tone, and vibrancy over strict accessibility targets
- Aim for basic legibility for key text, but allow lower-contrast or slightly clashing combinations when needed to preserve the core vibe
- Do not neutralise, desaturate, or mute a vibrant prompt just to chase strict WCAG thresholds

PERCEPTUAL LIGHTNESS:
- Use HSL thinking: vary lightness by at least 25–40 points between background and text layers
- Avoid pure black (#000000) and pure white (#FFFFFF) — use near-blacks and near-whites instead
  e.g. [15, 15, 20] instead of [0, 0, 0], and [245, 245, 248] instead of [255, 255, 255]
- frame and frame_inactive should differ slightly in lightness (5–15 points) to make the
  inactive state feel visually de-emphasised without being jarring

COLOUR TEMPERATURE:
- Keep the overall colour temperature consistent — don't mix warm and cold tones randomly
- ntp_link should harmonise with the frame colour, not clash with it

TINTS:
- Use tints.buttons to subtly shift button icon colours to match the frame hue
  HSL format: [hue 0–1, saturation 0–1, lightness 0–1], use -1 for "no change"
- Avoid fully neutral tints unless the theme is intentionally monochrome

OUTPUT STRUCTURE — follow exactly:

{
  "manifest_version": 3,
  "name": "<evocative, specific theme name — not generic>",
  "version": "1.0",
  "theme": {
    "colors": {
      "frame":                [R, G, B],
      "frame_inactive":       [R, G, B],
      "toolbar":              [R, G, B],
      "tab_text":             [R, G, B],
      "tab_background_text":  [R, G, B],
      "bookmark_text":        [R, G, B],
      "ntp_background":       [R, G, B],
      "ntp_text":             [R, G, B],
      "ntp_link":             [R, G, B],
      "button_background":    [R, G, B, A]
    },
    "tints": {
      "buttons":        [H, S, L],
      "frame":          [H, S, L],
      "frame_inactive": [H, S, L]
    },
    "properties": {
      "ntp_background_alignment": "bottom",
      "ntp_logo_alternate": 1
    }
  }
}

RULES:
- All RGB values: integers 0–255
- button_background alpha: float 0.0–1.0
- Tint values: floats -1.0 to 1.0
- No images keys
- Raw JSON only — nothing else in your response`;

const FEW_SHOT_EXAMPLES = `Example 1 — Dark theme ("Obsidian Dusk"):
{
  "manifest_version": 3,
  "name": "Obsidian Dusk",
  "version": "1.0",
  "theme": {
    "colors": {
      "frame":               [18, 18, 28],
      "frame_inactive":      [25, 25, 38],
      "toolbar":             [28, 28, 45],
      "tab_text":            [230, 225, 255],
      "tab_background_text": [130, 125, 160],
      "bookmark_text":       [210, 205, 240],
      "ntp_background":      [12, 12, 20],
      "ntp_text":            [220, 215, 248],
      "ntp_link":            [140, 120, 240],
      "button_background":   [255, 255, 255, 0.0]
    },
    "tints": {
      "buttons":        [0.72, 0.3, 0.85],
      "frame":          [-1, -1, -1],
      "frame_inactive": [-1, -1, 0.45]
    },
    "properties": {
      "ntp_background_alignment": "bottom",
      "ntp_logo_alternate": 1
    }
  }
}

Example 2 — Light theme ("Morning Linen"):
{
  "manifest_version": 3,
  "name": "Morning Linen",
  "version": "1.0",
  "theme": {
    "colors": {
      "frame":               [235, 228, 215],
      "frame_inactive":      [225, 218, 205],
      "toolbar":             [245, 240, 230],
      "tab_text":            [40, 32, 20],
      "tab_background_text": [120, 110, 90],
      "bookmark_text":       [55, 45, 30],
      "ntp_background":      [250, 246, 238],
      "ntp_text":            [35, 28, 18],
      "ntp_link":            [140, 90, 30],
      "button_background":   [0, 0, 0, 0.0]
    },
    "tints": {
      "buttons":        [0.1, 0.2, 0.35],
      "frame":          [-1, -1, -1],
      "frame_inactive": [-1, -1, 0.55]
    },
    "properties": {
      "ntp_background_alignment": "bottom",
      "ntp_logo_alternate": 1
    }
  }
}`;

const RETRY_NOTE_PREFIX =
  "IMPORTANT: Your previous attempt failed contrast checks on:";

const THINKING_FLAG_PREFIX = "--thinking=";

const REQUIRED_COLOR_KEYS = [
  "frame",
  "frame_inactive",
  "toolbar",
  "tab_text",
  "tab_background_text",
  "bookmark_text",
  "ntp_background",
  "ntp_text",
  "ntp_link",
  "button_background",
] as const;

const REQUIRED_TINT_KEYS = ["buttons", "frame", "frame_inactive"] as const;

const MAX_RETRIES = 2;

const DEFAULT_THINKING: ThinkingConfig = { effort: "high" };

const THINKING_EFFORTS: ThinkingEffort[] = ["xhigh", "high", "medium", "low", "minimal", "none"];

function usage(): never {
  console.error(pc.red('Usage: bun run generate.ts [--thinking=<level>] "your theme description"'));
  console.error(pc.red("  tip: omit --thinking for non-reasoning mode"));
  console.error(pc.red("  levels: xhigh|high|medium|low|minimal|none|off"));
  process.exit(1);
}

function parseThinkingValue(raw: string | undefined): ThinkingConfig | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "" || value === "true" || value === "on" || value === "auto") {
    return { ...DEFAULT_THINKING };
  }

  if (value === "off" || value === "false") {
    return null;
  }

  if (value === "none") {
    return { effort: "none" };
  }

  if (THINKING_EFFORTS.includes(value as ThinkingEffort)) {
    return { effort: value as ThinkingEffort };
  }

  throw new Error(`Invalid thinking level: ${raw}`);
}

function parseCliOptions(argv: string[]): { prompt: string; thinking: ThinkingConfig | null } {
  const promptParts: string[] = [];
  let thinking: ThinkingConfig | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg.startsWith(THINKING_FLAG_PREFIX)) {
      thinking = parseThinkingValue(arg.slice(THINKING_FLAG_PREFIX.length));
      continue;
    }

    if (arg === "--thinking") {
      const next = argv[i + 1];
      if (typeof next === "string" && !next.startsWith("--")) {
        thinking = parseThinkingValue(next);
        i += 1;
      } else {
        thinking = { ...DEFAULT_THINKING };
      }
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    promptParts.push(arg);
  }

  return { prompt: promptParts.join(" ").trim(), thinking };
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "theme"
  );
}

function isIntegerInRange(v: unknown, min: number, max: number): v is number {
  return Number.isInteger(v) && typeof v === "number" && v >= min && v <= max;
}

function isNumberInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

function swatch(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\u001b[48;2;${r};${g};${b}m    \u001b[0m`;
}

function formatMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) {
    return "n/a";
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  return `${(ms / 1000).toFixed(2)}s`;
}

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }

  if (value === 0) {
    return "$0.00";
  }

  return `$${value.toFixed(value < 0.01 ? 6 : 4)}`;
}

function shouldFallbackToNonReasoning(status: number, body: string): boolean {
  if (status === 401 || status === 402 || status === 403) {
    return false;
  }

  const lower = body.toLowerCase();
  if (
    lower.includes("reasoning") ||
    lower.includes("thinking") ||
    lower.includes("unsupported") ||
    lower.includes("unknown field") ||
    lower.includes("invalid parameter") ||
    lower.includes("not support")
  ) {
    return true;
  }

  return status === 400 || status === 422;
}

function extractReasoningChunk(reasoningDetail: unknown): string {
  if (typeof reasoningDetail === "string") {
    return reasoningDetail;
  }

  if (typeof reasoningDetail !== "object" || reasoningDetail === null) {
    return "";
  }

  const detail = reasoningDetail as { text?: unknown; summary?: unknown };
  if (typeof detail.text === "string") {
    return detail.text;
  }

  if (typeof detail.summary === "string") {
    return detail.summary;
  }

  return "";
}

function validateManifest(data: unknown): string[] {
  const errors: string[] = [];
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return ["Root must be a JSON object"];
  }

  const manifest = data as Record<string, unknown>;

  if (manifest.manifest_version !== 3) {
    errors.push("manifest_version must be exactly 3");
  }

  if (typeof manifest.name !== "string" || manifest.name.trim() === "") {
    errors.push("name must be a non-empty string");
  }

  if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
    errors.push("version must be a non-empty string");
  }

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
    const colorsObj = colors as Record<string, unknown>;

    for (const key of REQUIRED_COLOR_KEYS) {
      if (!(key in colorsObj)) {
        errors.push(`theme.colors.${key} is missing`);
      }
    }

    for (const key of REQUIRED_COLOR_KEYS) {
      const value = colorsObj[key];
      if (key === "button_background") {
        if (!Array.isArray(value) || value.length !== 4) {
          errors.push("theme.colors.button_background must be [R, G, B, A]");
          continue;
        }
        const [r, g, b, a] = value;
        if (!isIntegerInRange(r, 0, 255)) {
          errors.push("theme.colors.button_background[0] must be integer 0-255");
        }
        if (!isIntegerInRange(g, 0, 255)) {
          errors.push("theme.colors.button_background[1] must be integer 0-255");
        }
        if (!isIntegerInRange(b, 0, 255)) {
          errors.push("theme.colors.button_background[2] must be integer 0-255");
        }
        if (!isNumberInRange(a, 0, 1)) {
          errors.push("theme.colors.button_background[3] must be float 0.0-1.0");
        }
      } else {
        if (!Array.isArray(value) || value.length !== 3) {
          errors.push(`theme.colors.${key} must be [R, G, B]`);
          continue;
        }
        const [r, g, b] = value;
        if (!isIntegerInRange(r, 0, 255)) {
          errors.push(`theme.colors.${key}[0] must be integer 0-255`);
        }
        if (!isIntegerInRange(g, 0, 255)) {
          errors.push(`theme.colors.${key}[1] must be integer 0-255`);
        }
        if (!isIntegerInRange(b, 0, 255)) {
          errors.push(`theme.colors.${key}[2] must be integer 0-255`);
        }
      }
    }
  }

  if (typeof tints !== "object" || tints === null || Array.isArray(tints)) {
    errors.push("theme.tints must be an object");
  } else {
    const tintsObj = tints as Record<string, unknown>;

    for (const key of REQUIRED_TINT_KEYS) {
      if (!(key in tintsObj)) {
        errors.push(`theme.tints.${key} is missing`);
      }
    }

    for (const key of REQUIRED_TINT_KEYS) {
      const value = tintsObj[key];
      if (!Array.isArray(value) || value.length !== 3) {
        errors.push(`theme.tints.${key} must be [H, S, L]`);
        continue;
      }

      for (let i = 0; i < 3; i += 1) {
        if (!isNumberInRange(value[i], -1, 1)) {
          errors.push(`theme.tints.${key}[${i}] must be float -1.0 to 1.0`);
        }
      }
    }
  }

  return errors;
}

function detectModePreference(input: string): ModePreference {
  const source = input.toLowerCase();
  const wantsLight =
    /\blight\s+mode\b/.test(source) ||
    /\blight\s+theme\b/.test(source) ||
    /\bmode\s*[:=]\s*light\b/.test(source);
  const wantsDark =
    /\bdark\s+mode\b/.test(source) ||
    /\bdark\s+theme\b/.test(source) ||
    /\bmode\s*[:=]\s*dark\b/.test(source);

  if (wantsLight && !wantsDark) {
    return "light";
  }

  if (wantsDark && !wantsLight) {
    return "dark";
  }

  return null;
}

function applyModeNaming(name: string, mode: ModePreference): string {
  const baseName = name.trim().replace(/\s*-[ld]\s*$/i, "").trim() || "Theme";

  if (mode === "light") {
    return `${baseName}-l`;
  }

  if (mode === "dark") {
    return `${baseName}-d`;
  }

  return baseName;
}

function buildModeInstruction(mode: ModePreference): string {
  if (mode === "light") {
    return "Naming rule: The user explicitly requested light mode. The `name` field must end with -l.";
  }

  if (mode === "dark") {
    return "Naming rule: The user explicitly requested dark mode. The `name` field must end with -d.";
  }

  return "Naming rule: The user did not explicitly request light or dark mode. Choose light/dark direction based on the prompt vibe, and do not add -l or -d suffixes to the `name` field.";
}

function buildUserMessage(input: string, failedPairs: string[], mode: ModePreference): string {
  const parts = [FEW_SHOT_EXAMPLES, `Theme request: ${input}`, buildModeInstruction(mode)];
  if (failedPairs.length > 0) {
    parts.push(
      `${RETRY_NOTE_PREFIX} ${failedPairs.join(", ")}.
Please adjust the colours to fix these — prioritise accessibility.`,
    );
  }
  return parts.join("\n\n");
}

function runContrastChecks(manifest: ThemeManifest): ContrastCheck[] {
  const colors = manifest.theme.colors;

  const pairs = [
    {
      label: "Tab text on toolbar",
      foreground: rgbToHex(colors.tab_text),
      background: rgbToHex(colors.toolbar),
      minRatio: 2.5,
    },
    {
      label: "Inactive tab text on frame",
      foreground: rgbToHex(colors.tab_background_text),
      background: rgbToHex(colors.frame),
      minRatio: 2.0,
    },
    {
      label: "Bookmark text on toolbar",
      foreground: rgbToHex(colors.bookmark_text),
      background: rgbToHex(colors.toolbar),
      minRatio: 2.5,
    },
    {
      label: "NTP text on background",
      foreground: rgbToHex(colors.ntp_text),
      background: rgbToHex(colors.ntp_background),
      minRatio: 2.5,
    },
    {
      label: "NTP link on background",
      foreground: rgbToHex(colors.ntp_link),
      background: rgbToHex(colors.ntp_background),
      minRatio: 2.0,
    },
  ] as const;

  return pairs.map((pair) => {
    const ratio = Number(contrast.ratio(pair.foreground, pair.background));
    const score = String(contrast.score(pair.foreground, pair.background));
    const pass = ratio >= pair.minRatio;

    return {
      label: pair.label,
      foreground: pair.foreground,
      background: pair.background,
      minRatio: pair.minRatio,
      ratio,
      score,
      pass,
    };
  });
}

function printContrastTable(checks: ContrastCheck[]): void {
  console.log(pc.cyan("Contrast checks:"));
  for (const check of checks) {
    const icon = check.pass ? pc.green("✅") : pc.red("❌");
    const score = check.pass ? pc.green(check.score) : pc.red(check.score);
    console.log(`${icon} | ${check.label} | ${check.ratio.toFixed(1)}:1 | ${score}`);
  }
}

function printColorSummary(manifest: ThemeManifest): void {
  const c = manifest.theme.colors;
  const rows = [
    ["frame", rgbToHex(c.frame)],
    ["frame_inactive", rgbToHex(c.frame_inactive)],
    ["toolbar", rgbToHex(c.toolbar)],
    ["tab_text", rgbToHex(c.tab_text)],
    ["tab_background_text", rgbToHex(c.tab_background_text)],
    ["bookmark_text", rgbToHex(c.bookmark_text)],
    ["ntp_background", rgbToHex(c.ntp_background)],
    ["ntp_text", rgbToHex(c.ntp_text)],
    ["ntp_link", rgbToHex(c.ntp_link)],
    [
      "button_background",
      `${rgbToHex([
        c.button_background[0],
        c.button_background[1],
        c.button_background[2],
      ])} (a=${c.button_background[3]})`,
    ],
  ] as const;

  console.log(pc.cyan("Color summary:"));
  for (const [role, value] of rows) {
    const hex = value.startsWith("#") ? value.slice(0, 7) : "#000000";
    console.log(`  ${swatch(hex)}  ${value}  ${role}`);
  }
}

async function fetchGenerationMetadata(
  apiKey: string,
  generationId: string | null,
): Promise<GenerationMetadata | null> {
  if (!generationId) {
    return null;
  }

  const url = new URL("https://openrouter.ai/api/v1/generation");
  url.searchParams.set("id", generationId);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        if ((response.status === 404 || response.status === 429) && attempt < 11) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        return null;
      }

      const json = (await response.json()) as {
        data?: {
          id?: unknown;
          model?: unknown;
          provider_name?: unknown;
          total_cost?: unknown;
          usage?: unknown;
          tokens_prompt?: unknown;
          tokens_completion?: unknown;
          native_tokens_reasoning?: unknown;
          generation_time?: unknown;
          latency?: unknown;
        };
      };

      const data = json.data;
      if (!data || typeof data !== "object") {
        return null;
      }

      return {
        id: typeof data.id === "string" ? data.id : generationId,
        model: typeof data.model === "string" ? data.model : "unknown",
        provider_name: typeof data.provider_name === "string" ? data.provider_name : null,
        total_cost: typeof data.total_cost === "number" ? data.total_cost : 0,
        usage: typeof data.usage === "number" ? data.usage : 0,
        tokens_prompt: typeof data.tokens_prompt === "number" ? data.tokens_prompt : null,
        tokens_completion: typeof data.tokens_completion === "number" ? data.tokens_completion : null,
        native_tokens_reasoning:
          typeof data.native_tokens_reasoning === "number" ? data.native_tokens_reasoning : null,
        generation_time: typeof data.generation_time === "number" ? data.generation_time : null,
        latency: typeof data.latency === "number" ? data.latency : null,
      };
    } catch {
      if (attempt < 11) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      return null;
    }
  }

  return null;
}

function printRequestSummary(stream: StreamThemeResult, generation: GenerationMetadata | null): void {
  const promptTokens =
    generation?.tokens_prompt ?? (typeof stream.usage?.prompt_tokens === "number" ? stream.usage.prompt_tokens : null);
  const completionTokens =
    generation?.tokens_completion ??
    (typeof stream.usage?.completion_tokens === "number" ? stream.usage.completion_tokens : null);
  const totalTokens =
    typeof stream.usage?.total_tokens === "number"
      ? stream.usage.total_tokens
      : promptTokens !== null && completionTokens !== null
        ? promptTokens + completionTokens
        : null;
  const reasoningTokens =
    generation?.native_tokens_reasoning ??
    (typeof stream.usage?.completion_tokens_details?.reasoning_tokens === "number"
      ? stream.usage.completion_tokens_details.reasoning_tokens
      : null);
  const modelUsed = generation?.model ?? stream.responseModel ?? process.env.OPENROUTER_MODEL ?? "unknown";

  const thinking = stream.usedThinking
    ? stream.usedThinking.effort
    : stream.requestedThinking
      ? "off (fallback)"
      : "off";

  console.log(pc.cyan("Request summary:"));
  console.log(
    `  model=${modelUsed}${generation?.provider_name ? `  provider=${generation.provider_name}` : ""}  thinking=${thinking}`,
  );
  console.log(
    `  time=${formatMs(stream.requestDurationMs)}  first_thought=${formatMs(stream.timeToThinkingMs)}  provider_latency=${formatMs(generation?.latency ?? null)}${stream.thinkingFallbackUsed ? "  fallback=yes" : ""}`,
  );
  console.log(
    `  tokens p/c/r/t=${promptTokens ?? "n/a"}/${completionTokens ?? "n/a"}/${reasoningTokens ?? "n/a"}/${totalTokens ?? "n/a"}`,
  );
  console.log(
    `  cost=${formatUsd(generation?.total_cost ?? generation?.usage ?? null)}  generation_id=${stream.generationId ?? "n/a"}`,
  );
}

async function streamThemeManifest(
  messages: ChatMessage[],
  configuredThinking: ThinkingConfig | null,
): Promise<StreamThemeResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY in environment");
  }

  if (!model) {
    throw new Error("Missing OPENROUTER_MODEL in environment");
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "theme-gen",
    "X-Title": "theme-gen",
  };

  const runStream = async (thinking: ThinkingConfig | null): Promise<StreamThemeResult> => {
    const startedAt = performance.now();
    const requestBody: Record<string, unknown> = {
      model,
      stream: true,
      messages,
    };
    if (thinking) {
      requestBody.reasoning = { effort: thinking.effort };
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter request failed (${response.status}): ${body}`);
    }

    if (!response.body) {
      throw new Error("OpenRouter response body is empty");
    }

    const generationId = response.headers.get("x-generation-id");
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    let contentBuffer = "";
    let usage: ChatUsage | null = null;
    let responseModel: string | null = null;
    let timeToThinkingMs: number | null = null;

    const processSseLine = (rawLine: string): boolean => {
      const line = rawLine.trim();
      if (!line || line.startsWith(":")) {
        return false;
      }

      if (!line.startsWith("data:")) {
        return false;
      }

      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        return true;
      }

      if (!payload) {
        return false;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return false;
      }

      if (parsed?.usage && typeof parsed.usage === "object") {
        usage = parsed.usage as ChatUsage;
      }

      if (typeof parsed?.model === "string") {
        responseModel = parsed.model;
      }

      const delta = parsed?.choices?.[0]?.delta;
      const reasoningDetails = delta?.reasoning_details;
      const content = delta?.content;

      const printChunk = (chunk: string) => {
        if (!chunk) {
          return;
        }

        if (timeToThinkingMs === null) {
          timeToThinkingMs = performance.now() - startedAt;
        }

        process.stdout.write(pc.dim(`🤔 ${chunk}\n`));
      };

      if (Array.isArray(reasoningDetails)) {
        for (const detail of reasoningDetails) {
          printChunk(extractReasoningChunk(detail));
        }
      } else {
        printChunk(extractReasoningChunk(reasoningDetails));
      }

      if (typeof content === "string") {
        contentBuffer += content;
      }

      return false;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        if (processSseLine(rawLine)) {
          return {
            rawManifest: contentBuffer,
            generationId,
            responseModel,
            usage,
            requestDurationMs: performance.now() - startedAt,
            timeToThinkingMs,
            requestedThinking: thinking,
            usedThinking: thinking,
            thinkingFallbackUsed: false,
          };
        }
      }
    }

    if (buffer.length > 0) {
      processSseLine(buffer);
    }

    return {
      rawManifest: contentBuffer,
      generationId,
      responseModel,
      usage,
      requestDurationMs: performance.now() - startedAt,
      timeToThinkingMs,
      requestedThinking: thinking,
      usedThinking: thinking,
      thinkingFallbackUsed: false,
    };
  };

  const requestedThinking = configuredThinking;

  try {
    const result = await runStream(requestedThinking);
    return { ...result, requestedThinking, usedThinking: requestedThinking, thinkingFallbackUsed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/^OpenRouter request failed \((\d+)\):\s*(.*)$/s);
    if (requestedThinking && match) {
      const status = Number(match[1]);
      const body = match[2] ?? "";
      if (shouldFallbackToNonReasoning(status, body)) {
        console.log(pc.yellow("Reasoning mode not supported for this model/request. Retrying without reasoning."));
        const fallbackResult = await runStream(null);
        return {
          ...fallbackResult,
          requestedThinking,
          usedThinking: null,
          thinkingFallbackUsed: true,
        };
      }
    }

    throw error;
  }
}

async function main(): Promise<void> {
  let input = "";
  let cliThinking: ThinkingConfig | null = null;
  try {
    const parsed = parseCliOptions(Bun.argv.slice(2));
    input = parsed.prompt;
    cliThinking = parsed.thinking;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(pc.red(message));
    usage();
  }

  if (!input) {
    usage();
  }

  const configuredThinking = cliThinking;
  const apiKey = process.env.OPENROUTER_API_KEY;

  const modePreference = detectModePreference(input);

  let retryFailedPairs: string[] = [];
  let bestResult:
    | {
        manifest: ThemeManifest;
        checks: ContrastCheck[];
        stream: StreamThemeResult;
      }
    | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      console.log(pc.yellow(`Retrying generation (${attempt}/${MAX_RETRIES})...`));
    }

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: buildUserMessage(input, retryFailedPairs, modePreference),
      },
    ];

    let streamResult: StreamThemeResult;
    try {
      streamResult = await streamThemeManifest(messages, configuredThinking);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(pc.red(`Streaming failed: ${message}`));
      process.exit(1);
    }

    const rawManifest = streamResult.rawManifest;

    let parsedManifest: unknown;
    try {
      parsedManifest = JSON.parse(rawManifest);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(pc.red(`Failed to parse generated JSON: ${message}`));
      console.error(pc.red("Raw output:"));
      console.error(rawManifest);
      process.exit(1);
    }

    const validationErrors = validateManifest(parsedManifest);
    if (validationErrors.length > 0) {
      console.error(pc.red("Validation failed:"));
      for (const err of validationErrors) {
        console.error(pc.red(`- ${err}`));
      }
      process.exit(1);
    }

    const manifest = parsedManifest as ThemeManifest;
    manifest.name = applyModeNaming(manifest.name, modePreference);
    const checks = runContrastChecks(manifest);
    const failedChecks = checks.filter((check) => !check.pass);

    printContrastTable(checks);

    if (!bestResult || failedChecks.length < bestResult.checks.filter((c) => !c.pass).length) {
      bestResult = { manifest, checks, stream: streamResult };
    }

    if (failedChecks.length <= 2) {
      break;
    }

    if (attempt < MAX_RETRIES) {
      retryFailedPairs = failedChecks.map((check) => check.label);
      console.log(
        pc.yellow(
          `More than 2 contrast checks failed (${failedChecks.length}). Requesting an accessibility-focused retry.`,
        ),
      );
    }
  }

  if (!bestResult) {
    console.error(pc.red("No valid theme manifest was produced."));
    process.exit(1);
  }

  const manifest = bestResult.manifest;
  const bestStream = bestResult.stream;
  const failedChecks = bestResult.checks.filter((check) => !check.pass);
  const folderName = slugify(manifest.name);
  const outputDir = `${process.cwd()}/${folderName}`;
  await Bun.$`mkdir -p ${outputDir}`;

  const manifestPath = `${outputDir}/manifest.json`;
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(pc.green("Theme manifest generated and validated successfully."));
  console.log(pc.bold(pc.cyan(`Written: ${manifestPath}`)));
  console.log(
    `Key colours: frame=${rgbToHex(manifest.theme.colors.frame)}, toolbar=${rgbToHex(
      manifest.theme.colors.toolbar,
    )}, ntp_background=${rgbToHex(manifest.theme.colors.ntp_background)}`,
  );

  if (failedChecks.length > 0) {
    const labels = failedChecks.map((check) => check.label).join(", ");
    if (failedChecks.length > 2) {
      console.log(
        pc.red(
          `Warning: theme written after ${MAX_RETRIES} retries with remaining contrast failures: ${labels}`,
        ),
      );
    } else {
      console.log(
        pc.red(`Warning: theme written, but some contrast checks failed and legibility may be impacted: ${labels}`),
      );
    }
  }

  printColorSummary(manifest);

  const generation = await fetchGenerationMetadata(apiKey ?? "", bestStream.generationId);
  printRequestSummary(bestStream, generation);
}

await main();
