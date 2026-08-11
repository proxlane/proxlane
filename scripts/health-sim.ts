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

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEALTH, type HealthState, initial, observe } from '../packages/shared/src/health.ts';

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
	let st = initial(0);
	// A clock that always satisfies DWELL, so this measures the statistic and not the dwell.
	for (let i = 1; i <= cap; i++) {
		st = observe(st, rnd() < rate(i) ? FAIL : OK, i * 60_000);
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

/**
 * Numbers the docs quote, collected as data rather than restated as prose.
 *
 * Every published figure drifted from this file at least once, in the same direction: the
 * prose was written against an earlier build of the sim and never re-derived. The worst was
 * `877`, which is the REJECTED plain-rate estimator's result, published as the shipped
 * system's. `scripts/health-numbers.json` is written from here and `repo:check` asserts the
 * docs contain exactly these values, so restating one from memory is now a red build.
 */
const published: Record<string, number> = {};

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
const TRIALS = 2000;
for (const p of [0.02, 0.04, 0.1, 0.2]) {
	const rate = (target: HealthState['state'], horizon: number) => {
		const runs = repeat(TRIALS, (t) => samplesTo(target, () => p, 4001 + t * 97, horizon));
		const pct = (100 * runs.filter((n) => n < horizon).length) / TRIALS;
		published[`${target}@${horizon / 1000}k_at_${p}`] = Number(pct.toFixed(1));
		return `${pct.toFixed(1)}%`;
	};
	line(
		`  ${p.toFixed(2).padEnd(11)} ${rate('degraded', 20_000).padStart(12)} ${rate('demoted', 20_000).padStart(13)} ${rate('demoted', 100_000).padStart(14)}`,
	);
}
line('');
line(`  ${TRIALS} trials per cell, so the resolution is ${(100 / TRIALS).toFixed(2)} points.`);
line('  An earlier version used 300, at which "0.0%" and "0.3%" are the same measurement and');
line('  the 20% cell carried a +/-1.9 point interval. Three of the four published cells were');
line('  wrong, and none of them supported two significant figures.');
line('');
line('  Two designs were rejected on this table. A fixed 5% bootstrap for p0 demoted a');
line('  10%-failure provider in a median of 430 samples. Replacing it with the observed rate');
line('  fixed that and left 16-18% false demotes at every rate, because a p0 estimated from');
line('  500 samples lands low often enough to matter. The Wilson upper bound is what closed');
line('  it, and it cost four samples of detection delay.');
line('');

// ---------------------------------------------------------------- sensitivity
line('  SENSITIVITY — 4% failure, then a linear slide to 26% over R samples (2000 trials)');
line('  R          degrade at      demote at        p90 demote');
for (const R of [200, 1000, 5000, 20000, 60000]) {
	const ramp = (i: number) => (i <= R ? 0.04 + ((0.26 - 0.04) * i) / R : 0.26);
	// Warm p0 on a clean stretch first, so this measures detection and not measurement.
	const warmed = (offset: number) => (i: number) =>
		i <= HEALTH.MIN_SAMPLES ? 0.04 : ramp(i - HEALTH.MIN_SAMPLES + offset);
	const deg = quantiles(
		repeat(2000, (t) => samplesTo('degraded', warmed(0), 9001 + t, 400_000)),
	);
	const dem = quantiles(
		repeat(2000, (t) => samplesTo('demoted', warmed(0), 9001 + t, 400_000)),
	);
	if (R === 1000) published.incident_demote_median = dem.median;
	line(
		`  ${String(R).padEnd(10)} ${deg.median.toLocaleString().padStart(11)} ${dem.median.toLocaleString().padStart(15)} ${dem.p90.toLocaleString().padStart(17)}`,
	);
}
line('');
line('  Read the p90, not the median — the same lesson as the specificity table above, and');
line('  the sensitivity section drew its conclusion from the median for a while anyway while');
line('  printing the refuting p90 in the adjacent column. Fast slides are caught well before');
line('  they finish; a 20k-sample slide has a p90 an order of magnitude past its own end.');
line('');
line('  What the frozen baseline buys is unchanged: a live EWMA reference decays alongside');
line('  the thing it measures, so the slower the slide the less of it there is to see. That');
line('  argument is analytic, and is NOT computed here — an earlier comment claimed this');
line('  script reproduced the attenuation table, and there is no EWMA code in this repo.');
line('');

// ------------------------------------------------------- the detection floor
//
// "Costs four samples of detection delay" was published from the 6.5x row alone. The floor
// is where the drift turns negative, and below it the detector is blind however long you
// wait. Stating the capability honestly needs the whole curve, not one point on it.
line('  DETECTION FLOOR — step change from 4% failure, 2,000 trials, horizon 200k');
line('  after    xbase   P(demote within 20k)   median delay');
for (const [rate, mult] of [
	[0.05, 1.3],
	[0.06, 1.5],
	[0.08, 2.0],
	[0.1, 2.5],
	[0.12, 3.0],
	[0.26, 6.5],
] as const) {
	const M = HEALTH.MIN_SAMPLES;
	const step = (i: number) => (i <= M ? 0.04 : rate);
	const runs = repeat(2000, (t) => samplesTo('demoted', step, 21_000 + t, 200_000));
	const within = (100 * runs.filter((n) => n < 20_000 + M).length) / 2000;
	const q = quantiles(runs.map((n) => Math.max(0, n - M)));
	if (rate === 0.26) published.incident_step_median = q.median;
	line(
		`  ${rate.toFixed(2).padEnd(8)} ${`${mult}x`.padEnd(7)} ${`${within.toFixed(1)}%`.padStart(20)} ${q.median.toLocaleString().padStart(14)}`,
	);
}
line('');
line('  The honest capability statement, which appeared nowhere: reliably catches a rise of');
line('  2.5x or more in the failure rate; 2x is roughly a coin flip within 20k; 1.5x and');
line('  below is effectively invisible. 96%->74% is the 6.5x row.');
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

// ------------------------------------------- the hazard is not constant
//
// "One every 2.9 years" pooled a lifetime into a single rate and divided by attempts/day.
// That assumes exponentiality, and the hazard has a ~10x burn-in — the same class of error
// as the median run length this design already rejected. It matters because EVERY RECOVERY
// re-measures p0 and therefore restarts the burn-in.
line('  BURN-IN — the false-demote hazard by provider age, true rate 4%');
line('  age window        alarms per sample     1 per');
{
	const WINDOWS: [number, number][] = [
		[0, 20_000],
		[20_000, 100_000],
		[100_000, 500_000],
	];
	const counts = WINDOWS.map(() => 0);
	const exposure = WINDOWS.map(() => 0);
	for (let t = 0; t < 1500; t++) {
		const at = samplesTo('demoted', () => 0.04, 77_000 + t * 13, 500_000);
		WINDOWS.forEach(([lo, hi], i) => {
			exposure[i] = (exposure[i] as number) + Math.max(0, Math.min(at, hi) - lo);
			if (at >= lo && at < hi) counts[i] = (counts[i] as number) + 1;
		});
	}
	WINDOWS.forEach(([lo, hi], i) => {
		const h = (counts[i] as number) / Math.max(1, exposure[i] as number);
		line(
			`  ${`${lo / 1000}k-${hi / 1000}k`.padEnd(17)} ${h.toExponential(2).padStart(17)} ${
				h === 0 ? 'none observed' : Math.round(1 / h).toLocaleString()
			}`,
		);
	});
}
line('');
line('  A freshly baselined provider is the risky one, and a recovery makes every provider');
line('  fresh again. Quote the first-20k probability, not the pooled lifetime rate.');
line('');

// ------------------------------------------- providers are not iid
//
// The entire calibration above assumes independent Bernoulli trials. Real providers have
// regimes: a bad hour, a struggling upstream, a diurnal load pattern. Same mean failure
// rate, wildly different behaviour — and nothing else in this file or the test suite
// contains a single autocorrelated stream.
line('  AUTOCORRELATION — two-regime providers, identical 5% MEAN failure rate');
line('  mean dwell      demotions/provider    share of time demoted');
{
	const N = 200;
	const HORIZON = 400_000;
	for (const dwell of [Number.POSITIVE_INFINITY, 2_000, 20_000]) {
		let demotions = 0;
		let demotedSamples = 0;
		for (let t = 0; t < N; t++) {
			const rnd = rng(31_000 + t * 7);
			let st = initial(0);
			let bad = false;
			for (let i = 1; i <= HORIZON; i++) {
				if (Number.isFinite(dwell) && rnd() < 1 / dwell) bad = !bad;
				// 1% and 9% regimes, equal occupancy, so the marginal rate is 5% either way.
				const p = Number.isFinite(dwell) ? (bad ? 0.09 : 0.01) : 0.05;
				const prev = st.state;
				st = observe(st, rnd() < p ? 'PROVIDER_ERROR' : 'OK', i * 1000);
				if (st.state === 'demoted') {
					demotedSamples++;
					if (prev !== 'demoted') demotions++;
				}
			}
		}
		const label = Number.isFinite(dwell) ? String(dwell) : 'iid (none)';
		line(
			`  ${label.padEnd(15)} ${(demotions / N).toFixed(2).padStart(18)} ${`${((100 * demotedSamples) / (N * HORIZON)).toFixed(1)}%`.padStart(24)}`,
		);
		if (!Number.isFinite(dwell))
			published.iid_demotions_per_provider = Number((demotions / N).toFixed(2));
	}
}
line('');
line('  Same mean rate, an order of magnitude more demotions. The exit path is slower than');
line('  the regime dynamics — 5m to 6h probe backoff, two clean probes — so a bad patch buys');
line('  hours of demotion. This is why PROXLANE_HEALTH now defaults to OFF: the specificity');
line('  numbers above are true of a provider that does not exist.');
line('');

const OUT = join(
	resolve(dirname(fileURLToPath(import.meta.url)), '..'),
	'scripts/health-numbers.json',
);
writeFileSync(OUT, `${JSON.stringify(published, null, '\t')}\n`);
line(`  wrote ${OUT}`);
line('  repo:check asserts the docs quote exactly these. Restating one from memory is a red');
line('  build, which is what every stale figure in this design had in common.');
line('');
