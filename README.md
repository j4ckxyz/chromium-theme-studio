# Chromium Theme Studio

**Generate polished, professional browser themes with depth, diversity, and guaranteed accessibility.**

Chromium Theme Studio is an advanced CLI tool that generates Chromium and Firefox browser themes using AI. Unlike simple color generators, it uses a **Structured Palette Engine** to simulate depth, ensure color harmony, and enforce WCAG contrast compliance.

---

## Table of Contents

- [Install](#install)
- [The Structured Palette Engine](#the-structured-palette-engine)
- [Make Your First Theme](#make-your-first-theme)
- [Best Practices (Get the Best Results)](#best-practices)
- [Commands](#commands)
- [Load Theme in Browser](#load-theme-in-browser)

---

## Install

```bash
git clone https://github.com/j4ckxyz/chromium-theme-studio.git
cd chromium-theme-studio
bun install
```

Requirements: [Bun](https://bun.sh) runtime and an API key from an OpenAI-compatible provider (OpenRouter, Groq, etc.).

---

## The Structured Palette Engine

Current browser themes often feel "flat" or "muddy." This tool solves that by using a multi-stage generation process:

1.  **Seed Generation**: The AI identifies the core "soul" of your prompt (Primary Hue, Base Color, Accent Color).
2.  **Gradient Simulation**: Our engine generates an internal palette that simulates depth using **Perceptual Stepping** and **Hue Drift** (5–12° shifts) across UI surfaces (Frame → Inactive Frame → Toolbar).
3.  **Diversity Enforcement**: Unless you ask for monochrome, the engine ensures at least 3 distinct hue families (Neutral, Primary Accent, Environmental Tints).
4.  **Accessibility Gate**: Every theme passes through a mandatory WCAG contrast check. If a combination (like tab text on a toolbar) fails, the engine **auto-rebalances** the colors locally without losing the theme's vibe.

---

## Make Your First Theme

### 1. Set Your API Key

Create a `.ctm.json` file in the project directory:

```bash
cat > .ctm.json << 'EOF'
{
  "defaultProvider": {
    "url": "https://openrouter.ai/api/v1",
    "key": "env:OPENROUTER_API_KEY",
    "model": "anthropic/claude-3.7-sonnet"
  }
}
EOF
```

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
```

### 2. Generate with Palette Controls

```bash
# Default balanced mode
bun run src/index.ts generate "neon synthwave"

# High-energy vibrant mode
bun run src/index.ts generate "electric citrus" --palette-mode vibrant

# Minimalist muted mode
bun run src/index.ts generate "nordic slate" --palette-mode muted
```

### 3. See the "Math" behind the Design

Use `--debug-palette` to see the internal mappings and "Material Score":

```bash
bun run src/index.ts generate "royal velvet" --debug-palette
```

---

## Best Practices

To get "Designed" results rather than "Averaged" results, follow these tips:

### ✅ DO:
*   **Use Emotional Keywords**: Instead of "blue and grey," try "melancholic winter," "clinical laboratory," or "energizing sunrise."
*   **Specify Materials**: Use words like "frosted glass," "brushed aluminum," "velvet," or "ink."
*   **Use Palette Modes**: If your prompt is "rainbow," use `--palette-mode vibrant`. If it's "minimalist," use `--palette-mode muted`.
*   **Use Image References**: The `-i` flag now extracts **semantic regions** (shadows, midtones, accents) rather than just the average color.

### ❌ DON'T:
*   **Don't over-specify hex codes**: The AI is better at picking harmonies than humans are at guessing hex values. Let the AI pick the "Seed" and the engine will handle the "Depth."
*   **Don't worry about contrast in your prompt**: The engine's **Accessibility Gate** will fix it for you. Focus on the *vibe*.
*   **Don't use generic prompts**: "a nice theme" will give you a generic result. "Cyberpunk 2077 Night City, rain-slicked asphalt, pink neon reflections" will give you a masterpiece.

### Examples

| Goal | Prompt | Flags |
|---|---|---|
| **Professional** | "High-end obsidian luxury, gold accents, dark" | `--palette-mode balanced` |
| **Playful** | "Strawberry bubblegum and mint sorbet" | `--palette-mode vibrant` |
| **Focus** | "Focus mode, zen garden, stone and moss" | `--palette-mode muted` |
| **Dynamic** | "Deep space nebula, cosmic dust, violet" | `-v 4 --preview-sheet` |

---

## Commands

| Flag | Description |
|---|---|
| `--palette-mode <m>` | `balanced` (default), `vibrant`, `muted`, `monochrome` |
| `--debug-palette` | Show internal palette mapping, material scores, and contrast results |
| `-i, --image <path>` | Extract semantic colors (shadows, midtones, highlights, accents) |
| `-v, --variations <n>` | Generate 1–12 unique variations of the same prompt |
| `-w, --web-store` | Generate Chrome Web Store icons and listing drafts |
| `-F, --firefox` | Generate a Firefox WebExtension manifest |

---

## Project Structure

```
src/
  palette.ts         # The Structured Palette Engine (Logic & Math)
  image-extractor.ts # Semantic image analysis (using pngjs)
  manifest.ts        # Theme validation & HSL/RGB conversion helpers
  index.ts           # CLI & LLM Prompt Orchestration
  provider.ts        # OpenAI-compatible API bridge
```

---

## Troubleshooting

**Theme looks "flat"?**
Try a different `--palette-mode`. `vibrant` increases hue drift, while `balanced` focuses on smooth luminance steps.

**Colors didn't match my image perfectly?**
The tool extracts colors as *inspiration* for the Seed. It then builds a design-compliant palette around them to ensure the theme works in a real browser.

**Contrast is too high/low?**
The engine targets WCAG AA. If you need something specific, you can use the direct color flags:
`ctm generate --color.frame=#000000 --color.tab-text=#ffffff`
