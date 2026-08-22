// Verify every vendored Three.js module against the upstream CDN bytes for the pinned
// version. Run manually (or in CI with network) after tools/vendor-three.mjs. Offline
// runs are skipped rather than failed — the local copy is the source of truth at runtime.
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const VERSION = process.argv[2] || '0.160.0';
const ROOT = process.argv[3] || 'assets/vendor/three';
const BASE = `https://cdn.jsdelivr.net/npm/three@${VERSION}/`;

async function walk(dir) {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...await walk(p));
        else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}
const sha384 = (buf) => 'sha384-' + createHash('sha384').update(buf).digest('base64');

const files = (await walk(ROOT)).sort();
let bad = 0, checked = 0;
for (const f of files) {
    const rel = relative(ROOT, f).split('\\').join('/');
    const local = await readFile(f);
    let res;
    try { res = await fetch(BASE + rel); } catch (e) {
        console.log(`  ~ offline, skipped: ${rel}`);
        continue;
    }
    if (!res.ok) { console.error(`  ✗ ${rel}: upstream ${res.status}`); bad++; continue; }
    const remote = Buffer.from(await res.arrayBuffer());
    checked++;
    if (sha384(local) !== sha384(remote)) {
        console.error(`  ✗ ${rel}\n      local  ${sha384(local)}\n      remote ${sha384(remote)}`);
        bad++;
    } else {
        console.log(`  ✓ ${rel}  ${sha384(local)}`);
    }
}
console.log(`\n${checked}/${files.length} modules verified against three@${VERSION}${bad ? `, ${bad} MISMATCH` : ''}`);
process.exit(bad ? 1 : 0);
