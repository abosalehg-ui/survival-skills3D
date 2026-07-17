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

// goalFlatten + getTerrainHeight + getTerrainSlope live inside the @terrain-testable
// markers (kept together precisely so this test can extract them verbatim).
const terrainSrc = slice('// @terrain-testable-start', '// @terrain-testable-end');
// barColor sits just before the `const levelName = ...` DOM lookups.
const barColorSrc = slice('function barColor', 'const levelName');

// Build the terrain functions with a mock CONFIG/state (the only globals they read).
// goalFlattenZ mirrors state.goalFlattenZ: null = no goal flattening (endless / default).
function buildTerrain(level, goalFlattenZ = null) {
    const CONFIG = { levels: [level] };
    const state = { currentLevel: 0, goalFlattenZ };
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

// --- The goal-flatten factor keeps analytic slope == numeric derivative -------
// getTerrainHeight is multiplied by a Gaussian goal-flatten factor and getTerrainSlope
// applies the product rule for it. This checks the two still agree THROUGH the flatten
// region (the derivative of the product is where a hand-written gradient usually drifts).
test('getTerrainSlope matches numeric gradient with goal-flatten active', () => {
    const GOAL_Z = 120;
    const eps = 1e-4;
    const tol = 1e-3;
    let checked = 0;
    for (const level of [{ duneHeight: 1.2 }, { duneHeight: 2.5, narrowPath: true }, { duneHeight: 0.7 }]) {
        const { getTerrainHeight, getTerrainSlope } = buildTerrain(level, GOAL_Z);
        // Sample densely straddling the goal, where the flatten factor varies fastest.
        for (let x = -12; x <= 12; x += 2.3) {
            for (let z = GOAL_Z - 60; z <= GOAL_Z + 60; z += 3.1) {
                const s = getTerrainSlope(x, z);
                const sdx = s.dx, sdz = s.dz;
                const numDx = (getTerrainHeight(x + eps, z) - getTerrainHeight(x - eps, z)) / (2 * eps);
                const numDz = (getTerrainHeight(x, z + eps) - getTerrainHeight(x, z - eps)) / (2 * eps);
                assert.ok(Math.abs(sdx - numDx) < tol,
                    `dx mismatch @ dune=${level.duneHeight} (${x.toFixed(1)},${z.toFixed(1)}): ${sdx.toFixed(5)} vs ${numDx.toFixed(5)}`);
                assert.ok(Math.abs(sdz - numDz) < tol,
                    `dz mismatch @ dune=${level.duneHeight} (${x.toFixed(1)},${z.toFixed(1)}): ${sdz.toFixed(5)} vs ${numDz.toFixed(5)}`);
                checked++;
            }
        }
    }
    assert.ok(checked > 500, `expected a dense sample grid, only checked ${checked}`);
});

test('goal-flatten pulls the ground to ~0 at the goal and leaves it untouched far away', () => {
    const GOAL_Z = 800;
    const level = { duneHeight: 2.5 };  // steepest level — worst-case burial
    const flat = buildTerrain(level, GOAL_Z);
    const plain = buildTerrain(level, null);
    // At the goal centre the surface must be near flat (was up to ±1.85*dune ≈ ±4.6u).
    for (let x = -9; x <= 9; x += 3) {
        assert.ok(Math.abs(flat.getTerrainHeight(x, GOAL_Z)) < 0.05,
            `goal centre not flat at x=${x}: ${flat.getTerrainHeight(x, GOAL_Z).toFixed(3)}`);
    }
    // Far from the goal the height is unchanged vs the un-flattened field.
    for (let z = 0; z <= 200; z += 25) {
        assert.ok(Math.abs(flat.getTerrainHeight(3, z) - plain.getTerrainHeight(3, z)) < 1e-9,
            `far-field height drifted at z=${z}`);
    }
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
