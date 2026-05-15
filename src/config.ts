import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ProviderConfig = {
  url: string;
  key: string;
  model: string;
  headers?: Record<string, string>;
};

export type DefaultsConfig = {
  variations?: number;
  thinking?: string | null;
  webStore?: boolean;
  screenshots?: boolean;
  previewSheet?: boolean;
  firefox?: boolean;
};

export type CtmConfig = {
  defaultProvider?: ProviderConfig;
  profiles?: Record<string, ProviderConfig>;
  defaults?: DefaultsConfig;
};

export type ResolvedProvider = {
  url: string;
  key: string;
  model: string;
  headers: Record<string, string>;
};

const CONFIG_DIR = path.join(os.homedir(), ".config", "ctm");
const GLOBAL_CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const LOCAL_CONFIG_PATH = path.resolve(process.cwd(), ".ctm.json");

function resolveEnv(value: string): string {
  if (value.startsWith("env:") || value.startsWith("$")) {
    const envKey = value.replace(/^(env:|\$)/, "");
    const envValue = process.env[envKey];
    if (!envValue) {
      throw new Error(`Environment variable ${envKey} is not set (referenced in config)`);
    }
    return envValue;
  }
  return value;
}

export function resolveProvider(config: ProviderConfig): ResolvedProvider {
  return {
    url: config.url,
    key: resolveEnv(config.key),
    model: config.model,
    headers: config.headers ?? {},
  };
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function loadConfig(): Promise<CtmConfig> {
  const local = await readJsonIfExists<CtmConfig>(LOCAL_CONFIG_PATH);
  const global = await readJsonIfExists<CtmConfig>(GLOBAL_CONFIG_PATH);
  return {
    ...global,
    ...local,
    profiles: {
      ...global?.profiles,
      ...local?.profiles,
    },
    defaults: {
      ...global?.defaults,
      ...local?.defaults,
    },
  };
}

export async function saveGlobalConfig(config: CtmConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export async function saveLocalConfig(config: CtmConfig): Promise<void> {
  await fs.writeFile(LOCAL_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function getProviderFromConfig(
  config: CtmConfig,
  profileName?: string,
  cliUrl?: string,
  cliKey?: string,
  cliModel?: string
): ResolvedProvider {
  let source: ProviderConfig | undefined;

  if (cliUrl || cliKey || cliModel) {
    source = {
      url: cliUrl ?? config.defaultProvider?.url ?? "https://openrouter.ai/api/v1",
      key: cliKey ?? config.defaultProvider?.key ?? "",
      model: cliModel ?? config.defaultProvider?.model ?? "",
    };
  } else if (profileName) {
    const profile = config.profiles?.[profileName];
    if (!profile) {
      const available = config.profiles ? Object.keys(config.profiles).join(", ") : "none";
      throw new Error(`Profile "${profileName}" not found. Available profiles: ${available}`);
    }
    source = profile;
  } else {
    source = config.defaultProvider;
  }

  // Fallback to env vars if nothing in config
  const url = source?.url ?? process.env.OPENROUTER_API_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1";
  const key = source?.key ?? process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  const model = source?.model ?? process.env.OPENROUTER_MODEL ?? process.env.OPENAI_MODEL ?? "";
  const headers = source?.headers ?? {};

  if (!key) {
    throw new Error(
      "No API key configured. Set it via:\n" +
        "  --provider-key <key>\n" +
        "  --profile <profile>\n" +
        "  env: OPENROUTER_API_KEY or OPENAI_API_KEY\n" +
        "  config: defaultProvider.key or profiles.<name>.key"
    );
  }
  if (!model) {
    throw new Error(
      "No model configured. Set it via:\n" +
        "  --provider-model <model>\n" +
        "  --profile <profile>\n" +
        "  env: OPENROUTER_MODEL or OPENAI_MODEL\n" +
        "  config: defaultProvider.model or profiles.<name>.model"
    );
  }

  return resolveProvider({ url, key, model, headers });
}

export type ThinkingEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
export const THINKING_EFFORTS: ThinkingEffort[] = ["xhigh", "high", "medium", "low", "minimal", "none"];

export function parseThinkingValue(raw: string | undefined): { effort: ThinkingEffort } | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "" || value === "true" || value === "on" || value === "auto") {
    return { effort: "high" };
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
  throw new Error(`Invalid thinking level: ${raw}. Expected: ${THINKING_EFFORTS.join("|")}|off`);
}
