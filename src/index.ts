import contrastLib from "get-contrast";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import pc from "picocolors";
import { Resvg } from "@resvg/resvg-js";

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
  type PaletteSeed,
} from "./manifest.js";
import {
  generatePalette, mapPaletteToManifest, rebalancePalette, computeMaterialScore,
  type PaletteMode
} from "./palette.js";
import { extractSemanticColors } from "./image-extractor.js";
import { streamThemeManifest, fetchGenerationMetadata, modelSupportsImageInputs } from "./provider.js";
import {
  EXAMPLES, findExampleBySlug, findExamplesByTag,
  buildExampleCommand, buildExampleCommandBun,
  type ExampleEntry,
} from "./examples.js";
import { addHistoryEntry, getHistoryEntries, getHistoryStats } from "./history.js";
import {
  buildManifestFromColors,
} from "./manifest.js";

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
Given a description, mood, or palette, you output ONLY a valid SeedPalette JSON.
No markdown, no explanation, no backticks — raw JSON only.

You must apply professional colour theory principles to select the core SEED colours.

AESTHETIC GOALS:
- Aggressively push for high-end, vibrant, and cohesive colour theory.
- BAN THE "AI COLOUR PALETTE": Forbid generic default fallbacks like garish neon purple-to-pink or basic cyan/grey unless explicitly requested.
- SUBCONSCIOUS COHESION: The "base_color" (neutral/background) MUST NEVER be pure dead gray, pure black (#000000), or pure white (#FFFFFF). 
- It MUST be subtly tinted toward the "primary_hue" (e.g., deep midnight ink, espresso, or tinted charcoal).
- PERCEPTUAL HARMONY: The "accent_color" must be the strongest expression of the theme but must harmonize gracefully with the base color without looking "computed" or muddy.
- MODE AWARENESS: 
  - Dark modes: Use rich, deep, beautiful dark tones (deep navy, charcoal, rich plum, forest shadow).
  - Light modes: Use soft, warm, or crisp tinted linens/slates.

OUTPUT STRUCTURE — follow exactly:
{
  "name": "<evocative theme name>",
  "primary_hue": <0-360>,
  "base_color": [R, G, B],
  "accent_color": [R, G, B],
  "mode": "balanced" | "vibrant" | "muted" | "monochrome"
}

RULES:
- base_color: The dominant surface colour (usually for the frame).
- accent_color: The primary highlight colour (usually for links or active elements).
- primary_hue: The main hue angle that defines the theme's character.
- mode: Aesthetic direction.
- All RGB values: integers 0–255.
- Raw JSON only — nothing else in your response.`;

const FEW_SHOT_EXAMPLES = `Example 1 — Dark theme ("Midnight Ink"):
{
  "name": "Midnight Ink",
  "primary_hue": 220,
  "base_color": [24, 28, 38],
  "accent_color": [100, 160, 255],
  "mode": "balanced"
}

Example 2 — Light theme ("Winter Linen"):
{
  "name": "Winter Linen",
  "primary_hue": 210,
  "base_color": [245, 247, 250],
  "accent_color": [60, 110, 180],
  "mode": "balanced"
}

Example 3 — Warm Dark ("Espresso Shadow"):
{
  "name": "Espresso Shadow",
  "primary_hue": 25,
  "base_color": [32, 28, 24],
  "accent_color": [220, 140, 80],
  "mode": "balanced"
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
  explicitColors: Record<string, string>;
  paletteMode: PaletteMode;
  debugPalette: boolean;
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
    explicitColors: {},
    paletteMode: "balanced",
    debugPalette: false,
  };
  const COLOR_ALIASES: Record<string, string> = {
    "frame-inactive": "frame_inactive",
    "tab-text": "tab_text",
    "tab-background-text": "tab_background_text",
    "bookmark-text": "bookmark_text",
    "ntp-background": "ntp_background",
    "ntp-text": "ntp_text",
    "ntp-link": "ntp_link",
    "button-background": "button_background",
    "tint-frame": "tint_frame",
    "tint-frame-inactive": "tint_frame_inactive",
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

    if (arg === "--palette-mode") {
      const m = raw[++i] as PaletteMode;
      if (!["balanced", "vibrant", "muted", "monochrome"].includes(m)) throw new Error("Invalid palette mode");
      opts.paletteMode = m;
      continue;
    }
    if (arg.startsWith("--palette-mode=")) {
      const m = arg.slice(15) as PaletteMode;
      if (!["balanced", "vibrant", "muted", "monochrome"].includes(m)) throw new Error("Invalid palette mode");
      opts.paletteMode = m;
      continue;
    }

    if (arg === "--debug-palette") { opts.debugPalette = true; continue; }

    // --color.<key>=<value> for explicit colors
    if (arg.startsWith("--color.")) {
      const rest = arg.slice(8);
      const eqIdx = rest.indexOf("=");
      if (eqIdx <= 0) throw new Error("--color.<key>=<value> requires a key and value");
      const keyRaw = rest.slice(0, eqIdx);
      const value = rest.slice(eqIdx + 1);
      const key = COLOR_ALIASES[keyRaw] ?? keyRaw;
      if (!value) throw new Error(`--color.${keyRaw}=<value> requires a value`);
      opts.explicitColors[key] = value;
      continue;
    }
    if (arg.startsWith("-c.")) {
      const rest = arg.slice(3);
      const eqIdx = rest.indexOf("=");
      if (eqIdx <= 0) throw new Error("-c.<key>=<value> requires a key and value");
      const keyRaw = rest.slice(0, eqIdx);
      const value = rest.slice(eqIdx + 1);
      const key = COLOR_ALIASES[keyRaw] ?? keyRaw;
      opts.explicitColors[key] = value;
      continue;
    }

    if (arg.startsWith("--")) throw new Error(`Unknown flag: ${arg}`);
    if (arg.startsWith("-") && !arg.startsWith("-c.")) throw new Error(`Unknown flag: ${arg}`);

    opts.prompt = raw.slice(i).join(" ");
    break;
  }

  if (opts.variations < 1 || opts.variations > MAX_VARIATIONS) {
    throw new Error(`--variations must be 1-${MAX_VARIATIONS}`);
  }

  // Allow no-prompt when explicit colors are provided
  if (!opts.prompt && Object.keys(opts.explicitColors).length === 0 && !opts.from) {
    throw new Error("Provide a prompt or use --color.* flags. Run with -h for help.");
  }

  if (opts.prompt && Object.keys(opts.explicitColors).length > 0) {
    throw new Error("Cannot combine a prompt with --color.* flags. Use one or the other.");
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
  p(`  ${pc.cyan("--palette-mode <m>")}      balanced|vibrant|muted|monochrome (default balanced)`);
  p(`  ${pc.cyan("--debug-palette")}         Show internal palette structure and scores`);
  p(`  ${pc.cyan("--thinking[=<level>]")}     Enable reasoning (xhigh|high|medium|low|minimal|none|off)
`);
  p(`${pc.bold("COLOR options (direct mode — no LLM call):")}`);
  p(`  ${pc.cyan("--color.frame=#rrggbb")}       Frame/window background color`);
  p(`  ${pc.cyan("--color.toolbar=#rrggbb")}     Toolbar color`);
  p(`  ${pc.cyan("--color.tab-text=#rrggbb")}     Active tab text color`);
  p(`  ${pc.cyan("--color.ntp-background=#rrbbgg")}  New tab page background`);
  p(`  ${pc.cyan("--color.ntp-text=#rrggbb")}     New tab page text color`);
  p(`  ${pc.cyan("--color.ntp-link=#rrggbb")}    New tab page link color`);
  p(`  ${pc.cyan("--color.buttons=h,s,l")}        Button tint [hue,sat,lightness] -1 to 1`);
  p(`  ${pc.dim("  Short form: -c.frame=#rrggbb  |  Aliases: --color.frame-inactive, etc.")}
`);
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

function generateMockBrowserSvg(manifest: ThemeManifest): string {
  const c = manifest.theme.colors;
  const frame = rgbToHex(c.frame);
  const toolbar = rgbToHex(c.toolbar);
  const activeTab = toolbar;
  const activeTabText = rgbToHex(c.tab_text);
  const inactiveTab = rgbToHex(c.frame_inactive);
  const inactiveTabText = rgbToHex(c.tab_background_text);
  const ntpBg = rgbToHex(c.ntp_background);
  const ntpLink = rgbToHex(c.ntp_link);

  return `
<svg width="800" height="600" viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg">
  <!-- Window Frame -->
  <rect width="800" height="600" fill="${frame}" />
  
  <!-- Tabs Area -->
  <rect x="0" y="0" width="800" height="40" fill="${frame}" />
  
  <!-- Inactive Tab -->
  <path d="M 10 40 L 30 10 L 170 10 L 190 40 Z" fill="${inactiveTab}" />
  <text x="100" y="30" font-family="sans-serif" font-size="12" fill="${inactiveTabText}" text-anchor="middle">Inactive Tab</text>
  
  <!-- Active Tab -->
  <path d="M 180 40 L 200 10 L 340 10 L 360 40 Z" fill="${activeTab}" />
  <text x="270" y="30" font-family="sans-serif" font-size="12" fill="${activeTabText}" text-anchor="middle">Active Tab</text>
  
  <!-- Toolbar -->
  <rect x="0" y="40" width="800" height="50" fill="${toolbar}" />
  
  <!-- URL Bar -->
  <rect x="100" y="50" width="600" height="30" rx="15" fill="${frame}" opacity="0.5" />
  <text x="120" y="70" font-family="sans-serif" font-size="14" fill="${activeTabText}" opacity="0.8">https://google.com</text>
  
  <!-- NTP Area -->
  <rect x="0" y="90" width="800" height="510" fill="${ntpBg}" />
  <circle cx="400" cy="250" r="40" fill="${ntpLink}" />
  <text x="400" y="320" font-family="sans-serif" font-size="24" fill="${ntpLink}" text-anchor="middle" font-weight="bold">New Tab Page</text>
</svg>
`.trim();
}

async function generateTheme(
  provider: ResolvedProvider,
  prompt: string,
  opts: Pick<CliOptions, "thinking" | "name" | "variations" | "images" | "webStore" | "firefox" | "screenshots" | "previewSheet" | "from" | "paletteMode" | "debugPalette">,
  variationIndex: number,
  variationCount: number,
  mode: "light" | "dark" | null,
  imageOutcome: ImageReferenceOutcome,
  imageColors: Rgb[] = [],
): Promise<{ manifest: ThemeManifest; checks: ContrastCheck[]; stream: StreamThemeResult }> {
  let bestResult: { manifest: ThemeManifest; checks: ContrastCheck[]; stream: StreamThemeResult } | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) console.log(pc.yellow(`Retrying (${attempt}/${MAX_RETRIES})...`));

    const variationNote = variationCount > 1 ? `\n\nVariation instruction: Candidate ${variationIndex} of ${variationCount}. Keep the same overall mood, but make this palette clearly distinct.` : "";
    
    let imageNote = "";
    if (imageColors.length > 0) {
      imageNote = `\n\nImage Inspiration Colours (use these as hints for base or accents):\n${imageColors.map(c => rgbToHex(c)).join(", ")}`;
    }

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(prompt + variationNote + imageNote, [], mode, []) },
    ];

    const stream = await streamThemeManifest(provider, messages, opts.thinking, opts.images.length > 0);

    let seed: PaletteSeed;
    try {
      seed = JSON.parse(stream.rawManifest);
      if (!seed.base_color || !seed.accent_color || typeof seed.primary_hue !== "number") {
        throw new Error("Missing required SeedPalette fields");
      }
    } catch (e) {
      throw new Error(`Failed to parse or validate generated SeedPalette. ${e.message}\nRaw:\n${stream.rawManifest.slice(0, 500)}`);
    }

    // --- Vision Feedback Loop ---
    const canUseVision = await modelSupportsImageInputs(provider);
    if (canUseVision) {
      console.log(pc.cyan("Model supports vision. Generating mockup for refinement..."));
      
      // Generate intermediate palette/manifest for visual critique
      let intermediatePalette = generatePalette({
        ...seed,
        mode: opts.paletteMode !== "balanced" ? opts.paletteMode : seed.mode || "balanced"
      });
      intermediatePalette = rebalancePalette(intermediatePalette);
      const intermediateManifest = mapPaletteToManifest(opts.name ?? normalizeGeneratedName(seed.name), intermediatePalette);
      
      const svg = generateMockBrowserSvg(intermediateManifest);
      const resvg = new Resvg(svg, { background: "white", fitTo: { mode: "width", value: 800 } });
      const pngData = resvg.render();
      const pngBuffer = pngData.asPng();
      const mockUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
      
      const refinementMessages: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: stream.rawManifest },
        { 
          role: "user", 
          content: [
            { type: "text", text: "Here is a visual mockup of the theme you just generated. Please critique the aesthetic appeal. If the colours are dull, or if the dark mode is ugly/muddy, fix it. Output your critique followed by the new, finalized SeedPalette JSON wrapped in ```json blocks." },
            { type: "image_url", image_url: { url: mockUrl } }
          ]
        }
      ];
      
      const refinementStream = await streamThemeManifest(provider, refinementMessages, opts.thinking, true);
      
      // The reasoning tokens and content chunks are already being printed by streamThemeManifest
      process.stdout.write("\n"); // Ensure newline after streaming refinement

      try {
        const jsonMatch = refinementStream.rawManifest.match(/```json\n([\s\S]*?)\n```/) || refinementStream.rawManifest.match(/{[\s\S]*?}/);
        const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : refinementStream.rawManifest;
        const refinedSeed = JSON.parse(jsonStr);
        if (refinedSeed.base_color && refinedSeed.accent_color && typeof refinedSeed.primary_hue === "number") {
          seed = refinedSeed;
          console.log(pc.green("Theme refined via vision feedback loop."));
        }
      } catch (e) {
        console.log(pc.yellow(`Vision refinement failed to parse. Using original seed. Error: ${e instanceof Error ? e.message : String(e)}`));
      }
    }

    // Use our local palette generator
    let palette = generatePalette({
      ...seed,
      mode: opts.paletteMode !== "balanced" ? opts.paletteMode : seed.mode || "balanced"
    });
    
    if (opts.debugPalette) {
      console.log(pc.magenta("\n--- Debug Palette ---"));
      console.log("Seed:", JSON.stringify(seed, null, 2));
      const score = computeMaterialScore(palette);
      console.log("Material Score:", JSON.stringify(score, null, 2));
    }

    // Auto-rebalance for accessibility
    palette = rebalancePalette(palette);
    
    const manifest = mapPaletteToManifest(opts.name ?? normalizeGeneratedName(seed.name), palette);
    manifest.name = variationCount > 1 ? `${manifest.name} ${variationIndex}` : manifest.name;

    const checks = await runContrastChecks(manifest);

    if (!bestResult || checks.filter((c) => !c.pass).length < bestResult.checks.filter((c) => !c.pass).length) {
      bestResult = { manifest, checks, stream };
    }

    const failed = checks.filter((c) => !c.pass);
    if (failed.length === 0 || attempt === MAX_RETRIES) break;
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
  
  let imageColors: Rgb[] = [];
  if (opts.images.length > 0) {
    console.log(pc.cyan(`Extracting semantic colours from ${opts.images.length} image(s)...`));
    for (const img of opts.images) {
      try {
        const pal = await extractSemanticColors(img);
        imageColors.push(...pal.shadows, ...pal.midtones, ...pal.highlights, ...pal.accents);
      } catch (e) {
        console.log(pc.yellow(`Failed to extract colours from ${img}: ${e}`));
      }
    }
    // Limit to 10 representative colors
    imageColors = imageColors.slice(0, 10);
  }

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
  } else if (Object.keys(opts.explicitColors).length > 0) {
    // Direct color mode — no LLM call needed
    const hasColors = Object.keys(opts.explicitColors).length > 0;
    console.log(pc.cyan(`Building theme from explicit colors (${Object.keys(opts.explicitColors).length} provided)...`));
    if (opts.explicitColors.frame) {
      console.log(pc.dim(`  frame: ${opts.explicitColors.frame}`));
    }

    const name = opts.name ?? "custom-theme";
    const manifest = buildManifestFromColors(name, opts.explicitColors);
    const validationErrors = validateManifest(manifest);
    if (validationErrors.length > 0) {
      throw new Error(`Manifest validation failed: ${validationErrors.join("; ")}`);
    }

    const checks = await runContrastChecks(manifest);
    printContrastTable(checks);

    const result = await writeThemeArtifacts(provider, manifest, checks, null, false, "", "", opts);
    results.push(result);
  } else {
    for (let vi = 1; vi <= opts.variations; vi++) {
      if (opts.variations > 1) console.log(pc.cyan(`\nGenerating variation ${vi}/${opts.variations}...`));
      const { manifest, checks, stream } = await generateTheme(provider, opts.prompt, opts, vi, opts.variations, mode, imageOutcome, imageColors);
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