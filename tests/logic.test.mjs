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
const starsSrc = slice('// @stars-testable-start', '// @stars-testable-end');
const rngSrc = slice('// @rng-testable-start', '// @rng-testable-end');

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
const { computeStars, starParSeconds } = new Function(starsSrc + '\n return { computeStars, starParSeconds };')();
const { mulberry32, hashStr } = new Function(rngSrc + '\n return { mulberry32, hashStr };')();

console.log('logic.test.mjs');

// --- The critical invariant: analytic slope == numeric derivative ------------
// getTerrainHeight is the single source of truth for BOTH the visible sand mesh and
// the car's physics. getTerrainSlope must be its exact gradient — if they drift, the
// car sinks into / floats over hills and terrain lighting seams appear. This test is
// the guardrail for any future terrain edit (see the "car sinking" incident).
test('getTerrainSlope matches the numeric gradient of getTerrainHeight', () => {
    const levels = [
        { duneHeight: 1.2 },                                   // morning (phase 0)
        { duneHeight: 2.5, narrowPath: true, terrainPhase: 3.4 }, // mountain pass + seeded phase
        { duneHeight: 0.7, terrainPhase: 1.7 },                // rocky flats + seeded phase
        { duneHeight: 1.5, terrainPhase: 5.1 },
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

test('goal-flatten makes a truly FLAT plateau over the goal footprint, untouched far away', () => {
    const GOAL_Z = 800;
    const level = { duneHeight: 2.5 };  // steepest level — worst-case burial
    const flat = buildTerrain(level, GOAL_Z);
    const plain = buildTerrain(level, null);
    // The WHOLE goal footprint (±20u in z, its parked props spread ±20 in x) must be
    // dead flat at y=0 — not just the exact centre — or edge props float/sink.
    for (let dz = -20; dz <= 20; dz += 4) {
        for (let x = -20; x <= 20; x += 5) {
            assert.ok(Math.abs(flat.getTerrainHeight(x, GOAL_Z + dz)) < 1e-9,
                `goal footprint not flat at (${x}, ${GOAL_Z + dz}): ${flat.getTerrainHeight(x, GOAL_Z + dz)}`);
        }
    }
    // Far from the goal the height is unchanged vs the un-flattened field.
    for (let z = 0; z <= 200; z += 25) {
        assert.ok(Math.abs(flat.getTerrainHeight(3, z) - plain.getTerrainHeight(3, z)) < 1e-9,
            `far-field height drifted at z=${z}`);
    }
});

test('capped hills keep the drivable dip depth shallow even on tall-dune levels', () => {
    // On the mountain pass (dune 2.5) the raw hills reached ±1.85*2.5 ≈ ±4.6u, deep enough
    // to hide the car. Capped at min(dune,1.0) the along-track roll stays within ~±1.85u.
    const { getTerrainHeight } = buildTerrain({ duneHeight: 2.5 });
    let maxAbs = 0;
    for (let z = 0; z <= 400; z += 2) maxAbs = Math.max(maxAbs, Math.abs(getTerrainHeight(0, z)));
    assert.ok(maxAbs < 2.3, `road-centre dips too deep: ${maxAbs.toFixed(2)}u (expected < 2.3)`);
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

// --- Star rating (story) -----------------------------------------------------
test('computeStars: finish=1, clean run=+1, par time=+1, clamped to 1..3', () => {
    const par = starParSeconds(800);                 // ~51s
    assert.equal(computeStars(true, par + 10, par), 1, 'damaged + slow = 1 star');
    assert.equal(computeStars(false, par + 10, par), 2, 'clean but slow = 2 stars');
    assert.equal(computeStars(true, par - 5, par), 2, 'damaged but fast = 2 stars');
    assert.equal(computeStars(false, par - 5, par), 3, 'clean + fast = 3 stars');
    assert.ok(starParSeconds(800) > 0 && starParSeconds(1300) > starParSeconds(800), 'par scales with distance');
});

// --- Daily seeded RNG --------------------------------------------------------
test('mulberry32 is deterministic per seed and same-day seeds match', () => {
    const seed = hashStr('2026-7-17');
    const a = mulberry32(seed), b = mulberry32(seed);
    const seqA = [], seqB = [];
    for (let i = 0; i < 20; i++) { seqA.push(a()); seqB.push(b()); }
    assert.deepEqual(seqA, seqB, 'same seed → identical stream (fair daily for everyone)');
    // Values are in [0,1) and not all identical (actually random-looking).
    assert.ok(seqA.every(v => v >= 0 && v < 1), 'outputs are in [0,1)');
    assert.ok(new Set(seqA).size > 15, 'stream has variety');
    // Different days → different streams.
    const c = mulberry32(hashStr('2026-7-18'));
    const seqC = []; for (let i = 0; i < 20; i++) seqC.push(c());
    assert.notDeepEqual(seqA, seqC, 'different day → different stream');
});

if (failures) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log('\nall logic tests passed');
