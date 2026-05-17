import { PNG } from "pngjs";
import { type Rgb, rgbToHsl } from "./manifest.js";

export type ImagePalette = {
  shadows: Rgb[];
  midtones: Rgb[];
  highlights: Rgb[];
  accents: Rgb[];
};

export async function extractSemanticColors(imagePath: string): Promise<ImagePalette> {
  const bytes = await Bun.file(imagePath).arrayBuffer();
  const png = PNG.sync.read(Buffer.from(bytes));
  
  const shadows: Rgb[] = [];
  const midtones: Rgb[] = [];
  const highlights: Rgb[] = [];
  const accents: Rgb[] = [];
  
  const step = Math.max(1, Math.floor((png.width * png.height) / 5000)); // Sample ~5000 pixels

  for (let i = 0; i < png.data.length; i += 4 * step) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const a = png.data[i + 3];
    
    if (a < 128) continue; // Skip transparent
    
    const [h, s, l] = rgbToHsl(r, g, b);
    const rgb: Rgb = [r, g, b];
    
    if (s > 40 && l > 20 && l < 80) {
      accents.push(rgb);
    }
    
    if (l < 30) {
      shadows.push(rgb);
    } else if (l > 70) {
      highlights.push(rgb);
    } else {
      midtones.push(rgb);
    }
  }
  
  const getRepresentative = (colors: Rgb[], count: number): Rgb[] => {
    if (colors.length === 0) return [];
    // Sort by "vibrancy" or just pick evenly spaced
    return colors.sort((a, b) => rgbToHsl(...b)[1] - rgbToHsl(...a)[1]).slice(0, count);
  };

  return {
    shadows: getRepresentative(shadows, 3),
    midtones: getRepresentative(midtones, 3),
    highlights: getRepresentative(highlights, 3),
    accents: getRepresentative(accents, 5),
  };
}
