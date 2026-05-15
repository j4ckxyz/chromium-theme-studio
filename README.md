# Chromium Theme Studio

**Generate polished browser themes from a text prompt — with any LLM provider**

Chromium Theme Studio is a CLI tool that generates Chromium and Firefox browser themes using AI. Give it a description like `"warm sunset, orange and amber, dark background"` and it outputs a complete theme manifest, color-validated and ready to load.

---

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Providers](#providers)
- [Config Profiles](#config-profiles)
- [Examples Catalog](#examples-catalog)
- [History](#history)
- [Load Theme in Browser](#load-theme-in-browser)

---

## Install

```bash
git clone <repo-url>
cd chromium-theme-maker
bun install
```

Requirements: [Bun](https://bun.sh) (runtime), an OpenAI-compatible API key

---

## Quick Start

```bash
# Generate a theme from a text prompt
bun run src/index.ts generate "warm sunset, orange and amber, dark background"

# With Chrome Web Store assets
bun run src/index.ts generate "coastal dawn, teal and peach" --web-store

# Multiple variations
bun run src/index.ts generate "neon city vibes" -v 6 --preview-sheet

# Use a specific model
bun run src/index.ts generate "minimal monochrome" --provider-model anthropic/claude-sonnet-4
```

---

## Commands

| Command | Description |
|---|---|
| `ctm generate "prompt..."` | Generate one or more themes |
| `ctm examples` | Browse example themes with exact regeneration commands |
| `ctm history` | View your generation history |
| `ctm config` | Manage provider profiles |
| `ctm -h` | Show help |

### Generate Options

| Flag | Description |
|---|---|
| `-n, --name <name>` | Set output folder and theme name |
| `-v, --variations <n>` | Generate 1–12 variations in one run |
| `-w, --web-store` | Generate Chrome Web Store icon, zip, and listing drafts |
| `-s, --screenshots` | Capture browser screenshots (macOS only) |
| `-p, --preview-sheet` | Write HTML comparison sheet for all variations |
| `-F, --firefox` | Also generate a Firefox WebExtension manifest |
| `-i, --image <path>` | Reference image for palette inspiration |
| `-f, --from <path>` | Re-process an existing theme folder |
| `--thinking[=<level>]` | Enable reasoning (xhigh/high/medium/low/minimal/none/off) |
| `-P, --profile <name>` | Use a saved provider profile |
| `--provider-url <url>` | API base URL (e.g. `https://api.groq.com/openai/v1`) |
| `--provider-key <key>` | API key |
| `--provider-model <model>` | Model ID (e.g. `gpt-4o`, `llama-3.3-70b-versatile`) |

### Examples

```bash
# Basic
bun run src/index.ts generate "deep forest greens, dark mode"

# Explicit name and web store assets
bun run src/index.ts generate "midnight meadow" --name "Midnight Meadow" --web-store

# Multiple variations with preview sheet
bun run src/index.ts generate "electric candy" -v 6 -p --web-store

# From existing theme
bun run src/index.ts generate -f ./my-theme --screenshots

# Reasoning mode
bun run src/index.ts generate "minimal monochrome" --thinking=high
```

### History

```bash
ctm history                    # Recent generations
ctm history --stats           # Top models, most-used flags
ctm history --search sunset    # Search by prompt or theme name
ctm history --limit 50         # Show more entries
```

### Config

```bash
ctm config                     # List current profiles
ctm config --add my-groq \
  --url https://api.groq.com/openai/v1 \
  --key $GROQ_API_KEY \
  --model llama-3.3-70b-versatile \
  --default

# Use a saved profile
bun run src/index.ts generate "my theme" -P my-groq
```

---

## Providers

Chromium Theme Studio works with any **OpenAI-compatible API**. Set credentials in any of these ways:

### 1. Environment Variables

```bash
export OPENROUTER_API_KEY=sk-or-...
export OPENROUTER_MODEL=anthropic/claude-3.7-sonnet
export OPENROUTER_API_BASE_URL=https://openrouter.ai/api/v1
```

### 2. Config File

Copy the example and edit:

```bash
cp config.example.json ~/.config/ctm/config.json
```

Then edit `~/.config/ctm/config.json`. See [Config Profiles](#config-profiles) below.

### 3. CLI Flags (per-run)

```bash
bun run src/index.ts generate "my theme" \
  --provider-url https://api.groq.com/openai/v1 \
  --provider-key $GROQ_API_KEY \
  --provider-model llama-3.3-70b-versatile
```

### Provider Quick Reference

| Provider | URL | Model Example | Env Var |
|---|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | `anthropic/claude-3.7-sonnet` | `OPENROUTER_API_KEY` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` | `OPENAI_API_KEY` |
| Azure OpenAI | `https://YOUR_RESOURCE.openai.azure.com/v1` | `gpt-4o` | `AZURE_OPENAI_KEY` |
| Ollama | `http://localhost:11434/v1` | `llama3` | `OLLAMA_API_KEY` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| Anthropic Bedrock | `https://bedrock-runtime.us-east-1.amazonaws.com/...` | `anthropic.claude-3-7-sonnet-...` | `AWS_ACCESS_KEY_ID` |
| Vertex AI | `https://us-central1-aiplatform.googleapis.com/...` | `claude-3-7-sonnet@...` | `VERTEX_AI_TOKEN` |

> **Note:** Provider configs can reference env vars using `env:VARNAME` syntax. Example: `"key": "env:OPENROUTER_API_KEY"`. This keeps secrets out of config files.

---

## Config Profiles

Profiles let you save provider configurations and switch between them quickly.

### Config File Locations

- **Local:** `.ctm.json` (in your project directory — overrides global)
- **Global:** `~/.config/ctm/config.json`

### Profile Structure

```json
{
  "defaultProvider": {
    "url": "https://openrouter.ai/api/v1",
    "key": "env:OPENROUTER_API_KEY",
    "model": "anthropic/claude-3.7-sonnet"
  },
  "profiles": {
    "groq": {
      "url": "https://api.groq.com/openai/v1",
      "key": "env:GROQ_API_KEY",
      "model": "llama-3.3-70b-versatile"
    }
  }
}
```

### Adding a Profile

```bash
ctm config --add groq \
  --url https://api.groq.com/openai/v1 \
  --key $GROQ_API_KEY \
  --model llama-3.3-70b-versatile \
  --default
```

Then use it with:

```bash
bun run src/index.ts generate "my theme" -P groq
```

---

## Examples Catalog

The `examples` command shows real themes with the exact commands used to generate them.

### Browse All Examples

```bash
bun run src/index.ts examples
```

### Filter by Name or Tag

```bash
# By slug
bun run src/index.ts examples obsidian-dusk

# By tag
bun run src/index.ts examples dark
bun run src/index.ts examples warm
```

### Example Output

```
── Electric Zest ──
  Description: Vibrant citrus and neon accents on a dark canvas
  Tags: dark, neon, colorful
  Prompt: "electric zest, sour candy neon, lime and tangerine on dark graphite"

  Command:
    ctm generate --variations 3 --preview-sheet --web-store "electric zest..."

  Flags: --variations 3 --preview-sheet --web-store
```

### Available Examples

| Slug | Description | Tags |
|---|---|---|
| `obsidian-dusk` | Deep dark theme with purple undertones | dark, purple, cool |
| `morning-linen` | Soft warm light theme with cream tones | light, warm, minimal |
| `electric-zest` | Vibrant neon citrus on dark graphite | dark, neon, colorful |
| `midnight-meadow` | Forest greens and earth tones | dark, green, nature |
| `velvet-ember` | Rich burgundy and burnt orange | dark, warm, red |
| `prismatic-celebration` | Rainbow pride theme | light, rainbow, colorful |
| `sour-sorbet` | Sharp pink and mint contrast | light, pink, fresh |
| `coastal-dawn` | Teal water and peach clouds | light, blue, warm |

---

## History

Every generation is logged to `~/.config/ctm/history.json`. Track what you've made, which models performed best, and how much it cost.

```bash
# Recent themes
ctm history

# Statistics
ctm history --stats

# Search
ctm history --search sunset --limit 20
```

---

## Load Theme in Browser

### Chromium

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the generated theme folder

### Firefox

1. Open `about:debugging`
2. Click **This Firefox**
3. Click **Load Temporary Add-on**
4. Select `firefox-manifest.json` in the theme folder

---

## Project Structure

```
src/
  index.ts       # CLI — all commands (generate, examples, history, config)
  config.ts      # Config loading, profile resolution, env var support
  manifest.ts    # Theme types, validation, color utilities
  provider.ts    # OpenAI-compatible API calls with streaming
  examples.ts    # Example catalog with commands
  history.ts     # JSON-based history store

config.example.json    # Example config with all provider profiles
```