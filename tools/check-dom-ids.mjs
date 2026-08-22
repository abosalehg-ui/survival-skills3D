// `node --check` proves the game module PARSES. It cannot prove the module still talks to
// the markup it ships with: rename an element's id (or delete it) and the syntax check
// stays green while `document.getElementById(...)` returns null and the game dies on the
// first property access — in production, on GitHub Pages, silently.
//
// This closes that gap the cheap way: every id the script reaches for must exist, either
// as an id="..." in the HTML or as one the script itself assigns (el.id = '...').
//
// Run: node tools/check-dom-ids.mjs [index.html]
import { readFile } from 'node:fs/promises';

const FILE = process.argv[2] || 'index.html';
const html = await readFile(FILE, 'utf8');

// Ids that exist in the document...
const declared = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
// ...plus any the script creates at runtime (the WebGL-context-lost overlay does this).
for (const m of html.matchAll(/\.id\s*=\s*['"]([A-Za-z][\w-]*)['"]/g)) declared.add(m[1]);

const referenced = new Map();   // id -> how it was referenced
const add = (id, how) => { if (!referenced.has(id)) referenced.set(id, how); };
for (const m of html.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1], `getElementById('${m[1]}')`);
// querySelector('#id') / querySelectorAll('#id ...') — only the leading #id token.
for (const m of html.matchAll(/querySelector(?:All)?\(\s*['"]#([\w-]+)/g)) add(m[1], `querySelector('#${m[1]}')`);

const missing = [...referenced.entries()].filter(([id]) => !declared.has(id));

if (missing.length) {
    console.error(`✗ ${missing.length} DOM id(s) referenced by the script but not present in ${FILE}:`);
    for (const [id, how] of missing) console.error(`    ${how}`);
    console.error('\n  Either the element was renamed/removed, or the lookup is a typo.');
    process.exit(1);
}
console.log(`✓ all ${referenced.size} referenced DOM ids exist in ${FILE} (${declared.size} declared)`);
