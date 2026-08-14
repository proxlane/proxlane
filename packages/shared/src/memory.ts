// Will this gateway fit in the memory it has been given?
//
// The gateway buffers every response body before the detector can read it — `operations.md`
// section 1 requires buffering, because detection needs the body — so the working set is
// roughly `maxInflight * bodyCap * BUFFER_FACTOR`. Get that wrong and the container is
// OOM-killed: every in-flight scrape dropped, no error anywhere, and the only evidence is a
// line in the host's dmesg that a self-hoster will never look at.
//
// `.env.example` and `docs/self-hosting.md` both described this check for months while it did
// not exist. This is it.
//
// WHY IT DOES NOT USE `os.totalmem()`. Inside a limited container that reports the HOST's
// memory, so a gateway capped at 512 MB on a 64 GB box would be told it has 64 GB and would
// pass this check on its way to being killed. That is the exact hole the check exists to
// close, so an unreadable limit is reported as unknown rather than guessed at.

/**
 * Bytes held per megabyte of body, beyond the body itself.
 *
 * Not a safety margin plucked from the air: a buffered response exists more than once at
 * peak — the raw bytes, the decoded string the detector scans, and transient copies while the
 * response is assembled. 2.5 is the figure `operations.md` section 1 sizes against.
 */
export const BUFFER_FACTOR = 2.5;

/** Where a limit came from. `none` means nothing trustworthy was readable. */
export type MemorySource = 'env' | 'cgroup-v2' | 'cgroup-v1' | 'none';

export interface MemoryLimit {
	readonly source: MemorySource;
	/** Undefined when `source` is `none`. */
	readonly limitMb: number | undefined;
}

export interface MemoryBudget {
	/** What the configuration wants, in megabytes. */
	readonly needMb: number;
	readonly limit: MemoryLimit;
	/**
	 * `over` is the only one that should stop a boot.
	 *
	 * `unknown` must not: no cgroup file exists on macOS, on any BSD, or on bare-metal Linux
	 * without cgroup v2, so refusing there would make `pnpm dev` — a contract command — fail on
	 * the maintainers' own machines and on every contributor's.
	 */
	readonly verdict: 'fits' | 'over' | 'unknown';
}

/** cgroup v1 writes a near-`Int64.MAX` sentinel rather than omitting the file. */
const CGROUP_V1_UNLIMITED = 2 ** 53;

export const CGROUP_V2_PATH = '/sys/fs/cgroup/memory.max';
export const CGROUP_V1_PATH = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
export const LIMIT_ENV = 'PROXLANE_MEMORY_LIMIT_MB';

export function budgetMb(maxInflight: number, bodyCapMb: number): number {
	return Math.ceil(maxInflight * bodyCapMb * BUFFER_FACTOR);
}

/**
 * Find the memory limit this process is actually subject to.
 *
 * Both readers are injected so this is testable without a filesystem and without a container:
 * the interesting cases are "the file says max", "the file holds a v1 sentinel" and "there is
 * no file", none of which a test can produce on the machine it runs on.
 *
 * The explicit variable wins, and doubles as the escape hatch. An operator who knows the
 * arithmetic is too conservative for their workload states their real limit rather than
 * being handed a flag that turns the check off, which is the knob that ends up set to `true`
 * in every deployment.
 */
export function readMemoryLimit(
	readFile: (path: string) => string | undefined,
	env: (name: string) => string | undefined,
): MemoryLimit {
	const declared = env(LIMIT_ENV);
	if (declared !== undefined && declared.trim() !== '') {
		const mb = Number(declared);
		// A malformed value is NOT silently ignored: it was set deliberately, and treating it as
		// absent would run the check against a different limit than the operator believes.
		if (Number.isFinite(mb) && mb > 0) return { source: 'env', limitMb: Math.floor(mb) };
	}

	const v2 = readFile(CGROUP_V2_PATH)?.trim();
	if (v2 !== undefined && v2 !== '') {
		// Literally `max` when the cgroup exists but is uncapped.
		if (v2 !== 'max') {
			const bytes = Number(v2);
			if (Number.isFinite(bytes) && bytes > 0) {
				return { source: 'cgroup-v2', limitMb: Math.floor(bytes / 1024 / 1024) };
			}
		}
		// An uncapped cgroup is not a limit, so fall through rather than reporting one.
	}

	const v1 = readFile(CGROUP_V1_PATH)?.trim();
	if (v1 !== undefined && v1 !== '') {
		const bytes = Number(v1);
		if (Number.isFinite(bytes) && bytes > 0 && bytes < CGROUP_V1_UNLIMITED) {
			return { source: 'cgroup-v1', limitMb: Math.floor(bytes / 1024 / 1024) };
		}
	}

	return { source: 'none', limitMb: undefined };
}

export function assessMemory(
	maxInflight: number,
	bodyCapMb: number,
	limit: MemoryLimit,
): MemoryBudget {
	const needMb = budgetMb(maxInflight, bodyCapMb);
	if (limit.limitMb === undefined) return { needMb, limit, verdict: 'unknown' };
	return { needMb, limit, verdict: needMb <= limit.limitMb ? 'fits' : 'over' };
}

/** How the source reads in a message an operator has to act on. */
export function describeSource(source: MemorySource): string {
	switch (source) {
		case 'env':
			return `${LIMIT_ENV}`;
		case 'cgroup-v2':
			return 'the container memory limit (cgroup v2)';
		case 'cgroup-v1':
			return 'the container memory limit (cgroup v1)';
		case 'none':
			return 'no readable limit';
	}
}

/**
 * What to print when the budget does not fit.
 *
 * Names both fixes and the arithmetic, because "out of memory" without the numbers sends an
 * operator to the wrong one of the two knobs about half the time.
 */
export function overBudgetMessage(
	budget: MemoryBudget,
	maxInflight: number,
	bodyCapMb: number,
): string {
	const limitMb = budget.limit.limitMb ?? 0;
	const fits = Math.max(1, Math.floor(limitMb / (bodyCapMb * BUFFER_FACTOR)));
	return (
		`\n  This gateway is configured to need about ${budget.needMb} MB, and ${describeSource(budget.limit.source)}\n` +
		`  is ${limitMb} MB. It would be OOM-killed under load rather than answering 429.\n\n` +
		`      PROXLANE_MAX_INFLIGHT   ${maxInflight}\n` +
		`      PROXLANE_BODY_CAP_MB    ${bodyCapMb}\n` +
		`      ${maxInflight} x ${bodyCapMb} x ${BUFFER_FACTOR} = ${budget.needMb} MB needed, ${limitMb} MB available\n\n` +
		`  Either lower the ceiling:   PROXLANE_MAX_INFLIGHT=${fits}\n` +
		`  or give the container more memory.\n\n`
	);
}
