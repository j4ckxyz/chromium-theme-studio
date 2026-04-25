import contrastLib from "get-contrast";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import { PNG } from "pngjs";

type Role = "system" | "user";

type ChatMessage = {
  role: Role;
  content: string | ChatContentPart[];
};

type ChatContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    };

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];
type Tint = [number, number, number];

type ThemeManifest = {
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

type FirefoxThemeManifest = {
  manifest_version: number;
  name: string;
  version: string;
  theme: {
    colors: Record<string, unknown>;
    images: Record<string, unknown>;
    properties: Record<string, unknown>;
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

type CliOptions = {
  prompt: string;
  thinking: ThinkingConfig | null;
  nameOverride: string | null;
  imageSources: string[];
  variations: number;
  previewSheet: boolean;
  screenshots: boolean;
  webStore: boolean;
  fromPath: string | null;
  help: boolean;
};

type PreparedReferenceImage = {
  source: string;
  url: string;
  format: string;
};

type ImageReferenceOutcome = {
  requestedCount: number;
  status: "not requested" | "requested" | "prepared" | "used" | "fallback" | "ignored";
  detail: string;
};

type ScreenshotArtifacts = {
  newTab: string;
  tabsLoaded: string;
  toolbar: string;
};

type ThemeProcessingResult = {
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
  imageFallbackUsed: boolean;
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

const FIREFOX_SYSTEM_PROMPT = `You are an expert UI colour designer specialising in browser themes.
You receive a Chromium theme manifest and map its colours to a Firefox WebExtension static theme manifest.
Output ONLY valid JSON. No markdown, no explanation, no backticks — raw JSON only.

Valid Firefox theme.colors keys (from MDN):
- accentcolor (deprecated alias for frame)
- bookmark_text
- button_background_active
- button_background_hover
- frame
- frame_inactive
- icons
- icons_attention
- ntp_background
- ntp_text
- popup
- popup_border
- popup_highlight
- popup_highlight_text
- popup_text
- sidebar
- sidebar_border
- sidebar_highlight
- sidebar_highlight_text
- sidebar_text
- tab_background_separator
- tab_background_text
- tab_line
- tab_loading
- tab_selected
- tab_text
- tabbrowser_toolbar_top_separator
- toolbar
- toolbar_bottom_separator
- toolbar_field
- toolbar_field_border
- toolbar_field_border_focus
- toolbar_field_focus
- toolbar_field_highlight
- toolbar_field_highlight_text
- toolbar_field_text
- toolbar_field_text_focus
- toolbar_text
- toolbar_top_separator
- toolbar_vertical_separator

Rules:
- Use RGB arrays [R, G, B] with integers 0-255 for all colour values.
- Map the Chromium colours to the closest semantic Firefox equivalents.
- Preserve the theme name from the input manifest.
- Preserve the theme's mood, contrast ratios, and palette harmony.
- Include all keys that have a sensible mapping; omit keys only when there is no reasonable equivalent.
- Leave "images" as an empty object and "properties" as an empty object.

Output structure — follow exactly:
{
  "manifest_version": 2,
  "name": "<theme name>",
  "version": "1.0",
  "theme": {
    "colors": { ... },
    "images": {},
    "properties": {}
  }
}`;

const RETRY_NOTE_PREFIX =
  "IMPORTANT: Your previous attempt failed contrast checks on:";

const THINKING_FLAG_PREFIX = "--thinking=";
const NAME_FLAG_PREFIX = "--name=";
const FROM_FLAG_PREFIX = "--from=";
const IMAGE_FLAG_PREFIX = "--image=";
const VARIATIONS_FLAG_PREFIX = "--variations=";

const MAX_VARIATIONS = 12;

const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const PREVIEW_MAX_PROMPT_LENGTH = 80;

const EXTENSION_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
};

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/avif": ".avif",
};

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

function usage(exitCode = 1): never {
  const printer = exitCode === 0 ? console.log : console.error;
  printer('Usage: bun run generate.ts [options] "your theme description"');
  printer('       bun run generate.ts --from <manifest-or-theme-folder> [options]');
  printer("");
  printer("Options:");
  printer("  -h, --help              Show this help message");
  printer("  -n, --name <name>       Set an explicit theme/package name");
  printer("  -i, --image <path/url>  Add image reference for palette inspiration");
  printer("  -v, --variations <n>    Generate multiple theme variations (1-12)");
  printer("      --preview-sheet     Generate HTML preview for variation runs");
  printer("      --screenshots       Capture listing screenshots (requires Chromium)");
  printer("  -w, --web-store         Generate CWS-ready icon and listing drafts");
  printer("  -f, --from <path>       Re-process an existing theme manifest/folder");
  printer("      --name=<name>       Same as --name");
  printer("      --image=<path/url>  Same as --image (repeatable)");
  printer("      --variations=<n>    Same as --variations");
  printer("      --from=<path>       Same as --from");
  printer("      --thinking=<level>  Enable model reasoning effort");
  printer("      --thinking [level]  Same as --thinking=<level>");
  printer("");
  printer("Thinking levels: xhigh|high|medium|low|minimal|none|off");
  printer("Tip: omit --thinking (or use --thinking=off) for non-reasoning mode");
  process.exit(exitCode);
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

function parseVariationsValue(raw: string | undefined): number {
  const value = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isInteger(value) || value < 1 || value > MAX_VARIATIONS) {
    throw new Error(`--variations must be an integer between 1 and ${MAX_VARIATIONS}`);
  }
  return value;
}

function parseCliOptions(argv: string[]): CliOptions {
  const promptParts: string[] = [];
  let thinking: ThinkingConfig | null = null;
  let nameOverride: string | null = null;
  const imageSources: string[] = [];
  let variations = 1;
  let previewSheet = false;
  let screenshots = false;
  let webStore = false;
  let fromPath: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      return {
        prompt: "",
        thinking,
        nameOverride,
        imageSources,
        variations,
        previewSheet,
        screenshots,
        webStore,
        fromPath,
        help: true,
      };
    }

    if (arg === "--preview-sheet") {
      previewSheet = true;
      continue;
    }

    if (arg === "--screenshots") {
      screenshots = true;
      continue;
    }

    if (arg.startsWith(VARIATIONS_FLAG_PREFIX)) {
      variations = parseVariationsValue(arg.slice(VARIATIONS_FLAG_PREFIX.length));
      continue;
    }

    if (arg === "--variations" || arg === "-v") {
      const next = argv[i + 1];
      if (typeof next !== "string" || next.startsWith("-")) {
        throw new Error("--variations requires a value");
      }
      variations = parseVariationsValue(next);
      i += 1;
      continue;
    }

    if (arg === "-w" || arg === "--web-store") {
      webStore = true;
      continue;
    }

    if (arg.startsWith(IMAGE_FLAG_PREFIX)) {
      const value = arg.slice(IMAGE_FLAG_PREFIX.length).trim();
      if (!value) {
        throw new Error("--image requires a value");
      }
      imageSources.push(value);
      continue;
    }

    if (arg === "--image" || arg === "-i") {
      const next = argv[i + 1];
      if (typeof next !== "string" || next.startsWith("-")) {
        throw new Error("--image requires a value");
      }
      imageSources.push(next.trim());
      i += 1;
      continue;
    }

    if (arg.startsWith(FROM_FLAG_PREFIX)) {
      const value = arg.slice(FROM_FLAG_PREFIX.length).trim();
      if (!value) {
        throw new Error("--from requires a value");
      }
      fromPath = value;
      continue;
    }

    if (arg === "--from" || arg === "-f") {
      const next = argv[i + 1];
      if (typeof next !== "string" || next.startsWith("-")) {
        throw new Error("--from requires a value");
      }
      fromPath = next.trim();
      if (!fromPath) {
        throw new Error("--from requires a non-empty value");
      }
      i += 1;
      continue;
    }

    if (arg.startsWith(NAME_FLAG_PREFIX)) {
      const value = arg.slice(NAME_FLAG_PREFIX.length).trim();
      if (!value) {
        throw new Error("--name requires a non-empty value");
      }
      nameOverride = value;
      continue;
    }

    if (arg === "--name" || arg === "-n") {
      const next = argv[i + 1];
      if (typeof next !== "string" || next.startsWith("-")) {
        throw new Error("--name requires a value");
      }
      nameOverride = next.trim();
      if (!nameOverride) {
        throw new Error("--name requires a non-empty value");
      }
      i += 1;
      continue;
    }

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

    if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    promptParts.push(arg);
  }

  return {
    prompt: promptParts.join(" ").trim(),
    thinking,
    nameOverride,
    imageSources,
    variations,
    previewSheet,
    screenshots,
    webStore,
    fromPath,
    help: false,
  };
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

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function detectMimeTypeFromPath(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? null;
}

function extensionFromMime(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] ?? ".bin";
}

function normalizeMimeType(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  return raw.split(";")[0]?.trim().toLowerCase() ?? null;
}

async function convertImageToPng(inputPath: string, outputPath: string): Promise<void> {
  const ffmpegProc = Bun.spawn(["ffmpeg", "-y", "-i", inputPath, "-frames:v", "1", outputPath], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const ffmpegExitCode = await ffmpegProc.exited;
  if (ffmpegExitCode === 0) {
    return;
  }

  const ffmpegError = (await new Response(ffmpegProc.stderr).text()).trim();

  const sipsProc = Bun.spawn(["sips", "-s", "format", "png", inputPath, "--out", outputPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const sipsExitCode = await sipsProc.exited;
  if (sipsExitCode !== 0) {
    const sipsError = (await new Response(sipsProc.stderr).text()).trim();
    throw new Error(
      `Failed to convert image (${inputPath}). ffmpeg: ${ffmpegError || `exit code ${ffmpegExitCode}`}; sips: ${sipsError || `exit code ${sipsExitCode}`}`,
    );
  }
}

async function fileToDataUrl(filePath: string, mimeType: string): Promise<string> {
  const bytes = await Bun.file(filePath).arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

async function downloadImageToTemp(sourceUrl: string, tempDir: string): Promise<{ filePath: string; mimeType: string | null }> {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image URL (${response.status}): ${sourceUrl}`);
  }

  const mimeType = normalizeMimeType(response.headers.get("content-type"));
  const urlPath = new URL(sourceUrl).pathname;
  const extFromUrl = path.extname(urlPath).toLowerCase();
  const fallbackExt = extFromUrl || extensionFromMime(mimeType ?? "application/octet-stream");
  const filePath = path.join(tempDir, `ref-${randomUUID()}${fallbackExt}`);
  const data = new Uint8Array(await response.arrayBuffer());
  await Bun.write(filePath, data);
  return { filePath, mimeType };
}

async function prepareReferenceImages(sources: string[]): Promise<PreparedReferenceImage[]> {
  const images: PreparedReferenceImage[] = [];
  const tempDir = path.join(os.tmpdir(), "chromium-theme-studio");
  await fs.mkdir(tempDir, { recursive: true });

  for (const source of sources) {
    if (isHttpUrl(source)) {
      const directMime = detectMimeTypeFromPath(new URL(source).pathname);
      if (directMime && SUPPORTED_IMAGE_MIME_TYPES.has(directMime)) {
        images.push({
          source,
          url: source,
          format: directMime,
        });
        continue;
      }

      const downloaded = await downloadImageToTemp(source, tempDir);
      try {
        const downloadedMime = downloaded.mimeType ?? detectMimeTypeFromPath(downloaded.filePath);

        if (downloadedMime && SUPPORTED_IMAGE_MIME_TYPES.has(downloadedMime)) {
          images.push({
            source,
            url: await fileToDataUrl(downloaded.filePath, downloadedMime),
            format: downloadedMime,
          });
          continue;
        }

        const convertedPath = path.join(tempDir, `ref-${randomUUID()}.png`);
        await convertImageToPng(downloaded.filePath, convertedPath);
        try {
          images.push({
            source,
            url: await fileToDataUrl(convertedPath, "image/png"),
            format: "image/png",
          });
        } finally {
          await fs.rm(convertedPath, { force: true });
        }
      } finally {
        await fs.rm(downloaded.filePath, { force: true });
      }
      continue;
    }

    const resolvedLocalPath = path.resolve(process.cwd(), source);
    try {
      await fs.access(resolvedLocalPath);
    } catch {
      throw new Error(`Image path not found: ${source}`);
    }

    const stats = await fs.stat(resolvedLocalPath);
    if (!stats.isFile()) {
      throw new Error(`Image path must be a file: ${source}`);
    }

    const localMime = detectMimeTypeFromPath(resolvedLocalPath);
    if (localMime && SUPPORTED_IMAGE_MIME_TYPES.has(localMime)) {
      images.push({
        source,
        url: await fileToDataUrl(resolvedLocalPath, localMime),
        format: localMime,
      });
      continue;
    }

    const convertedPath = path.join(tempDir, `ref-${randomUUID()}.png`);
    await convertImageToPng(resolvedLocalPath, convertedPath);
    try {
      images.push({
        source,
        url: await fileToDataUrl(convertedPath, "image/png"),
        format: "image/png",
      });
    } finally {
      await fs.rm(convertedPath, { force: true });
    }
  }

  return images;
}

function modelSupportsImageInputsFromMetadata(metadata: unknown): boolean | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const record = metadata as {
    architecture?: { input_modalities?: unknown };
    input_modalities?: unknown;
    modalities?: unknown;
  };

  const candidates = [record.architecture?.input_modalities, record.input_modalities, record.modalities];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const normalized = candidate
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.toLowerCase());
      if (normalized.some((v) => v.includes("image"))) {
        return true;
      }
      if (normalized.length > 0) {
        return false;
      }
    }
  }

  return null;
}

async function modelSupportsImageInputs(model: string | undefined): Promise<boolean | null> {
  if (!model) {
    return null;
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { data?: Array<Record<string, unknown>> };
    const allModels = Array.isArray(payload.data) ? payload.data : [];
    const target = allModels.find((item) => {
      const id = typeof item.id === "string" ? item.id : "";
      const slug = typeof item.slug === "string" ? item.slug : "";
      return id === model || slug === model;
    });

    return modelSupportsImageInputsFromMetadata(target ?? null);
  } catch {
    return null;
  }
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

function validateFirefoxManifest(data: unknown): string[] {
  const errors: string[] = [];
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return ["Root must be a JSON object"];
  }

  const manifest = data as Record<string, unknown>;

  if (manifest.manifest_version !== 2) {
    errors.push("manifest_version must be exactly 2");
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

  if (typeof themeObj.colors !== "object" || themeObj.colors === null || Array.isArray(themeObj.colors)) {
    errors.push("theme.colors must be an object");
  }

  if (typeof themeObj.images !== "object" || themeObj.images === null || Array.isArray(themeObj.images)) {
    errors.push("theme.images must be an object");
  }

  if (typeof themeObj.properties !== "object" || themeObj.properties === null || Array.isArray(themeObj.properties)) {
    errors.push("theme.properties must be an object");
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

function normalizeGeneratedName(name: string): string {
  return name.trim().replace(/\s*-[ld]\s*$/i, "").trim() || "Theme";
}

function buildModeInstruction(mode: ModePreference): string {
  if (mode === "light") {
    return "Mode preference: The user explicitly requested a light theme. Keep the overall palette and luminance clearly light.";
  }

  if (mode === "dark") {
    return "Mode preference: The user explicitly requested a dark theme. Keep the overall palette and luminance clearly dark.";
  }

  return "Mode preference: No explicit light/dark mode was requested. Choose the direction that best matches the prompt vibe.";
}

function buildUserMessage(
  input: string,
  failedPairs: string[],
  mode: ModePreference,
  references: PreparedReferenceImage[],
): string {
  const parts = [FEW_SHOT_EXAMPLES, `Theme request: ${input}`, buildModeInstruction(mode)];
  if (references.length > 0) {
    parts.push(
      `Reference images attached (${references.length}). Use them for colour inspiration and palette extraction aligned with the user's request.`,
    );
  }
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

function relativePathFromCwd(targetPath: string): string {
  const rel = path.relative(process.cwd(), targetPath);
  return rel && !rel.startsWith("..") ? rel : targetPath;
}

function rgbDistance(a: Rgb, b: Rgb): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function rgbToHsl(rgb: Rgb): [number, number, number] {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) {
    return [0, 0, l];
  }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;

  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }

  return [h, s, l];
}

function relativeLuminance(rgb: Rgb): number {
  const normalize = (channel: number) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };

  const r = normalize(rgb[0]);
  const g = normalize(rgb[1]);
  const b = normalize(rgb[2]);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function inferThemeMode(manifest: ThemeManifest): "light" | "dark" {
  const c = manifest.theme.colors;
  const average = (relativeLuminance(c.frame) + relativeLuminance(c.toolbar) + relativeLuminance(c.ntp_background)) / 3;
  return average >= 0.4 ? "light" : "dark";
}

function selectGradientPair(manifest: ThemeManifest): { start: Rgb; end: Rgb; startRole: string; endRole: string } {
  const c = manifest.theme.colors;
  const candidates: Array<{ role: string; rgb: Rgb }> = [
    { role: "frame", rgb: c.frame },
    { role: "frame_inactive", rgb: c.frame_inactive },
    { role: "toolbar", rgb: c.toolbar },
    { role: "bookmark_text", rgb: c.bookmark_text },
    { role: "ntp_background", rgb: c.ntp_background },
    { role: "ntp_link", rgb: c.ntp_link },
    { role: "tab_text", rgb: c.tab_text },
  ];

  let bestPair: { start: Rgb; end: Rgb; startRole: string; endRole: string; score: number } | null = null;

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      const distance = rgbDistance(a.rgb, b.rgb);
      const [, satA, lightA] = rgbToHsl(a.rgb);
      const [, satB, lightB] = rgbToHsl(b.rgb);
      const saturationBoost = ((satA + satB) / 2) * 140;
      const lightnessSpread = Math.abs(lightA - lightB) * 80;
      const accentBoost = a.role === "ntp_link" || b.role === "ntp_link" ? 30 : 0;
      const frameBoost = a.role === "frame" || b.role === "frame" ? 12 : 0;
      const score = distance * 0.65 + saturationBoost + lightnessSpread + accentBoost + frameBoost;

      if (!bestPair || score > bestPair.score) {
        bestPair = {
          start: a.rgb,
          end: b.rgb,
          startRole: a.role,
          endRole: b.role,
          score,
        };
      }
    }
  }

  if (!bestPair) {
    return {
      start: c.frame,
      end: c.ntp_link,
      startRole: "frame",
      endRole: "ntp_link",
    };
  }

  return {
    start: bestPair.start,
    end: bestPair.end,
    startRole: bestPair.startRole,
    endRole: bestPair.endRole,
  };
}

async function writeGradientIcon(iconPath: string, start: Rgb, end: Rgb, size = 128): Promise<void> {
  const png = new PNG({ width: size, height: size });
  const denominator = Math.max(1, (size - 1) * 2);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = (x + y) / denominator;
      const r = Math.round(start[0] + (end[0] - start[0]) * t);
      const g = Math.round(start[1] + (end[1] - start[1]) * t);
      const b = Math.round(start[2] + (end[2] - start[2]) * t);
      const idx = (size * y + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }

  await Bun.write(iconPath, PNG.sync.write(png));
}

function normalizeAssetPathForZip(assetPath: string): string | null {
  const normalized = assetPath.replace(/\\/g, "/").trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("..")) {
    return null;
  }
  return normalized;
}

function collectPackageAssets(manifest: ThemeManifest): string[] {
  const files = new Set<string>(["manifest.json"]);
  if (manifest.icons && typeof manifest.icons === "object") {
    for (const value of Object.values(manifest.icons)) {
      if (typeof value !== "string") {
        continue;
      }
      const normalized = normalizeAssetPathForZip(value);
      if (normalized) {
        files.add(normalized);
      }
    }
  }
  return Array.from(files);
}

async function ensureAssetsExist(outputDir: string, assets: string[]): Promise<void> {
  for (const asset of assets) {
    const fullPath = path.join(outputDir, asset);
    try {
      await fs.access(fullPath);
    } catch {
      throw new Error(`Missing packaged asset: ${fullPath}`);
    }
  }
}

async function buildWebStorePackage(outputDir: string, zipPath: string, manifest: ThemeManifest): Promise<void> {
  const assets = collectPackageAssets(manifest);
  await ensureAssetsExist(outputDir, assets);
  await fs.rm(zipPath, { force: true });

  const proc = Bun.spawn(["zip", "-X", "-q", zipPath, ...assets], {
    cwd: outputDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to create Chrome Web Store package: ${stderr.trim() || `zip exit code ${exitCode}`}`);
  }
}

async function resolveExistingManifest(fromPath: string): Promise<{ manifestPath: string; outputDir: string }> {
  const resolved = path.resolve(process.cwd(), fromPath);
  let stats: Awaited<ReturnType<typeof fs.stat>>;

  try {
    stats = await fs.stat(resolved);
  } catch {
    throw new Error(`--from path does not exist: ${fromPath}`);
  }

  if (stats.isDirectory()) {
    const manifestPath = path.join(resolved, "manifest.json");
    try {
      await fs.access(manifestPath);
    } catch {
      throw new Error(`No manifest.json found in directory: ${resolved}`);
    }
    return { manifestPath, outputDir: resolved };
  }

  if (path.basename(resolved) !== "manifest.json") {
    throw new Error("--from must point to a directory or a manifest.json file");
  }

  return { manifestPath: resolved, outputDir: path.dirname(resolved) };
}

async function loadManifestFromPath(manifestPath: string): Promise<ThemeManifest> {
  let raw = "";
  try {
    raw = await Bun.file(manifestPath).text();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read manifest at ${manifestPath}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${manifestPath}: ${message}`);
  }

  const validationErrors = validateManifest(parsed);
  if (validationErrors.length > 0) {
    throw new Error(`Manifest validation failed for ${manifestPath}: ${validationErrors.join("; ")}`);
  }

  return parsed as ThemeManifest;
}

function buildListingDescriptionMarkdown(
  manifest: ThemeManifest,
  zipPath: string,
  iconPath: string,
  gradientStart: string,
  gradientEnd: string,
): string {
  const mode = inferThemeMode(manifest);
  const frame = rgbToHex(manifest.theme.colors.frame);
  const toolbar = rgbToHex(manifest.theme.colors.toolbar);
  const ntp = rgbToHex(manifest.theme.colors.ntp_background);
  const link = rgbToHex(manifest.theme.colors.ntp_link);
  const shortDescription = `${manifest.name} is a ${mode} Chromium theme with polished contrast and a cohesive color story.`;
  const detailed = `${manifest.name} gives Chromium a cohesive ${mode} look with balanced frame, toolbar, and new-tab page colors. It keeps tabs readable while preserving the intended mood and accent energy.`;

  return `# ${manifest.name} - Chrome Web Store Draft

## Short Description

${shortDescription}

## Detailed Description

${detailed}

## Palette Notes

- Frame: ${frame}
- Toolbar: ${toolbar}
- NTP Background: ${ntp}
- NTP Link Accent: ${link}
- Generated Icon Gradient: ${gradientStart} -> ${gradientEnd}

## Generated Assets

- Web Store zip: \`${relativePathFromCwd(zipPath)}\`
- 128x128 icon: \`${relativePathFromCwd(iconPath)}\`

## Publish Checklist

- [ ] Upload zip in Chrome Web Store Developer Console
- [ ] Upload 128x128 icon (or reuse generated icon)
- [ ] Paste short and detailed descriptions
- [ ] Add screenshots from Chromium with this theme loaded
- [ ] Confirm listing category/tags before publishing
`;
}

async function writeWebStoreDescriptionFiles(
  manifest: ThemeManifest,
  folderName: string,
  zipPath: string,
  iconPath: string,
  gradientStart: string,
  gradientEnd: string,
): Promise<{ descriptionPath: string; metadataPath: string }> {
  const descriptionsDir = path.join(process.cwd(), "descriptions");
  await fs.mkdir(descriptionsDir, { recursive: true });

  const descriptionPath = path.join(descriptionsDir, `${folderName}.md`);
  const metadataPath = path.join(descriptionsDir, `${folderName}.json`);

  const markdown = buildListingDescriptionMarkdown(manifest, zipPath, iconPath, gradientStart, gradientEnd);
  await Bun.write(descriptionPath, `${markdown.trim()}\n`);

  const metadata = {
    name: manifest.name,
    version: manifest.version,
    mode: inferThemeMode(manifest),
    files: {
      zip: relativePathFromCwd(zipPath),
      icon128: relativePathFromCwd(iconPath),
      description: relativePathFromCwd(descriptionPath),
    },
    colors: {
      frame: rgbToHex(manifest.theme.colors.frame),
      toolbar: rgbToHex(manifest.theme.colors.toolbar),
      ntp_background: rgbToHex(manifest.theme.colors.ntp_background),
      ntp_link: rgbToHex(manifest.theme.colors.ntp_link),
      icon_gradient: [gradientStart, gradientEnd],
    },
  };

  await Bun.write(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  return { descriptionPath, metadataPath };
}

function buildVariationPrompt(basePrompt: string, index: number, total: number): string {
  if (total <= 1) {
    return basePrompt;
  }

  return `${basePrompt}\n\nVariation instruction: This is candidate ${index} of ${total}. Keep the same overall mood and intent, but make this palette clearly distinct from likely sibling variations.`;
}

function createImageReferenceOutcome(requestedCount: number): ImageReferenceOutcome {
  return {
    requestedCount,
    status: requestedCount > 0 ? "requested" : "not requested",
    detail: "",
  };
}

async function generateManifestFromPrompt(options: {
  prompt: string;
  variationIndex: number;
  variationCount: number;
  configuredThinking: ThinkingConfig | null;
  modePreference: ModePreference;
  nameOverride: string | null;
  preparedReferences: PreparedReferenceImage[];
}): Promise<{ manifest: ThemeManifest; failedChecks: ContrastCheck[]; stream: StreamThemeResult }> {
  const { prompt, variationIndex, variationCount, configuredThinking, modePreference, nameOverride, preparedReferences } =
    options;

  const promptForVariation = buildVariationPrompt(prompt, variationIndex, variationCount);
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
        content:
          preparedReferences.length > 0
            ? [
                {
                  type: "text",
                  text: buildUserMessage(promptForVariation, retryFailedPairs, modePreference, preparedReferences),
                },
                ...preparedReferences.map((reference) => ({
                  type: "image_url" as const,
                  image_url: {
                    url: reference.url,
                  },
                })),
              ]
            : buildUserMessage(promptForVariation, retryFailedPairs, modePreference, preparedReferences),
      },
    ];

    const stream = await streamThemeManifest(messages, configuredThinking, preparedReferences.length > 0);
    const rawManifest = stream.rawManifest;

    let parsedManifest: unknown;
    try {
      parsedManifest = JSON.parse(rawManifest);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse generated JSON: ${message}\nRaw output:\n${rawManifest}`);
    }

    const validationErrors = validateManifest(parsedManifest);
    if (validationErrors.length > 0) {
      throw new Error(`Validation failed: ${validationErrors.join("; ")}`);
    }

    const manifest = parsedManifest as ThemeManifest;
    const baseName = nameOverride ?? normalizeGeneratedName(manifest.name);
    manifest.name = variationCount > 1 ? `${baseName} ${variationIndex}` : baseName;

    const checks = runContrastChecks(manifest);
    const failedChecks = checks.filter((check) => !check.pass);

    printContrastTable(checks);

    if (!bestResult || failedChecks.length < bestResult.checks.filter((check) => !check.pass).length) {
      bestResult = { manifest, checks, stream };
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
    throw new Error("No valid theme manifest was produced.");
  }

  return {
    manifest: bestResult.manifest,
    failedChecks: bestResult.checks.filter((check) => !check.pass),
    stream: bestResult.stream,
  };
}

async function generateFirefoxManifest(
  chromiumManifest: ThemeManifest,
  configuredThinking: ThinkingConfig | null,
): Promise<FirefoxThemeManifest> {
  console.log(pc.cyan("Generating Firefox manifest..."));

  const messages: ChatMessage[] = [
    { role: "system", content: FIREFOX_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Convert this Chromium theme manifest into a Firefox WebExtension static theme manifest. Preserve the exact theme name.

${JSON.stringify(chromiumManifest, null, 2)}`,
    },
  ];

  const stream = await streamThemeManifest(messages, configuredThinking, false);
  const rawManifest = stream.rawManifest;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawManifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse generated Firefox JSON: ${message}\nRaw output:\n${rawManifest}`);
  }

  const validationErrors = validateFirefoxManifest(parsed);
  if (validationErrors.length > 0) {
    throw new Error(`Firefox manifest validation failed: ${validationErrors.join("; ")}`);
  }

  const firefoxManifest = parsed as FirefoxThemeManifest;
  firefoxManifest.manifest_version = 2;
  firefoxManifest.name = chromiumManifest.name;
  firefoxManifest.version = "1.0";

  return firefoxManifest;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureUniqueOutputDir(baseDir: string): Promise<string> {
  if (!(await pathExists(baseDir))) {
    return baseDir;
  }

  let suffix = 2;
  while (true) {
    const candidate = `${baseDir}-${suffix}`;
    if (!(await pathExists(candidate))) {
      return candidate;
    }
    suffix += 1;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toSwatchCell(role: string, color: string): string {
  return `<div class="swatch-row"><span class="swatch" style="background:${escapeHtml(color)}"></span><span>${escapeHtml(role)}: ${escapeHtml(color)}</span></div>`;
}

async function writePreviewSheet(results: ThemeProcessingResult[], prompt: string): Promise<string> {
  const previewsDir = path.join(process.cwd(), "previews");
  await fs.mkdir(previewsDir, { recursive: true });

  const sheetName = `${slugify(`preview-${prompt.slice(0, 50) || "themes"}`)}-${Date.now()}.html`;
  const previewPath = path.join(previewsDir, sheetName);

  const cards = results
    .map((result, index) => {
      const colors = result.manifest.theme.colors;
      const swatches = [
        ["frame", rgbToHex(colors.frame)],
        ["toolbar", rgbToHex(colors.toolbar)],
        ["ntp_background", rgbToHex(colors.ntp_background)],
        ["tab_text", rgbToHex(colors.tab_text)],
        ["ntp_link", rgbToHex(colors.ntp_link)],
      ]
        .map(([role, color]) => toSwatchCell(role, color))
        .join("");

      const failedSummary =
        result.failedChecks.length > 0
          ? `<span class="warn">${result.failedChecks.length} failed checks</span>`
          : `<span class="ok">all checks passed</span>`;

      const screenshotList = result.screenshots
        ? `<div class="meta">screenshots:<br>${escapeHtml(relativePathFromCwd(result.screenshots.newTab))}<br>${escapeHtml(relativePathFromCwd(result.screenshots.tabsLoaded))}<br>${escapeHtml(relativePathFromCwd(result.screenshots.toolbar))}</div>`
        : "";

      return `<article class="card">
  <h2>${index + 1}. ${escapeHtml(result.manifest.name)}</h2>
  <div class="meta">manifest: ${escapeHtml(relativePathFromCwd(result.manifestPath))}</div>
  <div class="meta">zip: ${escapeHtml(relativePathFromCwd(result.webStoreZipPath))}</div>
  <div class="meta">image refs: ${escapeHtml(result.imageReference.status)}${result.imageReference.detail ? ` - ${escapeHtml(result.imageReference.detail)}` : ""}</div>
  <div class="meta">contrast: ${failedSummary}</div>
  <div class="swatches">${swatches}</div>
  ${screenshotList}
</article>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Theme Variations Preview</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font-family: "Avenir Next", "Segoe UI", sans-serif; background: #101217; color: #eef1f6; }
    header { padding: 24px; border-bottom: 1px solid #2a2f3d; background: linear-gradient(135deg, #1f2b4a, #1a1f2c); }
    h1 { margin: 0 0 8px; font-size: 22px; }
    .subtitle { margin: 0; opacity: 0.8; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; padding: 20px; }
    .card { background: #161b26; border: 1px solid #2a3246; border-radius: 12px; padding: 14px; }
    .card h2 { margin: 0 0 8px; font-size: 16px; }
    .meta { font-size: 12px; opacity: 0.9; margin: 4px 0; word-break: break-word; }
    .swatches { display: grid; gap: 6px; margin-top: 10px; }
    .swatch-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .swatch { width: 24px; height: 24px; border-radius: 6px; border: 1px solid #ffffff33; flex-shrink: 0; }
    .ok { color: #7ff2b2; }
    .warn { color: #ffd086; }
  </style>
</head>
<body>
  <header>
    <h1>Theme Variations Preview</h1>
    <p class="subtitle">Prompt: ${escapeHtml(prompt)}</p>
  </header>
  <main class="grid">${cards}</main>
</body>
</html>`;

  await Bun.write(previewPath, `${html}\n`);
  return previewPath;
}

function trimPromptForPreview(prompt: string): string {
  const clean = prompt.trim();
  if (clean.length <= PREVIEW_MAX_PROMPT_LENGTH) {
    return clean;
  }
  return `${clean.slice(0, PREVIEW_MAX_PROMPT_LENGTH - 3)}...`;
}

async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCommand(args: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = (await new Response(proc.stdout).text()).trim();
  const stderr = (await new Response(proc.stderr).text()).trim();
  if (exitCode !== 0) {
    throw new Error(`${args[0]} failed (${exitCode}): ${stderr || stdout || "no output"}`);
  }
  return stdout;
}

async function runAppleScript(script: string): Promise<string> {
  return runCommand(["osascript", "-e", script]);
}

type BrowserCandidate = {
  appName: string;
  executablePath: string;
};

const BROWSER_CANDIDATES: BrowserCandidate[] = [
  {
    appName: "Chromium",
    executablePath: "/Applications/Chromium.app/Contents/MacOS/Chromium",
  },
  {
    appName: "Google Chrome",
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  },
];

async function isAppRunning(appName: string): Promise<boolean> {
  try {
    const result = await runAppleScript(`tell application "System Events" to return (name of processes) contains "${appName}"`);
    return result.trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

async function findScreenshotBrowserCandidate(): Promise<BrowserCandidate | null> {
  for (const candidate of BROWSER_CANDIDATES) {
    if (!(await pathExists(candidate.executablePath))) {
      continue;
    }

    if (await isAppRunning(candidate.appName)) {
      continue;
    }

    return candidate;
  }

  return null;
}

async function generateScreenshotsForTheme(themeDir: string): Promise<ScreenshotArtifacts | null> {
  if (process.platform !== "darwin") {
    console.log(pc.yellow("Screenshot helper currently supports macOS only. Skipping screenshots."));
    return null;
  }

  const browser = await findScreenshotBrowserCandidate();
  if (!browser) {
    console.log(pc.yellow("No idle Chromium/Chrome app found for screenshots. Close open browser windows and retry."));
    return null;
  }

  const screenshotDir = path.join(themeDir, "screenshots");
  const profileDir = path.join(os.tmpdir(), `chromium-theme-screens-${randomUUID()}`);
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.mkdir(profileDir, { recursive: true });

  const bounds = { left: 80, top: 80, width: 1280, height: 840 };
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;

  const newTab = path.join(screenshotDir, "new-tab.png");
  const tabsLoaded = path.join(screenshotDir, "tabs-loaded.png");
  const toolbar = path.join(screenshotDir, "toolbar-state.png");

  try {
    await runCommand([
      "open",
      "-a",
      browser.appName,
      "--args",
      `--user-data-dir=${profileDir}`,
      `--disable-extensions-except=${themeDir}`,
      `--load-extension=${themeDir}`,
      "--new-window",
      "chrome://newtab",
    ]);

    await waitMs(2500);
    await runAppleScript(`tell application "${browser.appName}" to activate`);
    await runAppleScript(`tell application "${browser.appName}" to if (count of windows) > 0 then set bounds of front window to {${bounds.left}, ${bounds.top}, ${right}, ${bottom}}`);
    await waitMs(700);
    await runCommand(["screencapture", "-x", `-R${bounds.left},${bounds.top},${bounds.width},${bounds.height}`, newTab]);

    await runAppleScript(`tell application "${browser.appName}"
      activate
      if (count of windows) = 0 then make new window
      set URL of active tab of front window to "https://example.com"
      make new tab at end of tabs of front window with properties {URL:"https://www.wikipedia.org"}
      make new tab at end of tabs of front window with properties {URL:"https://developer.chrome.com/docs/webstore"}
      set active tab index of front window to 3
    end tell`);
    await waitMs(3500);
    await runCommand(["screencapture", "-x", `-R${bounds.left},${bounds.top},${bounds.width},${bounds.height}`, tabsLoaded]);

    await runAppleScript(`tell application "${browser.appName}" to if (count of windows) > 0 then set URL of active tab of front window to "chrome://settings/appearance"`);
    await waitMs(1800);
    await runCommand(["screencapture", "-x", `-R${bounds.left},${bounds.top},${bounds.width},${bounds.height}`, toolbar]);

    await runAppleScript(`tell application "${browser.appName}" to quit`);
    await fs.rm(profileDir, { recursive: true, force: true });

    return {
      newTab,
      tabsLoaded,
      toolbar,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(pc.yellow(`Screenshot helper failed: ${message}`));
    try {
      await runAppleScript(`tell application "${browser.appName}" to quit`);
    } catch {
      // ignore cleanup failure
    }
    await fs.rm(profileDir, { recursive: true, force: true });
    return null;
  }
}

async function writeThemeArtifacts(options: {
  manifest: ThemeManifest;
  failedChecks: ContrastCheck[];
  stream: StreamThemeResult | null;
  fromExisting: boolean;
  outputDir: string;
  manifestPath: string;
  webStore: boolean;
  screenshots: boolean;
  imageReference: ImageReferenceOutcome;
}): Promise<ThemeProcessingResult> {
  const { manifest, failedChecks, stream, fromExisting, webStore, screenshots, imageReference } = options;

  let outputDir = options.outputDir;
  let manifestPath = options.manifestPath;

  if (!fromExisting) {
    const baseOutputDir = path.join(process.cwd(), slugify(manifest.name));
    outputDir = await ensureUniqueOutputDir(baseOutputDir);
    await fs.mkdir(outputDir, { recursive: true });
    manifestPath = path.join(outputDir, "manifest.json");
  }

  let iconPath: string | null = null;
  let iconStartHex: string | null = null;
  let iconEndHex: string | null = null;

  if (webStore) {
    const gradientPair = selectGradientPair(manifest);
    iconPath = path.join(outputDir, "icon-128.png");
    iconStartHex = rgbToHex(gradientPair.start);
    iconEndHex = rgbToHex(gradientPair.end);
    await writeGradientIcon(iconPath, gradientPair.start, gradientPair.end, 128);
    manifest.icons = {
      ...(manifest.icons ?? {}),
      "128": "icon-128.png",
    };
  }

  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const webStoreZipPath = path.join(process.cwd(), `${slugify(manifest.name)}-webstore.zip`);
  await buildWebStorePackage(outputDir, webStoreZipPath, manifest);

  let descriptionPath: string | null = null;
  let metadataPath: string | null = null;
  if (webStore && iconPath && iconStartHex && iconEndHex) {
    const written = await writeWebStoreDescriptionFiles(
      manifest,
      slugify(manifest.name),
      webStoreZipPath,
      iconPath,
      iconStartHex,
      iconEndHex,
    );
    descriptionPath = written.descriptionPath;
    metadataPath = written.metadataPath;
  }

  const screenshotArtifacts = screenshots ? await generateScreenshotsForTheme(outputDir) : null;

  return {
    manifest,
    failedChecks,
    stream,
    outputDir,
    manifestPath,
    webStoreZipPath,
    iconPath,
    descriptionPath,
    metadataPath,
    screenshots: screenshotArtifacts,
    imageReference,
    fromExisting,
    firefoxManifestPath: null,
  };
}

function printResultSummary(result: ThemeProcessingResult, totalResults: number, resultIndex: number): void {
  const manifest = result.manifest;

  if (totalResults > 1) {
    console.log(pc.bold(pc.cyan(`\n=== Result ${resultIndex}/${totalResults}: ${manifest.name} ===`)));
  }

  console.log(
    pc.green(result.fromExisting ? "Existing theme processed successfully." : "Theme manifest generated and validated successfully."),
  );
  console.log(pc.bold(pc.cyan(`Written: ${result.manifestPath}`)));
  console.log(pc.bold(pc.cyan(`Web Store package: ${result.webStoreZipPath}`)));
  if (result.firefoxManifestPath) {
    console.log(pc.bold(pc.cyan(`Written: ${result.firefoxManifestPath}`)));
  }
  console.log(
    `Key colours: frame=${rgbToHex(manifest.theme.colors.frame)}, toolbar=${rgbToHex(
      manifest.theme.colors.toolbar,
    )}, ntp_background=${rgbToHex(manifest.theme.colors.ntp_background)}`,
  );

  if (result.iconPath) {
    console.log(pc.bold(pc.cyan(`Icon: ${result.iconPath}`)));
  }

  if (result.descriptionPath && result.metadataPath) {
    console.log(pc.bold(pc.cyan(`Listing draft: ${result.descriptionPath}`)));
    console.log(pc.bold(pc.cyan(`Publish metadata: ${result.metadataPath}`)));
  }

  if (result.screenshots) {
    console.log(pc.bold(pc.cyan(`Screenshot (new tab): ${result.screenshots.newTab}`)));
    console.log(pc.bold(pc.cyan(`Screenshot (tabs): ${result.screenshots.tabsLoaded}`)));
    console.log(pc.bold(pc.cyan(`Screenshot (toolbar): ${result.screenshots.toolbar}`)));
  }

  if (result.imageReference.requestedCount > 0) {
    const statusLabel = result.imageReference.status === "used" ? pc.green("used") : pc.yellow("not used");
    const detail = result.imageReference.detail || `${result.imageReference.requestedCount} reference image(s) were requested`;
    console.log(`Image references: ${statusLabel} (${detail})`);
  }

  if (result.failedChecks.length > 0) {
    const labels = result.failedChecks.map((check) => check.label).join(", ");
    if (result.failedChecks.length > 2) {
      console.log(pc.red(`Warning: theme written after ${MAX_RETRIES} retries with remaining contrast failures: ${labels}`));
    } else {
      console.log(pc.red(`Warning: theme written, but some contrast checks failed and legibility may be impacted: ${labels}`));
    }
  }

  printColorSummary(manifest);
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

  const fallbackTokens: string[] = [];
  if (stream.thinkingFallbackUsed) {
    fallbackTokens.push("reasoning");
  }
  if (stream.imageFallbackUsed) {
    fallbackTokens.push("image");
  }
  const fallbackSummary = fallbackTokens.length > 0 ? `  fallback=${fallbackTokens.join("+")}` : "";

  console.log(pc.cyan("Request summary:"));
  console.log(
    `  model=${modelUsed}${generation?.provider_name ? `  provider=${generation.provider_name}` : ""}  thinking=${thinking}`,
  );
  console.log(
    `  time=${formatMs(stream.requestDurationMs)}  first_thought=${formatMs(stream.timeToThinkingMs)}  provider_latency=${formatMs(generation?.latency ?? null)}${fallbackSummary}`,
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
  allowImageFallback = false,
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
            imageFallbackUsed: false,
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
      imageFallbackUsed: false,
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
          imageFallbackUsed: false,
        };
      }
    }

    if (allowImageFallback && match) {
      const status = Number(match[1]);
      const body = (match[2] ?? "").toLowerCase();
      const mentionsImageIssue =
        body.includes("image") ||
        body.includes("vision") ||
        body.includes("content part") ||
        body.includes("input modality") ||
        body.includes("unsupported") ||
        body.includes("not support");

      if ((status === 400 || status === 422) && mentionsImageIssue) {
        const strippedMessages = messages.map((message) => {
          if (!Array.isArray(message.content)) {
            return message;
          }

          const textParts = message.content.filter(
            (part): part is Extract<ChatContentPart, { type: "text" }> => part.type === "text",
          );

          return {
            ...message,
            content: textParts.length > 0 ? textParts.map((part) => part.text).join("\n\n") : "",
          };
        });

        console.log(pc.yellow("Model rejected image inputs for this request. Retrying without image references."));
        const noImageResult = await streamThemeManifest(strippedMessages, configuredThinking, false);
        return {
          ...noImageResult,
          requestedThinking,
          imageFallbackUsed: true,
        };
      }
    }

    throw error;
  }
}

async function main(): Promise<void> {
  let input = "";
  let cliThinking: ThinkingConfig | null = null;
  let cliNameOverride: string | null = null;
  let cliImageSources: string[] = [];
  let cliVariations = 1;
  let cliPreviewSheet = false;
  let cliScreenshots = false;
  let cliWebStore = false;
  let cliFromPath: string | null = null;

  try {
    const parsed = parseCliOptions(Bun.argv.slice(2));
    if (parsed.help) {
      usage(0);
    }
    input = parsed.prompt;
    cliThinking = parsed.thinking;
    cliNameOverride = parsed.nameOverride;
    cliImageSources = parsed.imageSources;
    cliVariations = parsed.variations;
    cliPreviewSheet = parsed.previewSheet;
    cliScreenshots = parsed.screenshots;
    cliWebStore = parsed.webStore;
    cliFromPath = parsed.fromPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(pc.red(message));
    usage();
  }

  if (cliFromPath && input) {
    console.error(pc.red("Do not provide a prompt when using --from. Use one mode or the other."));
    usage();
  }

  if (!cliFromPath && !input) {
    usage();
  }

  let variationCount = cliVariations;
  if (cliFromPath && variationCount > 1) {
    console.log(pc.yellow("--variations is ignored with --from; processing a single existing theme."));
    variationCount = 1;
  }

  const configuredThinking = cliThinking;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const requestedImageCount = cliImageSources.length;
  const sharedImageOutcome = createImageReferenceOutcome(requestedImageCount);
  let preparedReferences: PreparedReferenceImage[] = [];

  const results: ThemeProcessingResult[] = [];

  if (cliFromPath) {
    const resolved = await resolveExistingManifest(cliFromPath);
    const manifest = await loadManifestFromPath(resolved.manifestPath);

    if (cliNameOverride) {
      manifest.name = cliNameOverride;
    }

    const checks = runContrastChecks(manifest);
    printContrastTable(checks);

    const imageReference: ImageReferenceOutcome = {
      requestedCount: requestedImageCount,
      status: requestedImageCount > 0 ? "ignored" : "not requested",
      detail:
        requestedImageCount > 0
          ? "--from mode does not call the model, so image references were ignored"
          : "",
    };

    if (requestedImageCount > 0) {
      console.log(pc.yellow("Image references ignored in --from mode; continuing with existing theme manifest."));
    }

    const result = await writeThemeArtifacts({
      manifest,
      failedChecks: checks.filter((check) => !check.pass),
      stream: null,
      fromExisting: true,
      outputDir: resolved.outputDir,
      manifestPath: resolved.manifestPath,
      webStore: cliWebStore,
      screenshots: cliScreenshots,
      imageReference,
    });

    results.push(result);
  } else {
    if (requestedImageCount > 0) {
      const imageSupport = await modelSupportsImageInputs(process.env.OPENROUTER_MODEL);
      if (imageSupport === false) {
        sharedImageOutcome.status = "fallback";
        sharedImageOutcome.detail =
          "configured model does not advertise image inputs; continuing with prompt-only generation";
        console.log(
          pc.yellow(
            `Configured model (${process.env.OPENROUTER_MODEL}) does not advertise image inputs. Continuing without image references.`,
          ),
        );
      } else {
        try {
          preparedReferences = await prepareReferenceImages(cliImageSources);
          if (preparedReferences.length > 0) {
            sharedImageOutcome.status = "prepared";
            sharedImageOutcome.detail = `${preparedReferences.length}/${requestedImageCount} reference image(s) prepared`;
          } else {
            sharedImageOutcome.status = "fallback";
            sharedImageOutcome.detail = "no usable image references were prepared; continuing with prompt-only generation";
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sharedImageOutcome.status = "fallback";
          sharedImageOutcome.detail = `image preparation failed (${message}); continuing with prompt-only generation`;
          preparedReferences = [];
          console.log(pc.yellow(`Failed to prepare reference images: ${message}`));
          console.log(pc.yellow("Continuing with prompt-only generation."));
        }
      }
    }

    const modePreference = detectModePreference(input);

    for (let variationIndex = 1; variationIndex <= variationCount; variationIndex += 1) {
      if (variationCount > 1) {
        console.log(pc.cyan(`Generating variation ${variationIndex}/${variationCount}...`));
      }

      let generated;
      try {
        generated = await generateManifestFromPrompt({
          prompt: input,
          variationIndex,
          variationCount,
          configuredThinking,
          modePreference,
          nameOverride: cliNameOverride,
          preparedReferences,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(pc.red(`Generation failed for variation ${variationIndex}: ${message}`));
        process.exit(1);
      }

      const imageReference: ImageReferenceOutcome = {
        requestedCount: sharedImageOutcome.requestedCount,
        status: sharedImageOutcome.status,
        detail: sharedImageOutcome.detail,
      };

      if (requestedImageCount > 0 && preparedReferences.length > 0) {
        if (generated.stream.imageFallbackUsed) {
          imageReference.status = "fallback";
          imageReference.detail = "model rejected image inputs; fallback to prompt-only generation was used";
        } else {
          imageReference.status = "used";
          imageReference.detail = `${preparedReferences.length}/${requestedImageCount} reference image(s) used`;
        }
      }

      const result = await writeThemeArtifacts({
        manifest: generated.manifest,
        failedChecks: generated.failedChecks,
        stream: generated.stream,
        fromExisting: false,
        outputDir: "",
        manifestPath: "",
        webStore: cliWebStore,
        screenshots: cliScreenshots,
        imageReference,
      });

      let firefoxManifestPath: string | null = null;
      try {
        const firefoxManifest = await generateFirefoxManifest(generated.manifest, configuredThinking);
        firefoxManifestPath = path.join(result.outputDir, "firefox-manifest.json");
        await Bun.write(firefoxManifestPath, `${JSON.stringify(firefoxManifest, null, 2)}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(pc.yellow(`Firefox manifest generation failed: ${message}`));
      }

      results.push({ ...result, firefoxManifestPath });
    }
  }

  const shouldWritePreviewSheet = cliPreviewSheet || results.length > 1;
  let previewPath: string | null = null;
  if (shouldWritePreviewSheet) {
    const previewPromptLabel = cliFromPath ? `from: ${cliFromPath}` : trimPromptForPreview(input);
    previewPath = await writePreviewSheet(results, previewPromptLabel);
  }

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    printResultSummary(result, results.length, i + 1);

    if (result.stream) {
      const generation = await fetchGenerationMetadata(apiKey ?? "", result.stream.generationId);
      printRequestSummary(result.stream, generation);
    }
  }

  if (previewPath) {
    console.log(pc.bold(pc.cyan(`Preview sheet: ${previewPath}`)));
  }
}

await main();
