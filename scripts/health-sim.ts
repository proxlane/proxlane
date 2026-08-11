// `node scripts/health-sim.ts` — the arithmetic behind every constant in
// `packages/shared/src/health.ts`, and the reason those constants are not guesses.
//
// It imports the shipped `observe()` rather than reimplementing the CUSUM, so the numbers
// printed here describe the code that runs in production. A simulation of a copy proves
// nothing about the original, and `integrations.md` section 3 cites these figures.
//
// Slow: a few minutes. Not a command, not in CI. The fast guard is
// `packages/shared/src/health.unit.test.ts`, which asserts the properties at small trial
// counts so this file cannot rot unnoticed.

import { HEALTH, type HealthState, INITIAL, observe } from '../packages/shared/src/health.ts';

/** Seeded, so a rerun reproduces the table. */
function rng(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const FAIL = 'PROVIDER_ERROR';
const OK = 'OK';

/**
 * Samples until the provider reaches `target`, feeding a stream at failure rate `rate(i)`.
 * Returns `cap` if it never gets there.
 */
function samplesTo(
	target: HealthState['state'],
	rate: (i: number) => number,
	seed: number,
	cap: number,
): number {
	const rnd = rng(seed);
	let st = INITIAL;
	// A clock that always satisfies DWELL, so this measures the statistic and not the dwell.
	for (let i = 1; i <= cap; i++) {
		st = observe(st, rnd() < rate(i) ? FAIL : OK, i * 60_000, 0);
		if (st.state === target) return i;
	}
	return cap;
}

function quantiles(xs: number[]): { median: number; p90: number; mean: number } {
	const s = [...xs].sort((a, b) => a - b);
	return {
		median: s[Math.floor(s.length / 2)] as number,
		p90: s[Math.floor(s.length * 0.9)] as number,
		mean: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
	};
}

function repeat(n: number, f: (t: number) => number): number[] {
	return Array.from({ length: n }, (_, t) => f(t));
}

const line = (s: string) => process.stdout.write(`${s}\n`);

line('');
line('  Health CUSUM, against the shipped observe() in packages/shared/src/health.ts');
line(
	`  MIN_SAMPLES ${HEALTH.MIN_SAMPLES}  P1x ${HEALTH.P1_MULTIPLE}  H_DEGRADE ${HEALTH.H_DEGRADE}  H_DEMOTE ${HEALTH.H_DEMOTE}`,
);
line('');

// ---------------------------------------------------------------- specificity
//
// Reported as a RATE within a horizon, not as a median run length, and that choice is the
// most important line in this file. An earlier version printed the median and read 589,863
// samples to a false demote, which looked excellent. 16% of healthy providers were demoting
// inside 20,000 samples. The distribution is heavy-tailed, so the median says almost nothing
// about the tail, and the tail is the entire cost.
line('  SPECIFICITY — steady healthy providers, share falsely alarmed within a horizon');
line('  (300 providers per row. A false DEMOTE is the expensive error.)');
line('');
line('  true rate   degrade @20k   demote @20k   demote @100k');
for (const p of [0.02, 0.04, 0.1, 0.2]) {
	const rate = (target: HealthState['state'], horizon: number) =>
		`${((100 * repeat(300, (t) => samplesTo(target, () => p, 4001 + t * 97, horizon)).filter((n) => n < horizon).length) / 300).toFixed(1)}%`;
	line(
		`  ${p.toFixed(2).padEnd(11)} ${rate('degraded', 20_000).padStart(12)} ${rate('demoted', 20_000).padStart(13)} ${rate('demoted', 100_000).padStart(14)}`,
	);
}
line('');
line('  Two designs were rejected on this table. A fixed 5% bootstrap for p0 demoted a');
line('  10%-failure provider in a median of 430 samples. Replacing it with the observed rate');
line('  fixed that and left 16-18% false demotes at every rate, because a p0 estimated from');
line('  500 samples lands low often enough to matter. The Wilson upper bound is what closed');
line('  it, and it cost four samples of detection delay.');
line('');

// ---------------------------------------------------------------- sensitivity
line('  SENSITIVITY — 4% failure, then a linear slide to 26% over R samples (500 trials)');
line('  R          degrade at      demote at        p90 demote');
for (const R of [200, 1000, 5000, 20000, 60000]) {
	const ramp = (i: number) => (i <= R ? 0.04 + ((0.26 - 0.04) * i) / R : 0.26);
	// Warm p0 on a clean stretch first, so this measures detection and not measurement.
	const warmed = (offset: number) => (i: number) =>
		i <= HEALTH.MIN_SAMPLES ? 0.04 : ramp(i - HEALTH.MIN_SAMPLES + offset);
	const deg = quantiles(
		repeat(500, (t) => samplesTo('degraded', warmed(0), 9001 + t, 400_000)),
	);
	const dem = quantiles(repeat(500, (t) => samplesTo('demoted', warmed(0), 9001 + t, 400_000)));
	line(
		`  ${String(R).padEnd(10)} ${deg.median.toLocaleString().padStart(11)} ${dem.median.toLocaleString().padStart(15)} ${dem.p90.toLocaleString().padStart(17)}`,
	);
}
line('');
line('  Every row detects the slide well before it finishes. That is the property two live');
line('  EWMAs cannot have: a baseline that decays alongside the thing it measures sees a');
line('  smaller drop the slower the decay is.');
line('');

// ---------------------------------------------------------------- in days
line('  IN THE UNITS THE DECISION IS MADE IN');
const CAP = 2_000_000;
const runs = repeat(300, (t) => samplesTo('demoted', () => 0.04, 4001 + t * 97, CAP));
const censored = runs.filter((n) => n >= CAP).length;
const alarmed = runs.filter((n) => n < CAP).sort((a, b) => a - b);
line(`  Healthy provider at 4%, ${runs.length} trials, ${CAP.toLocaleString()} samples each:`);
line(`    never falsely demoted: ${censored}/${runs.length}`);
line(
	`    of the ${alarmed.length} that did, earliest at ${(alarmed[0] ?? 0).toLocaleString()} samples`,
);
line('');
line('  The median is censored and says nothing. The rate is what converts: total alarms');
line('  over total samples observed, which handles the trials that never alarmed.');
line('');
const exposure = runs.reduce((a, b) => a + b, 0);
const hazard = alarmed.length / exposure;
line(`  Hazard: ${alarmed.length} alarms over ${exposure.toLocaleString()} samples observed`);
line(
	`          = one false demote per ${Math.round(1 / hazard).toLocaleString()} samples, per provider`,
);
line('');
line('  attempts/day     years between false demotes, per provider');
for (const perDay of [500, 2_000, 10_000, 50_000]) {
	const years = 1 / hazard / perDay / 365;
	const flag = years < 1 ? '   <- under a year. Raise H_DEMOTE before this volume' : '';
	line(`  ${perDay.toLocaleString().padEnd(16)} ${years.toFixed(1).padStart(6)}${flag}`);
}
line('');
line('  A false demote is not an outage: the provider is out of rotation until a probe');
line('  clears it, and the floor forces the best demoted provider rather than serving');
line('  NO_PROVIDER_AVAILABLE. It costs money and routing quality, not availability.');
line('');
