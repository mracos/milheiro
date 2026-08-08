// Generates the "active" (color) icon set into public/icon-active/ from the same
// SVG source, using sharp (an auto-icons dependency). Runs before every build so
// WXT copies them as public assets (before the Safari converter). The default
// dormant/grayscale set is handled by @wxt-dev/auto-icons.
import sharp from 'sharp';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const SIZES = [16, 32, 48, 128];
const svg = await readFile('assets/icon.svg');
await mkdir('public/icon-active', { recursive: true });
await Promise.all(
  SIZES.map(async (size) =>
    writeFile(
      `public/icon-active/${size}.png`,
      await sharp(svg).resize(size, size).png().toBuffer(),
    ),
  ),
);
console.log('generated public/icon-active/', SIZES.join(', '));
