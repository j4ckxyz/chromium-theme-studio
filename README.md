# Chromium Theme Studio

A Bun CLI that generates polished Chromium browser themes from a text prompt using the OpenRouter API.

## Quickstart

1. Install dependencies:

   ```bash
   bun install
   ```

2. Create your environment file:

   ```bash
   cp .env.example .env
   ```

3. Edit `.env` and set your OpenRouter credentials:

   ```env
   OPENROUTER_API_KEY=your_key_here
   OPENROUTER_MODEL=anthropic/claude-3.7-sonnet
   ```

4. Generate a theme:

   ```bash
   bun run generate.ts "warm sunset tones, orange and amber, dark background"
   ```

## Usage

```bash
bun run generate.ts "your theme description"
```

Show CLI help:

```bash
bun run generate.ts -h
```

Set an explicit theme/package name:

```bash
bun run generate.ts --name "Sunset Ember" "warm sunset tones, orange and amber, dark background"
```

Generate extra Chrome Web Store assets:

```bash
bun run generate.ts --web-store "warm sunset tones, orange and amber, dark background"
```

Re-process an existing generated theme folder/manifest:

```bash
bun run generate.ts --from "./sunset-ember" --web-store
bun run generate.ts --from "./sunset-ember/manifest.json" --name "Sunset Ember"
```

Optional reasoning mode:

```bash
bun run generate.ts --thinking=high "your theme description"
bun run generate.ts --thinking=off "your theme description"
```

Supported `--thinking` values: `xhigh`, `high`, `medium`, `low`, `minimal`, `none`, `off`.

- Use `--thinking=<level>` for reasoning-capable models.
- Use `--thinking=off` (or omit the flag) for non-reasoning mode.
- If reasoning is requested but rejected by the model/provider, the CLI automatically retries without reasoning.
- Use `--name` (or `-n`) to override the generated theme name used for output folder/zip naming.
- Use `--web-store` (or `-w`) to generate a 128x128 icon, update manifest `icons`, and create listing drafts.
- Use `--from` (or `-f`) to run web-store packaging against an existing theme without regenerating colors.

Examples:

```bash
bun run generate.ts "warm sunset tones, orange and amber, dark background"
bun run generate.ts "minimal monochrome, off-white and charcoal"
bun run generate.ts "deep forest, muted greens and browns"
```

## What it does

- Streams model reasoning to the terminal in dim grey with `🤔` prefix
- Accumulates JSON output silently, then validates the manifest
- Writes `manifest.json` to a slugified folder named after the generated theme
- Creates a ready-to-upload Chrome Web Store zip (`<theme-name>-webstore.zip`) containing manifest + icon assets
- With `--web-store`, creates `icon-128.png`, `descriptions/<theme-name>.md`, and `descriptions/<theme-name>.json`
- Prints key colors (`frame`, `toolbar`, `ntp_background`) as hex values
- Prints concise API stats: model, thinking mode, token counts, timing, generation ID, and cost (when available)

## Load in Chromium

1. Open Chromium and go to `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select the generated theme folder

## Included example

An example theme manifest is included at:

- `examples/sour-sorbet-l/manifest.json`
