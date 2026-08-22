// Fetch three@<version> core + the transitive closure of the addons the game imports,
// into assets/vendor/three/, preserving CDN directory structure.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, posix } from 'node:path';

const VERSION = process.argv[2] || '0.160.0';
const OUT = process.argv[3] || 'assets/vendor/three';
const BASE = `https://cdn.jsdelivr.net/npm/three@${VERSION}/`;

const ENTRIES = [
  'build/three.module.js',
  'examples/jsm/postprocessing/EffectComposer.js',
  'examples/jsm/postprocessing/RenderPass.js',
  'examples/jsm/postprocessing/UnrealBloomPass.js',
  'examples/jsm/postprocessing/SMAAPass.js',
  'examples/jsm/postprocessing/OutputPass.js',
  'examples/jsm/loaders/GLTFLoader.js',
  'examples/jsm/utils/BufferGeometryUtils.js',
];

const seen = new Set();
const queue = [...ENTRIES];
let bytes = 0;

// Matches static/dynamic imports and re-exports.
const IMPORT_RE = /(?:import|export)\s*(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);
  const res = await fetch(BASE + rel);
  if (!res.ok) { console.error('FAIL', rel, res.status); process.exitCode = 1; continue; }
  const src = await res.text();
  bytes += src.length;
  await mkdir(dirname(`${OUT}/${rel}`), { recursive: true });
  await writeFile(`${OUT}/${rel}`, src);
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2];
    if (!spec || !spec.startsWith('.')) continue;   // bare 'three' resolves via importmap
    queue.push(posix.normalize(posix.join(posix.dirname(rel), spec)));
  }
}
console.log(`three@${VERSION}: ${seen.size} modules, ${(bytes / 1024).toFixed(0)} KB`);
