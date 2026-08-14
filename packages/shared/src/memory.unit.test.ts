import { describe, expect, it } from 'vitest';
import {
	assessMemory,
	budgetMb,
	CGROUP_V1_PATH,
	CGROUP_V2_PATH,
	LIMIT_ENV,
	readMemoryLimit,
} from './memory.js';

/** A filesystem that only has the files a test names. */
const files = (map: Record<string, string>) => (p: string) => map[p];
const noEnv = () => undefined;

describe('budgetMb', () => {
	it('is inflight x cap x the buffer factor', () => {
		expect(budgetMb(32, 10)).toBe(800);
		expect(budgetMb(8, 10)).toBe(200);
	});

	it('rounds up, because a partial megabyte still has to exist', () => {
		expect(budgetMb(1, 1)).toBe(3);
	});
});

describe('readMemoryLimit', () => {
	it('prefers the explicit variable over any cgroup file', () => {
		// It doubles as the escape hatch: an operator who knows the arithmetic is wrong for
		// their workload states their real limit rather than disabling the check.
		const limit = readMemoryLimit(files({ [CGROUP_V2_PATH]: '536870912' }), (n) =>
			n === LIMIT_ENV ? '4096' : undefined,
		);
		expect(limit).toEqual({ source: 'env', limitMb: 4096 });
	});

	it('reads cgroup v2 in bytes', () => {
		expect(readMemoryLimit(files({ [CGROUP_V2_PATH]: '536870912\n' }), noEnv)).toEqual({
			source: 'cgroup-v2',
			limitMb: 512,
		});
	});

	it('treats a cgroup v2 of `max` as no limit, not as a limit of zero', () => {
		// THE TRAP. `max` parses to NaN; a naive Number() would produce a limit of 0 and refuse
		// every boot in an uncapped container, which is the common case on a plain VPS.
		expect(readMemoryLimit(files({ [CGROUP_V2_PATH]: 'max\n' }), noEnv)).toEqual({
			source: 'none',
			limitMb: undefined,
		});
	});

	it('falls back to cgroup v1', () => {
		expect(readMemoryLimit(files({ [CGROUP_V1_PATH]: '268435456' }), noEnv)).toEqual({
			source: 'cgroup-v1',
			limitMb: 256,
		});
	});

	it('ignores the cgroup v1 unlimited sentinel', () => {
		// v1 writes a near-Int64.MAX number rather than omitting the file, so a plain read
		// reports roughly 8 exabytes of headroom and the check passes on anything.
		expect(readMemoryLimit(files({ [CGROUP_V1_PATH]: '9223372036854771712' }), noEnv)).toEqual({
			source: 'none',
			limitMb: undefined,
		});
	});

	it('reports none when no file exists', () => {
		// macOS, any BSD, and bare-metal Linux without cgroup v2. This must not be an error.
		expect(readMemoryLimit(files({}), noEnv)).toEqual({ source: 'none', limitMb: undefined });
	});

	it('ignores a malformed explicit value rather than trusting it', () => {
		for (const bad of ['', '   ', 'lots', '0', '-512']) {
			expect(
				readMemoryLimit(files({}), (n) => (n === LIMIT_ENV ? bad : undefined)),
				bad,
			).toEqual({ source: 'none', limitMb: undefined });
		}
	});

	it('never consults total system memory', () => {
		// Not a behaviour test so much as a statement of the rule: with no cgroup and no
		// variable the answer is "unknown", never the host's RAM. Inside a limited container
		// os.totalmem() reports the host, which is the hole this check exists to close.
		expect(readMemoryLimit(files({}), noEnv).limitMb).toBeUndefined();
	});
});

describe('assessMemory', () => {
	it('fits when the budget is under the limit', () => {
		const v = assessMemory(32, 10, { source: 'cgroup-v2', limitMb: 1024 });
		expect(v.verdict).toBe('fits');
		expect(v.needMb).toBe(800);
	});

	it('is over when the budget exceeds the limit', () => {
		expect(assessMemory(32, 10, { source: 'cgroup-v2', limitMb: 512 }).verdict).toBe('over');
	});

	it('fits exactly at the limit', () => {
		expect(assessMemory(32, 10, { source: 'env', limitMb: 800 }).verdict).toBe('fits');
	});

	it('is unknown, never over, when no limit is readable', () => {
		// The property that keeps `pnpm dev` working off a container. A gateway that refuses to
		// start on a developer machine because it cannot find a cgroup file is a broken gateway.
		const v = assessMemory(1024, 100, { source: 'none', limitMb: undefined });
		expect(v.verdict).toBe('unknown');
	});
});
