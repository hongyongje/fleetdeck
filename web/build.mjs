// Builds web/dist with esbuild. Uses the native esbuild when available and falls back to
// esbuild-wasm (pure JS) on machines where native binaries cannot run.
// node web/build.mjs
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
let esbuild;
if (process.env.FD_WASM !== '1') {
  try { esbuild = await import('esbuild'); await esbuild.transform('1', {}); } catch { esbuild = undefined; }
}
if (!esbuild) { esbuild = await import('esbuild-wasm'); console.log('(esbuild-wasm 사용)'); }

mkdirSync(join(out, 'assets'), { recursive: true });
await esbuild.build({
  entryPoints: [join(here, 'src', 'main.tsx')],
  bundle: true, minify: true, format: 'esm', target: 'es2022',
  jsx: 'automatic', loader: { '.ts': 'ts', '.tsx': 'tsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  outdir: join(out, 'assets'), entryNames: 'app', logLevel: 'info',
});
const html = readFileSync(join(here, 'index.html'), 'utf8')
  .replace('<script type="module" src="/src/main.tsx"></script>', '<link rel="stylesheet" href="/assets/app.css" /><script type="module" src="/assets/app.js"></script>');
writeFileSync(join(out, 'index.html'), html);
console.log('web/dist 생성 완료');
