# Chromium Theme Studio

**Generate polished browser themes from a text prompt — with any LLM provider**

Chromium Theme Studio is a CLI tool that generates Chromium and Firefox browser themes using AI. Give it a description like `"warm sunset, orange and amber, dark background"` and it outputs a complete theme manifest, color-validated and ready to load.

---

## Table of Contents

- [Install](#install)
- [Make Your First Theme](#make-your-first-theme)
- [Commands](#commands)
- [Providers](#providers)
- [Config Profiles](#config-profiles)
- [Examples Catalog](#examples-catalog)
- [History](#history)
- [Load Theme in Browser](#load-theme-in-browser)

---

## Install

```bash
git clone https://github.com/j4ckxyz/chromium-theme-studio.git
cd chromium-theme-studio
bun install
```

Requirements: [Bun](https://bun.sh) (runtime), an API key from any OpenAI-compatible provider

---

## Make Your First Theme

### Step 1: Set Your API Key

Create a `.ctm.json` file in the project directory with your credentials:

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

Then export your key:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
```

> **Tip:** You can also pass the key directly via CLI (see [Providers](#providers) below), or copy `config.example.json` to `~/.config/ctm/config.json` for a persistent global setup.

### Step 2: Generate a Theme

```bash
bun run src/index.ts generate "warm sunset, orange and amber, dark background"
```

The CLI will:
1. Send your prompt to the AI model
2. Stream the model's reasoning to the terminal
3. Validate the generated theme colors
4. Write the theme to a folder

You'll see output like:

```
  ╔══════════════════════════════════════════════╗
  ║      Chromium Theme Studio v2              ║
  ╚══════════════════════════════════════════════╝

Contrast checks:
✅ | Tab text on toolbar | 4.2:1 | AA
✅ | Inactive tab text on frame | 2.8:1 | AA
✅ | Bookmark text on toolbar | 3.1:1 | AA
✅ | NTP text on background | 5.4:1 | AAA
✅ | NTP link on background | 3.2:1 | AA

Color summary:
  ████  #1a1218  frame
  ████  #252030  frame_inactive
  ████  #2a1f22  toolbar
  ████  #f5e0c0  tab_text
  ████  #c08060  tab_background_text
  ████  #e8c090  bookmark_text
  ████  #120d10  ntp_background
  ████  #f0e0c8  ntp_text
  ████  #ff9040  ntp_link

Theme written.
  ./warm-sunset-2
  Web store zip: ./warm-sunset-2-webstore.zip
```

### Step 3: Load It in Your Browser

**Chromium:**
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `warm-sunset-2` folder

**Firefox:**
1. Open `about:debugging`
2. Click **This Firefox**
3. Click **Load Temporary Add-on**
4. Select `warm-sunset-2/firefox-manifest.json`

---

## More Examples

### Name Your Theme

```bash
bun run src/index.ts generate "ocean waves, teal and white" --name "Ocean Drift"
```

This creates a folder called `ocean-drift/` instead of auto-generating a name.

### Generate Multiple Variations

Want 4 different takes on the same idea? Use `-v`:

```bash
bun run src/index.ts generate "electric candy, neon on dark" -v 4 --preview-sheet
```

This generates 4 candidate themes and writes an HTML preview sheet at `previews/`.

### Add Web Store Assets

Want a Chrome Web Store-ready icon, zip, and listing draft? Add `-w`:

```bash
bun run src/index.ts generate "midnight forest, deep green" -w
```

Outputs:
- `midnight-forest/icon-128.png` — gradient icon
- `midnight-forest-webstore.zip` — ready to upload
- `descriptions/midnight-forest.md` — listing copy

### Include a Reference Image

Pass a local file or URL to extract colors from:

```bash
bun run src/index.ts generate "the mood of this photo" -i ./sunset.jpg
```

### Re-process an Existing Theme

Modify an already-generated theme without regenerating colors:

```bash
bun run src/index.ts generate -f ./my-theme --name "My Theme Updated" -w
```

This re-runs the web store packaging and adds Firefox manifest.

### Use a Different Model

```bash
bun run src/index.ts generate "minimal monochrome" --provider-model gpt-4o
```

Or use a saved profile:

```bash
bun run src/index.ts generate "fast and cheap" -P groq
```

### Enable Thinking Mode

Some models support reasoning. Enable it with `--thinking`:

```bash
bun run src/index.ts generate "retro synthwave" --thinking=high
```

Supported levels: `xhigh`, `high`, `medium`, `low`, `minimal`, `none`, `off`.

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
| `--provider-url <url>` | API base URL |
| `--provider-key <key>` | API key |
| `--provider-model <model>` | Model ID |

---

## Providers

Chromium Theme Studio works with any **OpenAI-compatible API**. Set credentials in any of these ways:

### Option 1: Environment Variables

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
export OPENROUTER_MODEL=anthropic/claude-3.7-sonnet
```

### Option 2: Config File

Copy the example and edit:

```bash
cp config.example.json ~/.config/ctm/config.json
```

Then edit `~/.config/ctm/config.json`. The `key` field supports `env:VARNAME` syntax to reference env vars without hardcoding secrets.

### Option 3: CLI Flags (per-run)

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

---

## Config Profiles

Save provider configurations and switch between them quickly.

```bash
# Add a profile
ctm config --add groq \
  --url https://api.groq.com/openai/v1 \
  --key $GROQ_API_KEY \
  --model llama-3.3-70b-versatile \
  --default

# Use it
bun run src/index.ts generate "my theme" -P groq
```

### Config File Locations

- **Local:** `.ctm.json` (in project directory — overrides global)
- **Global:** `~/.config/ctm/config.json`

---

## Examples Catalog

See real themes with the exact commands used to generate them.

```bash
# List all examples
bun run src/index.ts examples

# By name
bun run src/index.ts examples electric-zest

# By tag
bun run src/index.ts examples dark
bun run src/index.ts examples warm
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

Every generation is logged. Track what you've made, which models performed best, and costs.

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

config.example.json    # Example config with all provider presets
```

---

## Troubleshooting

**"Missing OPENROUTER_API_KEY"**
Set your API key: `export OPENROUTER_API_KEY=sk-or-...` or add it to `.ctm.json`.

**"Model not found"**
Check the model name. For OpenRouter, use the full ID like `anthropic/claude-3.7-sonnet`. For Groq, try `llama-3.3-70b-versatile`.

**Theme looks wrong in the browser**
Chromium caches themes aggressively. After loading, open `chrome://settings/appearance` and switch to a different theme, then back to yours.

**Contrast checks failing**
The CLI retries automatically up to 2 times with accessibility-focused feedback. If checks still fail, the theme is still written — you can iterate with `--from` to tweak it.