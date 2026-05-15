export type ExampleEntry = {
  slug: string;
  name: string;
  description: string;
  prompt: string;
  flags: string[];
  tags: string[];
};

export const EXAMPLES: ExampleEntry[] = [
  {
    slug: "obsidian-dusk",
    name: "Obsidian Dusk",
    description: "Deep dark theme with purple undertones and cool accents",
    prompt: "obsidian dusk, deep purples and cool blues, dark background, subtle glow",
    flags: ["--thinking=high", "--web-store"],
    tags: ["dark", "purple", "cool"],
  },
  {
    slug: "morning-linen",
    name: "Morning Linen",
    description: "Soft warm light theme with cream and tan tones",
    prompt: "morning linen, warm cream and tan, off-white background, gentle warmth",
    flags: ["--web-store"],
    tags: ["light", "warm", "minimal"],
  },
  {
    slug: "electric-zest",
    name: "Electric Zest",
    description: "Vibrant citrus and neon accents on a dark canvas",
    prompt: "electric zest, sour candy neon, lime and tangerine on dark graphite",
    flags: ["--variations", "3", "--preview-sheet", "--web-store"],
    tags: ["dark", "neon", "colorful"],
  },
  {
    slug: "midnight-meadow",
    name: "Midnight Meadow",
    description: "Muted forest greens and deep earth tones",
    prompt: "midnight meadow, deep forest greens, moss and bark brown, dark mode",
    flags: ["--thinking=high", "--web-store", "--screenshots"],
    tags: ["dark", "green", "nature"],
  },
  {
    slug: "velvet-ember",
    name: "Velvet Ember",
    description: "Rich burgundy and burnt orange warmth",
    prompt: "velvet ember, rich burgundy and burnt orange, warm dark background",
    flags: ["--variations", "2", "--web-store"],
    tags: ["dark", "warm", "red"],
  },
  {
    slug: "prismatic-celebration",
    name: "Prismatic Celebration",
    description: "Rainbow pride theme with balanced vibrant hues",
    prompt: "prismatic celebration, pride rainbow, balanced vibrant hues, light mode",
    flags: ["--web-store"],
    tags: ["light", "rainbow", "colorful"],
  },
  {
    slug: "sour-sorbet",
    name: "Sour Sorbet",
    description: "Sharp pink and mint contrast on white",
    prompt: "sour sorbet, sharp pink and mint, high contrast, light background",
    flags: ["--web-store"],
    tags: ["light", "pink", "fresh"],
  },
  {
    slug: "coastal-dawn",
    name: "Coastal Dawn",
    description: "Teal water and peach clouds at sunrise",
    prompt: "coastal dawn with teal water and peach clouds, soft light mode",
    flags: ["--variations", "6", "--preview-sheet", "--web-store"],
    tags: ["light", "blue", "warm"],
  },
];

export function findExampleBySlug(slug: string): ExampleEntry | undefined {
  return EXAMPLES.find((e) => e.slug === slug || e.slug === slug.toLowerCase().replace(/\s+/g, "-"));
}

export function findExamplesByTag(tag: string): ExampleEntry[] {
  const t = tag.toLowerCase();
  return EXAMPLES.filter((e) => e.tags.some((tag) => tag.toLowerCase() === t));
}

export function buildExampleCommand(example: ExampleEntry): string {
  const args = [...example.flags, `"${example.prompt}"`];
  return `ctm generate ${args.join(" ")}`;
}

export function buildExampleCommandBun(example: ExampleEntry): string {
  const args = [...example.flags, `"${example.prompt}"`];
  return `bun run src/index.ts generate ${args.join(" ")}`;
}
