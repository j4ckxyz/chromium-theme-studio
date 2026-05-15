import contrastLib from "get-contrast";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import pc from "picocolors";

import {
  loadConfig, getProviderFromConfig, parseThinkingValue,
  type CtmConfig, type ResolvedProvider,
} from "./config.js";
import {
  validateManifest, validateFirefoxManifest, rgbToHex, hexToRgb, swatch,
  slugify, normalizeGeneratedName, detectModePreference,
  relativePathFromCwd, escapeHtml,
  type ThemeManifest, type ContrastCheck, type StreamThemeResult,
  type ImageReferenceOutcome, type ScreenshotArtifacts,
} from "./manifest.js";
import { streamThemeManifest, fetchGenerationMetadata, modelSupportsImageInputs } from "./provider.js";
import {
  EXAMPLES, findExampleBySlug, findExamplesByTag,
  buildExampleCommand, buildExampleCommandBun,
  type ExampleEntry,
} from "./examples.js";
import { addHistoryEntry, getHistoryEntries, getHistoryStats } from "./history.js";

// ─── ANSI Rainbow helpers ───────────────────────────────────────────────────
const RAINBOW_ANSI = [
  "\u001b[38;2;255;100;100m", // red
  "\u001b[38;2;255;165;0m",    // orange
  "\u001b[38;2;255;255;0m",    // yellow
  "\u001b[38;2;100;255;100m", // green
  "\u001b[38;2;0;255;255m",   // cyan
  "\u001b[38;2;100;100;255m",  // blue
  "\u001b[38;2;200;0;255m",    // violet
];
const RESET = "\u001b[0m";

function rainbowText(text: string): string {
  return RAINBOW_ANSI.map((c) => c + text).join(RESET + " ");
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "n/a";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return value === 0 ? "$0.00" : `$${value.toFixed(value < 0.01 ? 6 : 4)}`;
}

function logo(): void {
  console.log(pc.cyan("\n  ╔══════════════════════════════════════════════╗"));
  console.log(pc.cyan("  ║      ") + pc.bold(pc.white("Chromium Theme Studio v2")) + pc.cyan("                  ║"));
  console.log(pc.cyan("  ║      ") + pc.dim("Custom provider · Bulk · History") + pc.cyan("      ║"));
  console.log(pc.cyan("  ╚══════════════════════════════════════════════╝\n"));
}

async function fileToDataUrl(filePath: string, mimeType: string): Promise<string> {
  const bytes = await Bun.file(filePath).arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

// ─── Prompts system ────────────────────────────────────────────────────────
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
- frame and frame_inactive should differ slightly in lightness (5–15 points)

COLOUR TEMPERATURE:
- Keep the overall colour temperature consistent
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
- accentcolor, bookmark_text, button_background_active, button_background_hover, frame,
- frame_inactive, icons, icons_attention, ntp_background, ntp_text, popup, popup_border,
- popup_highlight, popup_highlight_text, popup_text, sidebar, sidebar_border, sidebar_highlight,
- sidebar_highlight_text, sidebar_text, tab_background_separator, tab_background_text,
- tab_line, tab_loading, tab_selected, tab_text, tabbrowser_toolbar_top_separator, toolbar,
- toolbar_bottom_separator, toolbar_field, toolbar_field_border, toolbar_field_border_focus,
- toolbar_field_focus, toolbar_field_highlight, toolbar_field_highlight_text, toolbar_field_text,
- toolbar_field_text_focus, toolbar_text, toolbar_top_separator, toolbar_vertical_separator

Rules:
- Use RGB arrays [R, G, B] with integers 0-255.
- Map the Chromium colours to the closest semantic Firefox equivalents.
- Preserve the theme name from the input manifest.
- Include all keys that have a sensible mapping; omit keys only when there is no reasonable equivalent.
- Leave "images" as an empty object and "properties" as an empty object.

Output structure:
{
  "manifest_version": 2,
  "name": "<theme name>",
  "version": "1.0",
  "theme": { "colors": { ... }, "images": {}, "properties": {} }
}`;

const RETRY_NOTE_PREFIX = "IMPORTANT: Your previous attempt failed contrast checks on:";
const MAX_RETRIES = 2;
const MAX_VARIATIONS = 12;

type ChatMessage = {
  role: "system" | "user";
  content: string | { type: "text"; text: string }[] | { type: "image_url"; image_url: { url: string } }[];
};

// ─── CLI option types ───────────────────────────────────────────────────────
type CliOptions = {
  prompt: string;
  thinking: { effort: string } | null;
  name: string | null;
  variations: number;
  webStore: boolean;
  screenshots: boolean;
  previewSheet: boolean;
  firefox: boolean;
  images: string[];
  from: string | null;
  providerUrl: string | null;
  providerKey: string | null;
  providerModel: string | null;
  profile: string | null;
};

// ─── CLI parsing ─────────────────────────────────────────────────────────────
function parseCli(raw: string[]): CliOptions {
  const opts: CliOptions = {
    prompt: "",
    thinking: null,
    name: null,
    variations: 1,
    webStore: false,
    screenshots: false,
    previewSheet: false,
    firefox: false,
    images: [],
    from: null,
    providerUrl: null,
    providerKey: null,
    providerModel: null,
    profile: null,
  };

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === "-h" || arg === "--help") { printHelp(0); }

    if (arg === "--web-store" || arg === "-w") { opts.webStore = true; continue; }
    if (arg === "--screenshots" || arg === "-s") { opts.screenshots = true; continue; }
    if (arg === "--preview-sheet" || arg === "-p") { opts.previewSheet = true; continue; }
    if (arg === "--firefox" || arg === "-F") { opts.firefox = true; continue; }

    if (arg === "--variations" || arg === "-v") {
      const n = raw[++i];
      if (!n || n.startsWith("-")) throw new Error("--variations requires a number");
      opts.variations = parseInt(n, 10);
      continue;
    }
    if (arg.startsWith("--variations=")) { opts.variations = parseInt(arg.slice(12), 10); continue; }

    if (arg === "--name" || arg === "-n") {
      opts.name = raw[++i];
      if (!opts.name || opts.name.startsWith("-")) throw new Error("--name requires a value");
      continue;
    }
    if (arg.startsWith("--name=")) { opts.name = arg.slice(7); continue; }

    if (arg === "--image" || arg === "-i") { opts.images.push(raw[++i]); continue; }
    if (arg.startsWith("--image=")) { opts.images.push(arg.slice(8)); continue; }

    if (arg === "--from" || arg === "-f") {
      opts.from = raw[++i];
      if (!opts.from || opts.from.startsWith("-")) throw new Error("--from requires a path");
      continue;
    }
    if (arg.startsWith("--from=")) { opts.from = arg.slice(7); continue; }

    if (arg === "--thinking") {
      const next = raw[i + 1];
      if (next && !next.startsWith("-")) { opts.thinking = parseThinkingValue(next); i++; }
      else opts.thinking = parseThinkingValue("high");
      continue;
    }
    if (arg.startsWith("--thinking=")) { opts.thinking = parseThinkingValue(arg.slice(11)); continue; }

    if (arg === "--provider-url" || arg === "--url") {
      opts.providerUrl = raw[++i];
      if (!opts.providerUrl || opts.providerUrl.startsWith("-")) throw new Error("--provider-url requires a URL");
      continue;
    }
    if (arg.startsWith("--provider-url=")) { opts.providerUrl = arg.slice(14); continue; }

    if (arg === "--provider-key" || arg === "--key") {
      opts.providerKey = raw[++i];
      if (!opts.providerKey || opts.providerKey.startsWith("-")) throw new Error("--provider-key requires a key");
      continue;
    }
    if (arg.startsWith("--provider-key=")) { opts.providerKey = arg.slice(15); continue; }

    if (arg === "--provider-model" || arg === "--model") {
      opts.providerModel = raw[++i];
      if (!opts.providerModel || opts.providerModel.startsWith("-")) throw new Error("--provider-model requires a model name");
      continue;
    }
    if (arg.startsWith("--provider-model=")) { opts.providerModel = arg.slice(16); continue; }

    if (arg === "--profile" || arg === "-P") {
      opts.profile = raw[++i];
      if (!opts.profile || opts.profile.startsWith("-")) throw new Error("--profile requires a name");
      continue;
    }
    if (arg.startsWith("--profile=")) { opts.profile = arg.slice(10); continue; }

    if (arg.startsWith("--")) throw new Error(`Unknown flag: ${arg}`);
    if (arg.startsWith("-")) throw new Error(`Unknown flag: ${arg}`);

    opts.prompt = raw.slice(i).join(" ");
    break;
  }

  if (opts.variations < 1 || opts.variations > MAX_VARIATIONS) {
    throw new Error(`--variations must be 1-${MAX_VARIATIONS}`);
  }

  return opts;
}

function printHelp(exit = 1): never {
  const p = exit === 0 ? console.log : console.error;
  p(`\n${pc.bold("Chromium Theme Studio")} — Advanced theme generation CLI\n`);
  p(`Usage:\n  ${pc.cyan("ctm generate")} "prompt..." [options]      Generate one or more themes`);
  p(`  ${pc.cyan("ctm examples")} [options]               List/show example themes with commands`);
  p(`  ${pc.cyan("ctm history")} [options]               View generation history`);
  p(`  ${pc.cyan("ctm config")} [options]                Manage provider profiles`);
  p(`  ${pc.cyan("ctm -h")}                          Show this help\n`);
  p(`${pc.bold("GENERATE options:")}`);
  p(`  ${pc.cyan("-n, --name <name>")}       Set explicit output folder/theme name`);
  p(`  ${pc.cyan("-v, --variations <n>")}    Generate 1-12 theme variations (default 1)`);
  p(`  ${pc.cyan("-w, --web-store")}          Generate Chrome Web Store assets`);
  p(`  ${pc.cyan("-s, --screenshots")}        Capture listing screenshots (macOS only)`);
  p(`  ${pc.cyan("-p, --preview-sheet")}      Write HTML comparison sheet`);
  p(`  ${pc.cyan("-F, --firefox")}            Also generate Firefox manifest`);
  p(`  ${pc.cyan("-i, --image <path/url>")}   Reference image(s) for palette inspiration`);
  p(`  ${pc.cyan("-f, --from <path>")}        Re-process existing theme folder/manifest`);
  p(`  ${pc.cyan("--thinking[=<level>]")}     Enable reasoning (xhigh|high|medium|low|minimal|none|off)\n`);
  p(`${pc.bold("PROVIDER options:")}`);
  p(`  ${pc.cyan("--provider-url <url>")}      API base URL (e.g. https://openrouter.ai/api/v1)`);
  p(`  ${pc.cyan("--provider-key <key>")}      API key (or set OPENROUTER_API_KEY env var)`);
  p(`  ${pc.cyan("--provider-model <m>")}      Model ID (e.g. anthropic/claude-3.7-sonnet)`);
  p(`  ${pc.cyan("-P, --profile <name>")}      Use saved provider profile\n`);
  p(`${pc.bold("EXAMPLES:")}`);
  p(`  ctm generate "warm sunset, orange and amber, dark" --web-store`);
  p(`  ctm generate "coastal dawn" -v 6 --preview-sheet --web-store`);
  p(`  ctm generate "minimal monochrome" --name "Slate Minimal" -w`);
  p(`  ctm generate -f ./my-theme --screenshots`);
  p(`  ctm generate "neon night" --provider-model anthropic/claude-sonnet-4 --thinking`);
  p(`  ctm examples                    # list all examples`);
  p(`  ctm examples obsidian-dusk     # show specific example`);
  p(`  ctm history                    # show recent generations`);
  p(`  ctm history --search sunset    # search history`);
  p(`  ctm config --list              # list saved profiles`);
  p(`  ctm config --add my-provider --url https://... --key $MY_KEY --model gpt-4o\n`);
  p(`${pc.bold("CONFIGURATION:")}`);
  p(`  Config is searched in: .ctm.json (local) > ~/.config/ctm/config.json (global)`);
  p(`  Env vars: OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_API_BASE_URL`);
  p(`  Profiles can store multiple provider configurations for quick switching.\n`);
  process.exit(exit);
}

// ─── Colour checks ──────────────────────────────────────────────────────────
function runContrastChecks(manifest: ThemeManifest): ContrastCheck[] {
  const c = manifest.theme.colors;
  const pairs = [
    { label: "Tab text on toolbar", fg: rgbToHex(c.tab_text), bg: rgbToHex(c.toolbar), min: 2.5 },
    { label: "Inactive tab text on frame", fg: rgbToHex(c.tab_background_text), bg: rgbToHex(c.frame), min: 2.0 },
    { label: "Bookmark text on toolbar", fg: rgbToHex(c.bookmark_text), bg: rgbToHex(c.toolbar), min: 2.5 },
    { label: "NTP text on background", fg: rgbToHex(c.ntp_text), bg: rgbToHex(c.ntp_background), min: 2.5 },
    { label: "NTP link on background", fg: rgbToHex(c.ntp_link), bg: rgbToHex(c.ntp_background), min: 2.0 },
  ];
  return pairs.map(({ label, fg, bg, min }) => {
    const ratio = Number(contrastLib.ratio(fg, bg));
    return { label, foreground: fg, background: bg, minRatio: min, ratio, score: String(contrastLib.score(fg, bg)), pass: ratio >= min };
  });
}

function printContrastTable(checks: ContrastCheck[]): void {
  console.log(pc.cyan("Contrast checks:"));
  for (const check of checks) {
    const icon = check.pass ? pc.green("✅") : pc.red("❌");
    console.log(`${icon} | ${check.label} | ${check.ratio.toFixed(1)}:1 | ${check.pass ? pc.green(check.score) : pc.red(check.score)}`);
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
    ["button_background", `${rgbToHex([c.button_background[0], c.button_background[1], c.button_background[2]])} (α=${c.button_background[3]})`],
  ];
  console.log(pc.cyan("Color summary:"));
  for (const [role, value] of rows) {
    const hex = value.startsWith("#") ? value.slice(0, 7) : "#000000";
    console.log(`  ${swatch(hex)}  ${value}  ${role}`);
  }
}

// ─── Manifest generation ──────────────────────────────────────────────────
function buildUserMessage(input: string, failedPairs: string[], mode: "light" | "dark" | null, refs: unknown[]): string {
  const parts = [FEW_SHOT_EXAMPLES, `Theme request: ${input}`];
  if (mode === "light") parts.push("Mode preference: User explicitly requested a light theme.");
  else if (mode === "dark") parts.push("Mode preference: User explicitly requested a dark theme.");
  else parts.push("Mode preference: No explicit light/dark mode requested.");
  if (refs.length > 0) parts.push(`Reference images attached (${refs.length}). Use them for colour inspiration.`);
  if (failedPairs.length > 0) parts.push(`${RETRY_NOTE_PREFIX} ${failedPairs.join(", ")}.`);
  return parts.join("\n\n");
}

async function generateTheme(
  provider: ResolvedProvider,
  prompt: string,
  opts: Pick<CliOptions, "thinking" | "name" | "variations" | "images" | "webStore" | "firefox" | "screenshots" | "previewSheet" | "from">,
  variationIndex: number,
  variationCount: number,
  mode: "light" | "dark" | null,
  imageOutcome: ImageReferenceOutcome,
): Promise<{ manifest: ThemeManifest; checks: ContrastCheck[]; stream: StreamThemeResult }> {
  let retryFailedPairs: string[] = [];
  let bestResult: { manifest: ThemeManifest; checks: ContrastCheck[]; stream: StreamThemeResult } | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) console.log(pc.yellow(`Retrying (${attempt}/${MAX_RETRIES})...`));

    const variationNote = variationCount > 1 ? `\n\nVariation instruction: Candidate ${variationIndex} of ${variationCount}. Keep the same overall mood, but make this palette clearly distinct.` : "";

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(prompt + variationNote, retryFailedPairs, mode, []) },
    ];

    const stream = await streamThemeManifest(provider, messages, opts.thinking, opts.images.length > 0);

    let parsed: unknown;
    try {
      parsed = JSON.parse(stream.rawManifest);
    } catch {
      throw new Error(`Failed to parse generated JSON. Raw:\n${stream.rawManifest.slice(0, 500)}`);
    }

    const errors = validateManifest(parsed);
    if (errors.length > 0) throw new Error(`Validation failed: ${errors.join("; ")}`);

    const manifest = parsed as ThemeManifest;
    const baseName = opts.name ?? normalizeGeneratedName(manifest.name);
    manifest.name = variationCount > 1 ? `${baseName} ${variationIndex}` : baseName;

    const checks = await runContrastChecks(manifest);

    if (!bestResult || checks.filter((c) => !c.pass).length < bestResult.checks.filter((c) => !c.pass).length) {
      bestResult = { manifest, checks, stream };
    }

    const failed = checks.filter((c) => !c.pass);
    if (failed.length === 0 || failed.length <= 2 || attempt === MAX_RETRIES) break;
    retryFailedPairs = failed.map((f) => f.label);
  }

  if (!bestResult) throw new Error("No valid theme manifest was produced.");
  return bestResult;
}

async function generateFirefoxManifest(
  provider: ResolvedProvider,
  chromium: ThemeManifest,
  thinking: { effort: string } | null,
): Promise<import("./manifest.js").FirefoxThemeManifest> {
  const messages: ChatMessage[] = [
    { role: "system", content: FIREFOX_SYSTEM_PROMPT },
    { role: "user", content: `Convert this Chromium theme manifest into a Firefox WebExtension static theme manifest.\n\n${JSON.stringify(chromium, null, 2)}` },
  ];

  const stream = await streamThemeManifest(provider, messages, thinking, false);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stream.rawManifest);
  } catch {
    throw new Error(`Firefox JSON parse failed. Raw:\n${stream.rawManifest.slice(0, 500)}`);
  }

  const errors = validateFirefoxManifest(parsed);
  if (errors.length > 0) throw new Error(`Firefox validation failed: ${errors.join("; ")}`);

  const fx = parsed as import("./manifest.js").FirefoxThemeManifest;
  fx.manifest_version = 2;
  fx.name = chromium.name;
  fx.version = "1.0";
  return fx;
}

// ─── Write artifacts ────────────────────────────────────────────────────────
async function ensureUniqueDir(baseDir: string): Promise<string> {
  try { await fs.access(baseDir); } catch { return baseDir; }
  let suffix = 2;
  while (true) {
    const cand = `${baseDir}-${suffix}`;
    try { await fs.access(cand); } catch { return cand; }
    suffix++;
  }
}

async function writeGradientIcon(outPath: string, start: [number, number, number], end: [number, number, number], size = 128): Promise<void> {
  const png = new PNG({ width: size, height: size });
  const denom = Math.max(1, (size - 1) * 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / denom;
      const r = Math.round(start[0] + (end[0] - start[0]) * t);
      const g = Math.round(start[1] + (end[1] - start[1]) * t);
      const b = Math.round(start[2] + (end[2] - start[2]) * t);
      const idx = (size * y + x) << 2;
      png.data[idx] = r; png.data[idx + 1] = g; png.data[idx + 2] = b; png.data[idx + 3] = 255;
    }
  }
  await Bun.write(outPath, PNG.sync.write(png));
}

function selectGradientPair(manifest: ThemeManifest): { start: [number, number, number]; end: [number, number, number] } {
  const c = manifest.theme.colors;
  const candidates: Array<{ rgb: [number, number, number]; role: string }> = [
    { rgb: c.frame, role: "frame" }, { rgb: c.ntp_background, role: "ntp" },
    { rgb: c.ntp_link, role: "ntp_link" }, { rgb: c.toolbar, role: "toolbar" },
    { rgb: c.tab_text, role: "tab_text" }, { rgb: c.bookmark_text, role: "bookmark" },
  ];
  const best = candidates[0];
  const alt = candidates.find((a) => a.role !== best.role) ?? candidates[1];
  return { start: best.rgb, end: alt.rgb };
}

async function buildWebStorePackage(outputDir: string, zipPath: string): Promise<void> {
  await fs.rm(zipPath, { force: true });
  const assets = ["manifest.json"];
  const proc = Bun.spawn(["zip", "-X", "-q", zipPath, ...assets], { cwd: outputDir, stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`zip failed (${code})`);
}

async function writePreviewSheet(results: import("./manifest.js").ThemeProcessingResult[]): Promise<string> {
  const dir = path.join(process.cwd(), "previews");
  await fs.mkdir(dir, { recursive: true });
  const name = `preview-${Date.now()}.html`;
  const out = path.join(dir, name);

  const cards = results.map((r, i) => {
    const c = r.manifest.theme.colors;
    const swatches = [
      ["frame", rgbToHex(c.frame)], ["toolbar", rgbToHex(c.toolbar)],
      ["ntp_background", rgbToHex(c.ntp_background)], ["tab_text", rgbToHex(c.tab_text)],
      ["ntp_link", rgbToHex(c.ntp_link)],
    ].map(([role, color]) => `<div class="swatch-row"><span class="swatch" style="background:${escapeHtml(color)}"></span><span>${escapeHtml(role + ": " + color)}</span></div>`).join("");

    return `<article class="card">
  <h2>${i + 1}. ${escapeHtml(r.manifest.name)}</h2>
  <div class="meta">${escapeHtml(relativePathFromCwd(r.outputDir))}</div>
  <div class="swatches">${swatches}</div>
  ${r.failedChecks.length > 0 ? `<span class="warn">${r.failedChecks.length} contrast failures</span>` : `<span class="ok">all checks passed</span>`}
</article>`;
  }).join("\n");

  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Theme Variations</title>
<style>
body{margin:0;font-family:system-ui,sans-serif;background:#101217;color:#eef1f6}
header{padding:24px;border-bottom:1px solid #2a2f3d;background:linear-gradient(135deg,#1f2b4a,#1a1f2c)}
h1{margin:0}subtitle{opacity:.8}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;padding:20px}
.card{background:#161b26;border:1px solid #2a3246;border-radius:12px;padding:14px}
.swatch{width:24px;height:24px;border-radius:6px;display:inline-block;margin-right:8px}
.swatch-row{display:flex;align-items:center;font-size:13px;margin:4px 0}
.ok{color:#7ff2b2}.warn{color:#ffd086}
</style>
</head><body><header><h1>Theme Variations</h1></header><main class="grid">${cards}</main></body></html>`;

  await Bun.write(out, html);
  return out;
}

// ─── Commands ───────────────────────────────────────────────────────────────
async function cmdGenerate(rawArgs: string[]): Promise<void> {
  const opts = parseCli(rawArgs);
  const config = await loadConfig();
  const provider = getProviderFromConfig(config, opts.profile, opts.providerUrl, opts.providerKey, opts.providerModel);
  const mode = detectModePreference(opts.prompt);
  const imageOutcome: ImageReferenceOutcome = { requestedCount: opts.images.length, status: opts.images.length > 0 ? "prepared" : "not requested", detail: "" };

  const results: import("./manifest.js").ThemeProcessingResult[] = [];

  if (opts.from) {
    const resolved = path.resolve(process.cwd(), opts.from);
    let stats;
    try { stats = await fs.stat(resolved); } catch { throw new Error(`Path not found: ${opts.from}`); }
    let manifestPath: string;
    let outputDir: string;
    if (stats.isDirectory()) {
      manifestPath = path.join(resolved, "manifest.json");
      outputDir = resolved;
    } else {
      manifestPath = resolved;
      outputDir = path.dirname(resolved);
    }
    const raw = await Bun.file(manifestPath).text();
    const manifest = JSON.parse(raw) as ThemeManifest;
    if (opts.name) manifest.name = opts.name;
    const checks = await runContrastChecks(manifest);
    printContrastTable(checks);

    const result = await writeThemeArtifacts(provider, manifest, checks, null, false, outputDir, manifestPath, opts);
    results.push(result);
  } else {
    for (let vi = 1; vi <= opts.variations; vi++) {
      if (opts.variations > 1) console.log(pc.cyan(`\nGenerating variation ${vi}/${opts.variations}...`));
      const { manifest, checks, stream } = await generateTheme(provider, opts.prompt, opts, vi, opts.variations, mode, imageOutcome);
      const result = await writeThemeArtifacts(provider, manifest, checks, stream, false, "", "", opts);
      results.push(result);
    }
  }

  if (results.length > 1 || opts.previewSheet) {
    const previewPath = await writePreviewSheet(results);
    console.log(pc.cyan(`Preview sheet: ${previewPath}`));
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    printResultSummary(r, results.length, i + 1);
    if (r.stream) {
      const gen = await fetchGenerationMetadata(provider, r.stream.generationId);
      printRequestSummary(r.stream, gen, provider);
    }
  }
}

async function writeThemeArtifacts(
  provider: ResolvedProvider,
  manifest: ThemeManifest,
  checks: ContrastCheck[],
  stream: StreamThemeResult | null,
  fromExisting: boolean,
  _outputDir: string,
  _manifestPath: string,
  opts: Pick<CliOptions, "webStore" | "firefox" | "screenshots" | "name" | "variations">,
): Promise<import("./manifest.js").ThemeProcessingResult> {
  const baseDir = path.join(process.cwd(), slugify(opts.name ?? manifest.name));
  const outputDir = fromExisting ? _outputDir : await ensureUniqueDir(baseDir);
  await fs.mkdir(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, "manifest.json");

  let iconPath: string | null = null;
  let iconStart: string | null = null;
  let iconEnd: string | null = null;

  if (opts.webStore) {
    const gp = selectGradientPair(manifest);
    iconPath = path.join(outputDir, "icon-128.png");
    iconStart = rgbToHex(gp.start);
    iconEnd = rgbToHex(gp.end);
    await writeGradientIcon(iconPath, gp.start, gp.end, 128);
    manifest.icons = { ...manifest.icons, "128": "icon-128.png" };
  }

  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const zipPath = path.join(process.cwd(), `${slugify(manifest.name)}-webstore.zip`);
  await buildWebStorePackage(outputDir, zipPath);

  let descriptionPath: string | null = null;
  let metadataPath: string | null = null;
  if (opts.webStore && iconPath && iconStart && iconEnd) {
    const descDir = path.join(process.cwd(), "descriptions");
    await fs.mkdir(descDir, { recursive: true });
    descriptionPath = path.join(descDir, `${slugify(manifest.name)}.md`);
    metadataPath = path.join(descDir, `${slugify(manifest.name)}.json`);
    const markdown = `# ${manifest.name}\n\nKey colors: frame=${iconStart}, link=${iconEnd}\nAssets: ${relativePathFromCwd(zipPath)} | ${relativePathFromCwd(iconPath)}\n`;
    await Bun.write(descriptionPath, markdown);
    const meta = { name: manifest.name, version: manifest.version, files: { zip: relativePathFromCwd(zipPath), icon: relativePathFromCwd(iconPath) }, colors: { frame: iconStart, link: iconEnd } };
    await Bun.write(metadataPath, JSON.stringify(meta, null, 2) + "\n");
  }

  let firefoxManifestPath: string | null = null;
  if (opts.firefox) {
    try {
      const fx = await generateFirefoxManifest(provider, manifest, null);
      firefoxManifestPath = path.join(outputDir, "firefox-manifest.json");
      await Bun.write(firefoxManifestPath, JSON.stringify(fx, null, 2) + "\n");
    } catch (e) {
      console.log(pc.yellow(`Firefox manifest failed: ${e}`));
    }
  }

  return {
    manifest, failedChecks: checks.filter((c) => !c.pass), stream, outputDir, manifestPath,
    webStoreZipPath: zipPath, iconPath, descriptionPath, metadataPath, screenshots: null,
    imageReference: { requestedCount: 0, status: "not requested", detail: "" },
    fromExisting, firefoxManifestPath, command: "",
  };
}

function printResultSummary(r: import("./manifest.js").ThemeProcessingResult, total: number, idx: number): void {
  const m = r.manifest;
  if (total > 1) console.log(pc.bold(pc.cyan(`\n=== Result ${idx}/${total}: ${m.name} ===`)));
  console.log(pc.green("Theme written.") + pc.cyan(`\n  ${r.outputDir}`));
  console.log(pc.cyan(`  Web store zip: ${r.webStoreZipPath}`));
  if (r.iconPath) console.log(pc.cyan(`  Icon: ${r.iconPath}`));
  if (r.firefoxManifestPath) console.log(pc.cyan(`  Firefox manifest: ${r.firefoxManifestPath}`));
  if (r.failedChecks.length > 0) console.log(pc.red(`  ⚠ ${r.failedChecks.length} contrast failures: ${r.failedChecks.map((c) => c.label).join(", ")}`));
  printColorSummary(m);
}

function printRequestSummary(stream: StreamThemeResult, gen: import("./manifest.js").GenerationMetadata | null, provider: ResolvedProvider): void {
  const pt = gen?.tokens_prompt ?? stream.usage?.prompt_tokens ?? null;
  const ct = gen?.tokens_completion ?? stream.usage?.completion_tokens ?? null;
  const rt = gen?.native_tokens_reasoning ?? stream.usage?.completion_tokens_details?.reasoning_tokens ?? null;
  const tt = pt !== null && ct !== null ? pt + ct : null;
  const thinking = stream.usedThinking ? stream.usedThinking.effort : "off";
  const fallback = stream.thinkingFallbackUsed ? " (reasoning fallback)" : "";

  console.log(pc.cyan("\nRequest summary:"));
  console.log(`  ${pc.dim("model:")} ${pc.bold(gen?.model ?? provider.model)}`);
  console.log(`  ${pc.dim("thinking:")} ${thinking}${fallback}`);
  console.log(`  ${pc.dim("time:")} ${formatMs(stream.requestDurationMs)} | first=${formatMs(stream.timeToThinkingMs)}`);
  console.log(`  ${pc.dim("tokens:")} p=${pt ?? "?"} c=${ct ?? "?"} r=${rt ?? "?"} t=${tt ?? "?"}`);
  if (gen) console.log(`  ${pc.dim("cost:")} ${formatUsd(gen.total_cost ?? gen.usage)} | ${gen.provider_name ?? provider.url}`);
  if (stream.generationId) console.log(`  ${pc.dim("gen_id:")} ${stream.generationId}`);
}

// ─── Examples command ──────────────────────────────────────────────────────
async function cmdExamples(rawArgs: string[]): Promise<void> {
  const search = rawArgs[0] ?? "";
  let entries: ExampleEntry[] = EXAMPLES;

  if (search) {
    const bySlug = findExampleBySlug(search);
    if (bySlug) entries = [bySlug];
    else entries = findExamplesByTag(search);
  }

  if (entries.length === 0) {
    console.log(pc.yellow(`No examples found for "${search}". Try: ${EXAMPLES.map((e) => e.slug).join(", ")}`));
    return;
  }

  for (const ex of entries) {
    console.log(pc.bold(pc.cyan(`\n── ${ex.name} ──`)));
    console.log(`  ${pc.dim("Description:")} ${ex.description}`);
    console.log(`  ${pc.dim("Tags:")} ${ex.tags.join(", ")}`);
    console.log(`  ${pc.dim("Prompt:")} ${pc.white(`"${ex.prompt}"`)}`);
    console.log(`\n  ${pc.green("Command (ctm):")}`);
    console.log(`    ${pc.bold(pc.white(buildExampleCommand(ex)))}`);
    console.log(`\n  ${pc.green("Command (bun):")}`);
    console.log(`    ${pc.dim("bun run src/index.ts generate")} ${ex.flags.join(" ")} "${ex.prompt}"`);
    console.log(`\n  ${pc.green("Flags:")} ${ex.flags.join(" ")}`);
  }

  console.log(pc.dim(`\n${entries.length} example(s). Run with no args to list all.`));
  console.log(pc.dim(`Examples stored in: src/examples.ts`));
}

// ─── History command ───────────────────────────────────────────────────────
async function cmdHistory(rawArgs: string[]): Promise<void> {
  const search = rawArgs.find((a) => a.startsWith("--search="))?.slice(9) ?? undefined;
  const limit = parseInt(rawArgs.find((a) => a.startsWith("--limit="))?.slice(8) ?? "20", 10);

  const entries = await getHistoryEntries(limit, search ? { search } : undefined);
  const stats = await getHistoryStats();

  console.log(pc.bold(pc.cyan("\n  ── Generation History ──")));
  console.log(pc.dim(`  Total: ${stats.total} | ${pc.green(`✓ ${stats.successful}`)} | ${pc.red(`✗ ${stats.failed}`)}\n`));

  if (rawArgs.includes("--stats")) {
    console.log(pc.bold("Top models:"));
    for (const [model, count] of Object.entries(stats.byModel).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`  ${count}x  ${model}`);
    }
    console.log(pc.bold("\nTop flags used:"));
    for (const [flag, count] of Object.entries(stats.byTag).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`  ${count}x  --${flag}`);
    }
    return;
  }

  if (entries.length === 0) {
    console.log(pc.dim("No history entries. Generate some themes first!"));
    return;
  }

  for (const entry of entries) {
    const icon = entry.success ? pc.green("✓") : pc.red("✗");
    const time = new Date(entry.timestamp).toLocaleString();
    console.log(`  ${icon}  ${pc.bold(entry.name)}`);
    console.log(`      ${pc.dim(time)}  ${entry.provider.model}`);
    console.log(`      ${pc.dim("Prompt:")} "${entry.prompt.slice(0, 60)}${entry.prompt.length > 60 ? "..." : ""}"`);
    console.log(`      ${pc.dim("Command:")} ${entry.command}`);
    if (entry.durationMs) console.log(`      ${pc.dim("Duration:")} ${formatMs(entry.durationMs)}`);
    console.log();
  }
}

// ─── Config command ────────────────────────────────────────────────────────
async function cmdConfig(rawArgs: string[]): Promise<void> {
  const config = await loadConfig();

  if (rawArgs.includes("--list") || rawArgs.length === 0) {
    console.log(pc.bold(pc.cyan("\n  ── Provider Profiles ──")));
    console.log(pc.dim("  Local:  .ctm.json"));
    console.log(pc.dim("  Global: ~/.config/ctm/config.json\n"));

    if (config.defaultProvider) {
      console.log(pc.bold("  Default provider:"));
      console.log(`    URL:   ${config.defaultProvider.url}`);
      console.log(`    Model: ${config.defaultProvider.model}`);
      console.log(`    Key:   ${config.defaultProvider.key.startsWith("env:") ? config.defaultProvider.key : pc.red("[set in config or env]")}`);
    } else {
      console.log(pc.yellow("  No default provider configured."));
    }

    const profiles = config.profiles ?? {};
    if (Object.keys(profiles).length > 0) {
      console.log(pc.bold("\n  Saved profiles:"));
      for (const [name, p] of Object.entries(profiles)) {
        console.log(`    ${pc.cyan(name + ":")}`);
        console.log(`      URL:   ${p.url}`);
        console.log(`      Model: ${p.model}`);
      }
    } else {
      console.log(pc.dim("  No saved profiles."));
    }

    console.log(pc.dim("\n  Env var fallbacks: OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_API_BASE_URL"));
    console.log(pc.dim("  Add profile: ctm config --add <name> --url <url> --key <key> --model <model>\n"));
    return;
  }

  if (rawArgs.includes("--add") || rawArgs.includes("--set")) {
    const nameIdx = rawArgs.indexOf("--add") + 1 || rawArgs.indexOf("--set") + 1;
    const name = rawArgs[nameIdx];
    if (!name || name.startsWith("-")) { console.error(pc.red("--add requires a profile name")); process.exit(1); }

    const url = rawArgs[rawArgs.indexOf("--url") + 1] ?? rawArgs[rawArgs.indexOf("--provider-url") + 1];
    const key = rawArgs[rawArgs.indexOf("--key") + 1] ?? rawArgs[rawArgs.indexOf("--provider-key") + 1];
    const model = rawArgs[rawArgs.indexOf("--model") + 1] ?? rawArgs[rawArgs.indexOf("--provider-model") + 1];
    const isDefault = rawArgs.includes("--default");

    if (!url || !key || !model) {
      console.error(pc.red("--add requires --url, --key, and --model"));
      process.exit(1);
    }

    const newProfile = { url, key, model };
    const newConfig: CtmConfig = {
      ...config,
      ...(isDefault ? { defaultProvider: newProfile } : {}),
      profiles: { ...config.profiles, [name]: newProfile },
    };

    const savePath = rawArgs.includes("--local") ? path.resolve(process.cwd(), ".ctm.json") : path.join(os.homedir(), ".config", "ctm", "config.json");
    await fs.mkdir(path.dirname(savePath), { recursive: true });
    await fs.writeFile(savePath, JSON.stringify(newConfig, null, 2) + "\n");
    console.log(pc.green(`Profile "${name}" saved${isDefault ? " as default" : ""} to ${savePath}`));
    return;
  }
}

// ─── Main dispatch ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = Bun.argv.slice(2);

  if (args.length === 0 || args[0] === "help" || args[0] === "-h" || args[0] === "--help") {
    printHelp(0);
  }

  const cmd = args[0];
  const sub = args.slice(1);

  switch (cmd) {
    case "generate":
    case "gen":
    case "g":
      logo();
      await cmdGenerate(sub);
      break;

    case "examples":
    case "example":
    case "ex":
      await cmdExamples(sub);
      break;

    case "history":
    case "hist":
    case "h":
      await cmdHistory(sub);
      break;

    case "config":
    case "cfg":
      await cmdConfig(sub);
      break;

    default:
      // Treat unrecognized first arg as a prompt
      logo();
      await cmdGenerate(args);
  }
}

main().catch((e) => {
  console.error(pc.red(`\nError: ${e.message}`));
  process.exit(1);
});