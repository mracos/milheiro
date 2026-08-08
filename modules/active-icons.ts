import { defineWxtModule } from 'wxt/modules';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Generates the "active" (color) icon set into the build output. auto-icons only
// makes one variant (wxt-dev/wxt#1544), so we run its own dep (sharp) here. As a
// module hook (not a config hook) it runs in module-registration order — list it
// BEFORE wxt-module-safari-xcode so the icons are in place before the converter
// packages them into the .app.
//
// TODO: once wxt-dev/wxt#1544 (auto-icons variants) ships, delete this whole
// module and just declare the active variant in autoIcons config instead.
export default defineWxtModule({
  name: 'active-icons',
  setup(wxt) {
    wxt.hook('build:done', async (wxt2) => {
      const sharp = (await import('sharp')).default;
      const svg = await readFile('assets/icon.svg');
      const dir = join(wxt2.config.outDir, 'icon-active');
      await mkdir(dir, { recursive: true });
      await Promise.all(
        [16, 32, 48, 128].map(async (size) =>
          writeFile(join(dir, `${size}.png`), await sharp(svg).resize(size, size).png().toBuffer()),
        ),
      );
    });
  },
});
