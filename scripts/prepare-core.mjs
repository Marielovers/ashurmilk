import { access, mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

// The official host publishes Core for hosting use. Do not bundle its proprietary source in this archive.
const url = 'https://cubism.live2d.com/sdk-web/core/06/live2dcubismcore.min.js';
const destination = resolve('public/vendor/live2dcubismcore.min.js');
try {
  const buffer = await readFile(destination);
  if (buffer.length > 100_000) {
    console.log('[Live2D] Cubism Core 06 already present.');
    process.exit(0);
  }
} catch { /* first install */ }

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length < 100_000 || !data.toString('utf8', 0, 2000).includes('Live2D')) {
    // Versions differ in the banner; length and JavaScript presence matter most.
    if (data.length < 100_000 || data[0] === 60) throw new Error('Unrecognized Core script');
  }
  await mkdir(resolve('public/vendor'), { recursive: true });
  await writeFile(`${destination}.tmp`, data);
  await rename(`${destination}.tmp`, destination);
  console.log(`[Live2D] Cubism Core 06 downloaded from official source (${data.length} bytes).`);
} catch (error) {
  // npm install should still finish; the browser will try the official host directly.
  console.warn(`[Live2D] Could not pre-download Cubism Core (${error.message}).`);
  console.warn('[Live2D] With an internet connection, run: npm run postinstall');
  console.warn('[Live2D] Or copy Core 6.x from the official Cubism SDK for Web to public/vendor/live2dcubismcore.min.js');
}
