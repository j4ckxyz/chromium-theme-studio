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

const SYSTEM_PROMPT = `You are a browser theme designer. Given a colour palette description or mood, you output ONLY a valid JSON manifest for a Chromium browser theme. No markdown, no explanation, no backticks — raw JSON only.

The JSON must follow this exact structure:

{
  "manifest_version": 3,
  "name": "<theme name>",
  "version": "1.0",
  "theme": {
    "colors": {
      "frame": [R, G, B],
      "frame_inactive": [R, G, B],
      "toolbar": [R, G, B],
      "tab_text": [R, G, B],
      "tab_background_text": [R, G, B],
      "bookmark_text": [R, G, B],
      "ntp_background": [R, G, B],
      "ntp_text": [R, G, B],
      "ntp_link": [R, G, B],
      "button_background": [R, G, B, A]
    },
    "tints": {
      "buttons": [H, S, L],
      "frame": [H, S, L],
      "frame_inactive": [H, S, L]
    },
    "properties": {
      "ntp_background_alignment": "bottom",
      "ntp_logo_alternate": 1
    }
  }
}

Rules:
- All RGB values must be integers 0–255
- All RGBA values: RGB integers 0–255, A float 0.0–1.0
- All tint values: floats -1.0 to 1.0 (use -1 to mean "no change")
- The theme must look clean and polished
- Ensure strong contrast between tab_text and toolbar, and between tab_background_text and frame
- The theme should work well in both light and dark OS modes
- Do NOT include any images keys
- Do NOT output anything other than the raw JSON object`;

const EXAMPLE_THEME = `Dark ocean theme:
{
  "manifest_version": 3,
  "name": "Deep Ocean",
  "version": "1.0",
  "theme": {
    "colors": {
      "frame": [15, 30, 50],
      "frame_inactive": [20, 38, 60],
      "toolbar": [22, 44, 70],
      "tab_text": [220, 235, 255],
      "tab_background_text": [140, 165, 190],
      "bookmark_text": [200, 220, 245],
      "ntp_background": [10, 20, 38],
      "ntp_text": [210, 225, 245],
      "ntp_link": [80, 160, 240],
      "button_background": [255, 255, 255, 0.0]
    },
    "tints": {
      "buttons": [-1, -1, 0.9],
      "frame": [-1, -1, -1],
      "frame_inactive": [-1, -1, -1]
    },
    "properties": {
      "ntp_background_alignment": "bottom",
      "ntp_logo_alternate": 1
    }
  }
}`;

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

function usage(): never {
  console.error(pc.red("Usage: bun run generate.ts \"your theme description\""));
  process.exit(1);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "theme";
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

async function streamThemeManifest(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY in environment");
  }

  if (!model) {
    throw new Error("Missing OPENROUTER_MODEL in environment");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "theme-gen",
      "X-Title": "theme-gen",
    },
    body: JSON.stringify({
      model,
      stream: true,
      reasoning: { effort: "high" },
      messages,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${body}`);
  }

  if (!response.body) {
    throw new Error("OpenRouter response body is empty");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let contentBuffer = "";

  const processSseLine = (rawLine: string) => {
    const line = rawLine.trim();
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

    const delta = parsed?.choices?.[0]?.delta;
    const reasoningDetails = delta?.reasoning_details;
    const content = delta?.content;

    if (Array.isArray(reasoningDetails)) {
      for (const detail of reasoningDetails) {
        const chunk =
          (typeof detail === "object" && detail !== null && "text" in detail
            ? (detail as { text?: unknown }).text
            : undefined) ??
          (typeof detail === "string" ? detail : "");

        if (typeof chunk === "string" && chunk.length > 0) {
          process.stdout.write(pc.dim(`🤔 ${chunk}\n`));
        }
      }
    } else if (typeof reasoningDetails === "object" && reasoningDetails !== null) {
      const chunk = (reasoningDetails as { text?: unknown }).text;
      if (typeof chunk === "string" && chunk.length > 0) {
        process.stdout.write(pc.dim(`🤔 ${chunk}\n`));
      }
    } else if (typeof reasoningDetails === "string" && reasoningDetails.length > 0) {
      process.stdout.write(pc.dim(`🤔 ${reasoningDetails}\n`));
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
      const isDone = processSseLine(rawLine);
      if (isDone) {
        return contentBuffer;
      }
    }
  }

  if (buffer.length > 0) {
    const isDone = processSseLine(buffer);
    if (isDone) {
      return contentBuffer;
    }
  }

  return contentBuffer;
}

async function main(): Promise<void> {
  const input = Bun.argv.slice(2).join(" ").trim();
  if (!input) {
    usage();
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${EXAMPLE_THEME}\n\nTheme request: ${input}`,
    },
  ];

  let rawManifest = "";
  try {
    rawManifest = await streamThemeManifest(messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(pc.red(`Streaming failed: ${message}`));
    process.exit(1);
  }

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
}

await main();
