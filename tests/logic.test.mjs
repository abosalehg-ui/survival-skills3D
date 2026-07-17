// Logic tests for the pure functions buried in index.html.
//
// The game is a single HTML file with no build step, so these tests EXTRACT the
// relevant function source straight out of index.html and evaluate it in isolation
// (injecting only the globals it reads). That keeps the tests honest — they run the
// real shipped code, and they break if someone edits the function and forgets to keep
// its invariants — without needing a browser or a bundler.
//
// Run: node tests/logic.test.mjs   (exit code 0 = pass, 1 = fail)

import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

let failures = 0;
function test(name, fn) {
    try {
        fn();
        console.log('  ✓', name);
    } catch (e) {
        failures++;
        console.error('  ✗', name);
        console.error('    ', e.message);
    }
}

// --- Extract a contiguous source slice between two anchor strings -------------
function slice(startAnchor, endAnchor) {
    const start = html.indexOf(startAnchor);
    const end = html.indexOf(endAnchor, start + startAnchor.length);
    assert.ok(start !== -1, `anchor not found: ${startAnchor}`);
    assert.ok(end !== -1 && end > start, `end anchor not found: ${endAnchor}`);
    return html.slice(start, end);
}

// getTerrainHeight + _slope + getTerrainSlope live together, before applyTerrainNormals.
const terrainSrc = slice('function getTerrainHeight', 'function applyTerrainNormals');
// barColor sits just before the `const levelName = ...` DOM lookups.
const barColorSrc = slice('function barColor', 'const levelName');

// Build the terrain functions with a mock CONFIG/state (the only globals they read).
function buildTerrain(level) {
    const CONFIG = { levels: [level] };
    const state = { currentLevel: 0 };
    const factory = new Function('CONFIG', 'state',
        terrainSrc + '\n return { getTerrainHeight, getTerrainSlope };');
    return factory(CONFIG, state);
}
const barColor = new Function(barColorSrc + '\n return barColor;')();

console.log('logic.test.mjs');

// --- The critical invariant: analytic slope == numeric derivative ------------
// getTerrainHeight is the single source of truth for BOTH the visible sand mesh and
// the car's physics. getTerrainSlope must be its exact gradient — if they drift, the
// car sinks into / floats over hills and terrain lighting seams appear. This test is
// the guardrail for any future terrain edit (see the "car sinking" incident).
test('getTerrainSlope matches the numeric gradient of getTerrainHeight', () => {
    const levels = [
        { duneHeight: 1.2 },                    // morning
        { duneHeight: 2.5, narrowPath: true },  // mountain pass (steepest + narrow road)
        { duneHeight: 0.7 },                    // rocky flats
        { duneHeight: 1.5 },
    ];
    const eps = 1e-4;
    const tol = 1e-3;
    let checked = 0;
    for (const level of levels) {
        const { getTerrainHeight, getTerrainSlope } = buildTerrain(level);
        for (let x = -24; x <= 24; x += 2.7) {
            for (let z = -10; z <= 240; z += 6.3) {
                const s = getTerrainSlope(x, z);
                const sdx = s.dx, sdz = s.dz;   // capture (getTerrainSlope returns a shared obj)
                const numDx = (getTerrainHeight(x + eps, z) - getTerrainHeight(x - eps, z)) / (2 * eps);
                const numDz = (getTerrainHeight(x, z + eps) - getTerrainHeight(x, z - eps)) / (2 * eps);
                assert.ok(Math.abs(sdx - numDx) < tol,
                    `dx mismatch @ dune=${level.duneHeight} (${x.toFixed(1)},${z.toFixed(1)}): analytic ${sdx.toFixed(5)} vs numeric ${numDx.toFixed(5)}`);
                assert.ok(Math.abs(sdz - numDz) < tol,
                    `dz mismatch @ dune=${level.duneHeight} (${x.toFixed(1)},${z.toFixed(1)}): analytic ${sdz.toFixed(5)} vs numeric ${numDz.toFixed(5)}`);
                checked++;
            }
        }
    }
    assert.ok(checked > 500, `expected a dense sample grid, only checked ${checked}`);
});

// --- The road is flattened laterally so the player is never walled in ---------
test('road centre (x=0) is lower/flatter than the dune flanks', () => {
    const { getTerrainHeight } = buildTerrain({ duneHeight: 1.5 });
    // Average |height| across z on the road vs off-road should be smaller on the road.
    let onRoad = 0, offRoad = 0, n = 0;
    for (let z = 0; z <= 300; z += 5) {
        onRoad += Math.abs(getTerrainHeight(0, z));
        offRoad += Math.abs(getTerrainHeight(20, z));
        n++;
    }
    assert.ok(onRoad / n < offRoad / n,
        `road centre not flatter: on-road avg ${(onRoad / n).toFixed(3)} vs off-road ${(offRoad / n).toFixed(3)}`);
});

// --- barColor thresholds (fuel/HP bar colour) --------------------------------
test('barColor picks green > amber > red across its thresholds', () => {
    assert.match(barColor(100), /44ff44/, '100% should be green');
    assert.match(barColor(51), /44ff44/, '>50% should be green');
    assert.match(barColor(50), /ffaa00/, '50% should be amber');
    assert.match(barColor(26), /ffaa00/, '>25% should be amber');
    assert.match(barColor(25), /ff4444/, '25% should be red');
    assert.match(barColor(0), /ff4444/, '0% should be red');
});

if (failures) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log('\nall logic tests passed');
