import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export type HistoryEntry = {
  id: string;
  timestamp: string;
  name: string;
  slug: string;
  prompt: string;
  flags: string[];
  outputDir: string;
  command: string;
  provider: { url: string; model: string };
  success: boolean;
  errors?: string[];
  durationMs?: number;
  generationId?: string;
  tokens?: { prompt?: number; completion?: number; total?: number };
};

export type HistoryStore = {
  version: number;
  entries: HistoryEntry[];
};

const HISTORY_FILE = path.join(os.homedir(), ".config", "ctm", "history.json");

export async function loadHistory(): Promise<HistoryStore> {
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf-8");
    return JSON.parse(raw) as HistoryStore;
  } catch {
    return { version: 1, entries: [] };
  }
}

export async function saveHistory(store: HistoryStore): Promise<void> {
  await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true });
  await fs.writeFile(HISTORY_FILE, JSON.stringify(store, null, 2) + "\n");
}

export async function addHistoryEntry(entry: Omit<HistoryEntry, "id" | "timestamp">): Promise<void> {
  const store = await loadHistory();
  store.entries.unshift({
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  });
  // Keep last 500 entries
  if (store.entries.length > 500) store.entries = store.entries.slice(0, 500);
  await saveHistory(store);
}

export async function getHistoryEntries(limit = 50, filter?: {
  success?: boolean;
  slug?: string;
  search?: string;
}): Promise<HistoryEntry[]> {
  const store = await loadHistory();
  let entries = store.entries;

  if (filter?.success !== undefined) {
    entries = entries.filter((e) => e.success === filter.success);
  }
  if (filter?.slug) {
    entries = entries.filter((e) => e.slug === filter.slug);
  }
  if (filter?.search) {
    const q = filter.search.toLowerCase();
    entries = entries.filter((e) =>
      e.name.toLowerCase().includes(q) || e.prompt.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q)
    );
  }

  return entries.slice(0, limit);
}

export async function getHistoryStats(): Promise<{
  total: number;
  successful: number;
  failed: number;
  byModel: Record<string, number>;
  byTag: Record<string, number>;
}> {
  const store = await loadHistory();
  const total = store.entries.length;
  const successful = store.entries.filter((e) => e.success).length;
  const failed = total - successful;
  const byModel: Record<string, number> = {};
  const byTag: Record<string, number> = {};

  for (const entry of store.entries) {
    const model = entry.provider.model;
    byModel[model] = (byModel[model] ?? 0) + 1;
    for (const flag of entry.flags) {
      if (flag.startsWith("--")) {
        const tag = flag.slice(2).split("=")[0];
        byTag[tag] = (byTag[tag] ?? 0) + 1;
      }
    }
  }

  return { total, successful, failed, byModel, byTag };
}