// Bundles the TS entry points to plain JS the browser loads, and copies the
// static assets (manifest, popup.html, badge.css) into dist/. Load the
// extension unpacked from dist/.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');

const STATIC = [
  ['manifest.json', 'manifest.json'],
  ['src/popup.html', 'popup.html'],
  ['src/badge.css', 'badge.css'],
  ['src/icons', 'icons'],
];

function copyStatic() {
  for (const [from, to] of STATIC) cpSync(from, `dist/${to}`, { recursive: true });
}

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

const options = {
  entryPoints: ['src/content.ts', 'src/popup.ts', 'src/inject.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: 'copy-static',
        setup(build) {
          build.onEnd(() => copyStatic());
        },
      },
    ],
  });
  await ctx.watch();
  console.log('watching… (dist/)');
} else {
  await esbuild.build(options);
  copyStatic();
  console.log('built dist/');
}
