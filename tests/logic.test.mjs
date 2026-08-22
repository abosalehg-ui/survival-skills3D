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
// deepDefaults/sanitizeNumberMap guard the save against corruption; they are pure.
const saveSrc = slice('// @savemerge-testable-start', '// @savemerge-testable-end');
// rockJitter keys boulder displacement to the vertex POSITION so non-indexed geometry
// stays welded — see the test at the bottom for why that matters.
const rockSrc = slice('// @rockjitter-testable-start', '// @rockjitter-testable-end');

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
const { deepDefaults, sanitizeNumberMap } =
    new Function(saveSrc + '\n return { deepDefaults, sanitizeNumberMap };')();
const { rockJitter } = new Function(rockSrc + '\n return { rockJitter };')();

// --- CONFIG/VEHICLES extracted from the shipped source, so balance tests can't drift ---
// Pulled with narrow regexes rather than by evaluating the whole module (which needs a DOM).
function numFromLevels(field) {
    const block = html.slice(html.indexOf('const CONFIG = {'), html.indexOf('// ============= VEHICLE STATS'));
    return [...block.matchAll(new RegExp(field + ':\\s*([0-9.]+)', 'g'))].map(m => Number(m[1]));
}
const LEVEL_DISTANCES = numFromLevels('distance');
const LEVEL_BURN = numFromLevels('fuelConsumption');
const VEHICLE_STATS = (() => {
    const block = html.slice(html.indexOf('const VEHICLES = ['), html.indexOf('// ============= GAME MODES'));
    return [...block.matchAll(/fuelCapacity:\s*([0-9.]+),\s*fuelEfficiency:\s*([0-9.]+),\s*maxHp:\s*([0-9.]+),\s*durability:\s*([0-9.]+),\s*topSpeed:\s*([0-9.]+)/g)]
        .map(m => ({ cap: +m[1], eff: +m[2], hp: +m[3], dur: +m[4], speed: +m[5] }));
})();
const THROTTLE_EXP = Number(/throttleFuelExp:\s*([0-9.]+)/.exec(html)[1]);
const ROCK_DAMAGE = Number(/rockDamage:\s*([0-9.]+)/.exec(html)[1]);

// Mirror of the shipped burn factor (gameLoop) — kept here so the invariants below are
// checked against the real exponent from CONFIG.
const throttleBurn = (t) => (1 - 1 / THROTTLE_EXP) + (1 / THROTTLE_EXP) * Math.pow(t, THROTTLE_EXP);
// Metres travelled per unit of fuel at a given throttle, for one vehicle on one level.
const rangePerFuel = (v, burn, t) => (v.speed * t) / (burn * 60 * v.eff * throttleBurn(t));

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
    const par = starParSeconds(800, 18);             // ~51s
    assert.equal(computeStars(true, par + 10, par), 1, 'damaged + slow = 1 star');
    assert.equal(computeStars(false, par + 10, par), 2, 'clean but slow = 2 stars');
    assert.equal(computeStars(true, par - 5, par), 2, 'damaged but fast = 2 stars');
    assert.equal(computeStars(false, par - 5, par), 3, 'clean + fast = 3 stars');
    assert.ok(starParSeconds(800, 18) > 0 && starParSeconds(1300, 18) > starParSeconds(800, 18), 'par scales with distance');
});

// --- Par time is vehicle-relative, so the 3rd star grades skill not car choice ---
// With a hard-coded 18 u/s divisor the third star was FREE for the 21-speed jeep and
// arithmetically impossible for the 15-speed truck (1300/15 = 1.20x par > 1.15x).
test('star par is reachable at cruise on every vehicle, on every level', () => {
    assert.ok(VEHICLE_STATS.length === 4, `expected 4 vehicles, parsed ${VEHICLE_STATS.length}`);
    for (const d of LEVEL_DISTANCES) {
        for (const v of VEHICLE_STATS) {
            const cruiseTime = d / v.speed;
            const par = starParSeconds(d, v.speed);
            assert.ok(cruiseTime <= par,
                `par unreachable at cruise: ${d}m @ ${v.speed}u/s -> ${cruiseTime.toFixed(1)}s vs par ${par.toFixed(1)}s`);
        }
    }
    // And it must still be a real target: not reachable while braking the whole way.
    const par = starParSeconds(1000, 18);
    assert.ok(1000 / (18 * 0.6) > par, 'par should be unreachable while braking');
});

// --- Throttle must be a genuine trade-off, not a free button -----------------
// Burn used to be LINEAR in throttle, so throttle cancelled out of distance-per-fuel
// entirely and "hold gas forever" was strictly free. The convex burn curve puts the
// range optimum exactly at cruise.
test('range-per-fuel peaks at cruise: flooring and crawling both cost range', () => {
    const v = VEHICLE_STATS[0];
    const burn = LEVEL_BURN[0];
    const cruise = rangePerFuel(v, burn, 1.0);
    const floored = rangePerFuel(v, burn, 1.15);
    const braking = rangePerFuel(v, burn, 0.6);
    assert.ok(floored < cruise, `flooring must cost range: ${floored.toFixed(1)} vs ${cruise.toFixed(1)}`);
    assert.ok(braking < cruise, `crawling must cost range: ${braking.toFixed(1)} vs ${cruise.toFixed(1)}`);
    // The penalty has to be big enough to notice, or it is not a decision.
    assert.ok(floored < cruise * 0.97, 'flooring penalty too small to matter');
    // Cruise burn must be exactly the 1.0 reference, or every level budget shifts.
    assert.equal(throttleBurn(1.0), 1, 'throttle burn factor must be exactly 1 at cruise');
});

// --- Fuel is the actual constraint the game claims it is ---------------------
// A clean run used to consume as little as 32% of the tank, so the titular "reach camp
// before you run out of fuel" was never the real fail state (HP was).
test('a clean story run consumes most of the tank on every vehicle', () => {
    for (let i = 0; i < LEVEL_DISTANCES.length; i++) {
        const d = LEVEL_DISTANCES[i], burn = LEVEL_BURN[i];
        for (const v of VEHICLE_STATS) {
            const used = burn * 60 * v.eff * (d / v.speed);
            const frac = used / v.cap;
            assert.ok(frac > 0.55, `level ${i + 1} too generous for speed ${v.speed}: uses ${(frac * 100).toFixed(0)}% of tank`);
            assert.ok(frac < 1.12, `level ${i + 1} unwinnable for speed ${v.speed}: needs ${(frac * 100).toFixed(0)}% of tank`);
        }
    }
});

// --- No vehicle may be strictly dominated -----------------------------------
// The old jeep had BOTH the shortest range and the worst durability, so picking it was
// never correct. Armour must trade against range, monotonically.
test('vehicles trade armour against range: none is dominated on both axes', () => {
    const burn = LEVEL_BURN[LEVEL_BURN.length - 1];
    const profiled = VEHICLE_STATS.map(v => ({
        range: rangePerFuel(v, burn, 1.0) * v.cap,
        hits: v.hp / (ROCK_DAMAGE / v.dur),
    }));
    for (let i = 0; i < profiled.length; i++) {
        for (let j = 0; j < profiled.length; j++) {
            if (i === j) continue;
            const a = profiled[i], b = profiled[j];
            assert.ok(!(b.range > a.range && b.hits > a.hits),
                `vehicle ${i} is dominated by ${j}: range ${a.range.toFixed(0)}<${b.range.toFixed(0)} and hits ${a.hits.toFixed(1)}<${b.hits.toFixed(1)}`);
        }
    }
});

// --- Save corruption must never brick the game ------------------------------
// A truncated/hand-edited/foreign save used to throw during init, which aborted
// initGame() AND made the in-game "reset progress" button unreachable.
test('deepDefaults repairs every shape of corrupt save', () => {
    const defs = () => ({
        schemaVersion: 1,
        settings: { volume: 0.5, quality: 'auto', vibration: true },
        campaign: { highestUnlocked: 0, bestTimes: {}, perfectRuns: [] },
        vehicles: { selectedId: 'landCruiser', played: [] },
        achievements: [],
    });
    // The exact failure from the review: schemaVersion present, everything else gone.
    const truncated = deepDefaults({ schemaVersion: 1 }, defs());
    assert.equal(truncated.settings.volume, 0.5, 'missing settings must be restored');
    assert.equal(truncated.vehicles.selectedId, 'landCruiser', 'missing vehicles must be restored');
    assert.deepEqual(truncated.achievements, [], 'missing arrays must be restored');
    // Wrong types anywhere are replaced, not propagated.
    const junk = deepDefaults({ settings: 'nope', campaign: [], achievements: {}, vehicles: null }, defs());
    assert.equal(junk.settings.quality, 'auto');
    assert.equal(junk.campaign.highestUnlocked, 0);
    assert.ok(Array.isArray(junk.achievements));
    assert.equal(junk.vehicles.selectedId, 'landCruiser');
    // Real values survive untouched.
    const kept = deepDefaults({ settings: { volume: 0.2 }, campaign: { highestUnlocked: 4 } }, defs());
    assert.equal(kept.settings.volume, 0.2, 'existing values must be preserved');
    assert.equal(kept.settings.vibration, true, 'siblings still filled in');
    assert.equal(kept.campaign.highestUnlocked, 4);
    // Nothing throws on the degenerate inputs JSON.parse can hand us.
    for (const v of [null, undefined, 0, '', [], 'str', true]) {
        assert.equal(deepDefaults(v, defs()).settings.volume, 0.5, `failed for ${JSON.stringify(v)}`);
    }
});

test('sanitizeNumberMap strips values that would crash the level menu', () => {
    // populateLevelGrid calls bestTime.toFixed(1) — a string or NaN there throws.
    const m = sanitizeNumberMap({ 0: 12.5, 1: 'oops', 2: NaN, 3: Infinity, 4: null, 5: 0 });
    assert.deepEqual(Object.keys(m).sort(), ['0', '5'], 'only finite numbers survive');
    assert.equal(m[0], 12.5);
    assert.equal(m[5], 0, 'zero is a legitimate time');
    assert.deepEqual(sanitizeNumberMap(null), {});
    assert.deepEqual(sanitizeNumberMap('nope'), {});
    assert.deepEqual(sanitizeNumberMap([1, 2]), {});
});

// --- Boulders must stay welded ----------------------------------------------
// DodecahedronGeometry is NON-INDEXED: each triangle carries its own copy of each of its
// three corners. Jittering per vertex with Math.random() gave every copy a different
// displacement, so the triangles pulled apart and the rock rendered as a cloud of
// disconnected shards. rockJitter must be a pure function of the corner's position.
test('rockJitter gives every duplicate of a corner the identical displacement', () => {
    const seed = 123.456;
    // The same corner as it would appear in three separate triangles of the same rock.
    const corner = [0.7236, -0.4472, 0.5257];
    const a = rockJitter(corner[0], corner[1], corner[2], seed);
    const b = rockJitter(corner[0], corner[1], corner[2], seed);
    const c = rockJitter(corner[0], corner[1], corner[2], seed);
    assert.equal(a, b, 'duplicate corners must not drift apart');
    assert.equal(b, c, 'duplicate corners must not drift apart');

    // Simulate the real failure: a non-indexed triangle soup where one corner is shared by
    // four faces. After displacement every copy must land on the SAME point, or there is a
    // hole in the surface.
    const shared = [-0.2764, 0.8506, 0.4472];
    const placed = new Set();
    for (let face = 0; face < 4; face++) {
        const f = 1 + (rockJitter(shared[0], shared[1], shared[2], seed) - 0.5) * 0.35;
        placed.add([shared[0] * f, shared[1] * f, shared[2] * f].join(','));
    }
    assert.equal(placed.size, 1, `corner split into ${placed.size} positions — the rock would have gaps`);
});

test('rockJitter still varies across corners and seeds, and stays in range', () => {
    const seed = 42;
    const corners = [
        [0.7236, -0.4472, 0.5257], [-0.2764, 0.8506, 0.4472], [0.0, 0.0, 1.0],
        [-0.8944, 0.4472, 0.0], [0.5257, 0.7236, -0.4472], [0.309, -0.5, 0.809],
    ];
    const values = corners.map(c => rockJitter(c[0], c[1], c[2], seed));
    assert.ok(values.every(v => v >= 0 && v < 1), 'factors must be in [0,1)');
    assert.ok(new Set(values.map(v => v.toFixed(6))).size >= corners.length - 1,
        'distinct corners must get distinct displacement, or the rock is a plain sphere');
    // A different rock (different seed) gets a different shape.
    const other = corners.map(c => rockJitter(c[0], c[1], c[2], seed + 7));
    assert.notDeepEqual(values, other, 'different seed must produce a different boulder');
    // The resulting radius scale stays within the intended +/-17.5% band.
    for (const v of values) {
        const f = 1 + (v - 0.5) * 0.35;
        assert.ok(f > 0.82 && f < 1.18, `displacement factor out of band: ${f}`);
    }
});

// Static guard: the failure mode was Math.random() INSIDE the per-vertex loop. Catch any
// future edit that reintroduces it, since the visual damage is only obvious in-game.
test('the boulder vertex loop contains no per-vertex Math.random()', () => {
    const start = html.indexOf('const rp = geom.attributes.position;');
    assert.ok(start !== -1, 'boulder vertex loop not found');
    const end = html.indexOf('geom.computeVertexNormals();', start);
    assert.ok(end !== -1 && end > start, 'end of boulder vertex loop not found');
    const loop = html.slice(start, end);
    assert.ok(loop.includes('for (let i = 0; i < rp.count'), 'expected the per-vertex loop here');
    const randomInLoop = loop.slice(loop.indexOf('for (let i = 0; i < rp.count'));
    assert.ok(!randomInLoop.includes('Math.random()'),
        'Math.random() inside the per-vertex loop tears the non-indexed rock into shards');
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

// =============================================================================
// DAILY CHALLENGE DETERMINISM
// =============================================================================
// The mode's whole promise is "بذرة يومية ثابتة للجميع". It used to be broken in four
// independent ways at once; these tests pin each of them shut.

const spawnSrc = slice('// @spawnplan-testable-start', '// @spawnplan-testable-end');
const { planSpawnStep, spawnStepPScale } =
    new Function(spawnSrc + '\n return { planSpawnStep, spawnStepPScale };')();
const stormSrc = slice('// @stormsched-testable-start', '// @stormsched-testable-end');
const { stormStartDistance } = new Function(stormSrc + '\n return { stormStartDistance };')();

const SPAWN_STEP = Number(/const ENDLESS_SPAWN_STEP = ([0-9.]+)/.exec(html)[1]);
const ROCK_SIZES = JSON.parse(/const ROCK_SIZES = (\[[^\]]+\])/.exec(html)[1]);
const HOLE_SIZES = JSON.parse(/const HOLE_SIZES = (\[[^\]]+\])/.exec(html)[1]);
// How the game builds a step's generator (runSpawnStep) and a storm's gap (stormRandFor).
const stepRng = (seed, i) => mulberry32(hashStr(seed + '#' + i));
const stormRng = (seed) => (i) => mulberry32(hashStr(seed + '!storm' + i))();

// THE central guarantee. A step's contents must depend ONLY on the seed and the step's
// world position — never on frame rate, draw order, or how the run is being played.
test('daily layout is a pure function of (seed, step): frame rate cannot shift it', () => {
    const seed = '2026-8-22';
    const forward = [], backward = [];
    for (let i = 400; i < 900; i++) forward.push(JSON.stringify(planSpawnStep(i, SPAWN_STEP, stepRng(seed, i), ROCK_SIZES, HOLE_SIZES)));
    // Planning the same steps in the opposite order stands in for any device that reaches
    // them after a different number of frames / draws.
    for (let i = 899; i >= 400; i--) backward.unshift(JSON.stringify(planSpawnStep(i, SPAWN_STEP, stepRng(seed, i), ROCK_SIZES, HOLE_SIZES)));
    assert.deepEqual(forward, backward, 'same seed + same step must give the same plan, always');
    assert.ok(forward.some(p => JSON.parse(p).obstacle), 'the sampled stretch should contain obstacles');
});

test('a different day gives a different daily layout', () => {
    const a = [], b = [];
    for (let i = 400; i < 700; i++) {
        a.push(JSON.stringify(planSpawnStep(i, SPAWN_STEP, stepRng('2026-8-22', i), ROCK_SIZES, HOLE_SIZES)));
        b.push(JSON.stringify(planSpawnStep(i, SPAWN_STEP, stepRng('2026-8-23', i), ROCK_SIZES, HOLE_SIZES)));
    }
    assert.notDeepEqual(a, b, 'each day must be its own puzzle');
});

// A per-step probability above 1 would silently cap the spawn rate and flatten the
// difficulty ramp at its top end.
test('per-step spawn probabilities stay below 1 across the whole difficulty ramp', () => {
    const s = spawnStepPScale(SPAWN_STEP);
    const maxObstacleP = (0.04 + 0.08) * s;      // ramp caps at +0.08
    assert.ok(maxObstacleP < 1, `obstacle p saturates at ${maxObstacleP.toFixed(3)}`);
    assert.ok(0.02 * s < 1 && 0.012 * s < 1, 'fuel/power-up probabilities saturate');
});

// The conversion from the old per-frame rates must preserve the tuned density, or this
// silently becomes a balance change wearing a determinism fix's clothes.
test('distance-indexed spawn density matches the old per-frame rate at cruise', () => {
    const CRUISE = 18, FPS = 60;
    // Old: p per frame at 60fps → spawns per metre = p * FPS / CRUISE.
    // New: p per step → spawns per metre = p_step / step.
    for (const pFrame of [0.04, 0.08, 0.12]) {
        const oldPerMetre = pFrame * FPS / CRUISE;
        const newPerMetre = (pFrame * spawnStepPScale(SPAWN_STEP)) / SPAWN_STEP;
        assert.ok(Math.abs(oldPerMetre - newPerMetre) < 1e-9,
            `density drifted at p=${pFrame}: ${oldPerMetre} vs ${newPerMetre}`);
    }
});

// userData.radius IS the collision box, so it has to come from the quantised set (a
// continuous Math.random() draw gave the same daily rock a different hitbox per player).
test('obstacle sizes come from the quantised sets, preserving the old means', () => {
    const seed = '2026-8-22';
    const sizes = { rock: new Set(), hole: new Set() };
    for (let i = 400; i < 4000; i++) {
        const p = planSpawnStep(i, SPAWN_STEP, stepRng(seed, i), ROCK_SIZES, HOLE_SIZES);
        if (p.obstacle) sizes[p.obstacle.type].add(p.obstacle.size);
    }
    assert.ok([...sizes.rock].every(s => ROCK_SIZES.includes(s)), 'rock sizes must be quantised');
    assert.ok([...sizes.hole].every(s => HOLE_SIZES.includes(s)), 'hole sizes must be quantised');
    assert.ok(sizes.rock.size === ROCK_SIZES.length, 'every rock size should occur over a long run');
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    // Old ranges: rock 0.7 + rand()*1.0 (mean 1.2), hole 1.0 + rand()*0.6 (mean 1.3).
    assert.ok(Math.abs(mean(ROCK_SIZES) - 1.2) < 0.01, `rock size mean drifted: ${mean(ROCK_SIZES)}`);
    assert.ok(Math.abs(mean(HOLE_SIZES) - 1.3) < 0.01, `hole size mean drifted: ${mean(HOLE_SIZES)}`);
});

test('sandstorm starts are seeded, increasing, and independent of how the run is played', () => {
    const r = stormRng('2026-8-22');
    const a = [0, 1, 2, 3, 4].map(i => stormStartDistance(i, r));
    const b = [4, 3, 2, 1, 0].map(i => stormStartDistance(i, r)).reverse();
    assert.deepEqual(a, b, 'a storm start must not depend on when it is asked for');
    for (let i = 1; i < a.length; i++) assert.ok(a[i] > a[i - 1], 'storm starts must increase');
    // Each gap is 1200..2000 m; a 12 s storm covers at most ~378 m even under boost, so a
    // storm can never overrun the next scheduled start.
    for (let i = 1; i < a.length; i++) {
        const gap = a[i] - a[i - 1];
        assert.ok(gap >= 1200 && gap <= 2000, `gap out of range: ${gap}`);
    }
    assert.notDeepEqual(a, [0, 1, 2, 3, 4].map(i => stormStartDistance(i, stormRng('2026-8-23'))),
        'different day → different storm placement');
});

// Static guards for the two leaks that live in control flow rather than in a pure function.
test('the endless spawner no longer draws once per rendered frame', () => {
    // Comment lines are stripped first: the replacement's own explanation quotes the old
    // per-frame spawner verbatim, and a guard that trips on its own documentation is worse
    // than no guard at all.
    const code = html.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!code.includes('const spawnScale = delta * 60'),
        'spawnScale is the per-frame spawner: draws must be indexed by distance, not frames');
    assert.ok(code.includes('runSpawnStep(stepIndex'), 'expected the distance-cursor spawner');
});

test('recycling an obstacle cannot change the hitbox a player meets', () => {
    const start = html.indexOf('function acquireObstacle(');
    const src = html.slice(start, html.indexOf('function acquireFuelCan(', start));
    assert.ok(src.includes("spec.type + ':' + spec.size"),
        'pooled obstacles must be matched on BOTH type and size, or the pool decides the hitbox');
});

// =============================================================================
// COLLISION / BALANCE REGRESSIONS
// =============================================================================

// The bug: removeInteractive() sat OUTSIDE the invulnerability check, so for half a second
// after any impact every obstacle touched was deleted for free.
test('post-hit invulnerability passes through obstacles instead of deleting them', () => {
    const start = html.indexOf('function checkCollisions()');
    const end = html.indexOf('function updateCargo(', start);
    const src = html.slice(start, end);
    const guard = src.indexOf('CONFIG.damage.invulnSeconds) continue;');
    assert.ok(guard !== -1, 'expected an early-out `continue` for the i-frame window');
    const remove = src.indexOf('removeInteractive(obstacle', guard);
    assert.ok(remove !== -1, 'obstacle removal should still happen after the guard');
    // Nothing may remove an obstacle BEFORE the guard is applied.
    assert.ok(src.slice(0, guard).indexOf('removeInteractive(obstacle') === -1,
        'an obstacle removed before the i-frame check is a free kill during invulnerability');
});

test('boost is a range trade, not a free +50%', () => {
    const mult = Number(/boostMultiplier:\s*([0-9.]+)/.exec(html)[1]);
    const burn = Number(/boostFuelMultiplier:\s*([0-9.]+)/.exec(html)[1]);
    // Fuel burn is per SECOND, so distance-per-fuel scales with speed/burn.
    assert.ok(burn > mult,
        `boost must cost range: speed x${mult} against burn x${burn} is still a free win`);
    const rangeRatio = mult / burn;
    assert.ok(rangeRatio > 0.85,
        `boost costs ${((1 - rangeRatio) * 100).toFixed(0)}% of range — that makes the pickup a trap`);
});

// The tightest routes are tuned to within ~2% of a full tank, and the fuel-can spawn loop
// is a chain of independent coin flips — so a bad seed could make a route arithmetically
// unwinnable before the player turned a wheel. This mirrors the top-up in setupLevel.
test('every level is completable by every vehicle once the guaranteed cans are counted', () => {
    for (let lvl = 0; lvl < LEVEL_DISTANCES.length; lvl++) {
        VEHICLE_STATS.forEach((v, vi) => {
            const burnPerSec = LEVEL_BURN[lvl] * 60 * v.eff;
            const needed = burnPerSec * (LEVEL_DISTANCES[lvl] / v.speed);
            const deficit = needed * 1.15 - v.cap;
            const minCans = Math.max(0, Math.ceil(deficit / 10));
            const budget = v.cap + minCans * 10;
            assert.ok(budget >= needed * 1.15 - 1e-9,
                `level ${lvl + 1}, vehicle ${vi}: ${budget.toFixed(1)} fuel available vs ${(needed * 1.15).toFixed(1)} needed`);
            // And the guarantee must stay a safety net, not a handout.
            assert.ok(minCans <= 4, `level ${lvl + 1}, vehicle ${vi}: ${minCans} guaranteed cans is too generous`);
        });
    }
});

// =============================================================================
// SETTINGS / ACCESSIBILITY
// =============================================================================

test('every rebindable action ships with a usable default binding', () => {
    const block = html.slice(html.indexOf('const DEFAULT_KEYS = {'), html.indexOf('const KEY_ACTIONS = ['));
    const actions = [...block.matchAll(/(\w+):\s*\[([^\]]+)\]/g)];
    assert.ok(actions.length >= 5, `expected 5 bindable actions, found ${actions.length}`);
    const seen = new Set();
    for (const [, name, list] of actions) {
        const keys = list.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        assert.ok(keys.length && keys.every(k => k.length), `${name} has an empty default binding`);
        for (const k of keys) {
            assert.ok(!seen.has(k.toLowerCase()), `${k} is bound to two actions by default`);
            seen.add(k.toLowerCase());
        }
    }
    // And the settings screen must actually expose them, or they are not rebindable.
    assert.ok(html.includes('id="keyBindings"') && html.includes('syncKeyBindingsUI'),
        'the rebinding UI is missing');
});

test('selection cards are reachable and operable from the keyboard', () => {
    const fn = html.slice(html.indexOf('function makeCardActivatable('), html.indexOf('function populateModeGrid('));
    assert.ok(/card\.tabIndex\s*=\s*0/.test(fn), 'cards need a tab stop');
    assert.ok(/role',\s*'button'/.test(fn), 'cards need button semantics');
    assert.ok(fn.includes("'Enter'") && fn.includes("' '"), 'cards must activate on Enter/Space');
    // Every grid must go through the helper — a raw click listener is a keyboard dead end.
    for (const grid of ['populateModeGrid', 'populateVehicleGrid', 'populateLevelGrid']) {
        const src = html.slice(html.indexOf(`function ${grid}(`), html.indexOf('\n        function ', html.indexOf(`function ${grid}(`) + 10));
        assert.ok(src.includes('makeCardActivatable'), `${grid} still builds unreachable cards`);
        assert.ok(!/card\.addEventListener\('click'/.test(src), `${grid} still binds a bare click handler`);
    }
});

test('the defeat cinematic is short and skippable; victory is not cut short', () => {
    const win = Number(/rotationDuration:\s*([0-9.]+)/.exec(html)[1]);
    const lose = Number(/loseRotationDuration:\s*([0-9.]+)/.exec(html)[1]);
    assert.ok(lose < win, `defeat orbit (${lose}s) must be shorter than victory (${win}s)`);
    assert.ok(lose <= 2, `${lose}s between death and retry is still too long for an arcade loop`);
    const fn = html.slice(html.indexOf('function skipCinematic()'), html.indexOf('function updateCameraRotation('));
    assert.ok(fn.includes("state.cameraRotationType !== 'lose'"),
        'only the defeat orbit may be skippable — a win is the payoff');
});

test('the first-run tutorial is a handful of lines, not a wall', () => {
    const short = html.slice(html.indexOf('id="tutorialShort"'), html.indexOf('id="tutorialFull"'));
    const items = (short.match(/<li>/g) || []).length;
    assert.ok(items > 0 && items <= 4, `first-run tutorial has ${items} bullets; keep it to 3-4`);
    assert.ok(html.includes('id="tutorialFull"'), 'the full reference must still be reachable');
    // The bullets that were dropped must have a contextual home instead.
    for (const id of ['pwBoost', 'pwShield', 'pwFuel', 'obstacle', 'fuelCan', 'throttle']) {
        assert.ok(html.includes(`maybeHint('${id}'`), `no contextual hint replaced the '${id}' tutorial line`);
    }
});

test('the daily challenge pins the vehicle so shared scores are comparable', () => {
    assert.ok(/const DAILY_VEHICLE_ID = '(\w+)'/.test(html), 'daily mode must fix the vehicle');
    const id = /const DAILY_VEHICLE_ID = '(\w+)'/.exec(html)[1];
    assert.ok(html.includes(`id: '${id}'`), `DAILY_VEHICLE_ID '${id}' is not a real vehicle`);
    assert.ok(html.includes('state.daily ? DAILY_VEHICLE_ID : state.pendingVehicleId'),
        'beginRun must force the daily vehicle');
});

test('daily runs do not write into the free-run endless record', () => {
    const start = html.indexOf('function gameOver(');
    const src = html.slice(start, html.indexOf('function buildLevelWithLoader(', start));
    const dailyBranch = src.indexOf('if (state.daily) {');
    const bestWrite = src.indexOf('endless.bestDistance =');
    assert.ok(dailyBranch !== -1 && bestWrite !== -1, 'expected both branches in gameOver');
    assert.ok(src.includes('} else {') && bestWrite > dailyBranch,
        'the endless record must sit in the non-daily branch');
    assert.ok(!/if \(state\.daily\)[\s\S]{0,400}runsCompleted\+\+/.test(src),
        'a daily run must not count as an endless run');
});

if (failures) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log('\nall logic tests passed');
