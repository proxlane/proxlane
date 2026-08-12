// UUIDv7, per RFC 9562.
//
// `plan.md` section 3: "IDs are uuidv7, generated in-process, because writes are batched."
// Batching is the reason a database default is not an option — the gateway must know the id
// before the row exists, so it can go back to the caller in `X-Request-Id` on a request that
// is only written to Postgres seconds later, or not at all.
//
// Time-ordered matters beyond tidiness here. `requests` is partitioned by week and indexed on
// its primary key; random v4 ids scatter inserts across the whole B-tree, which is the
// classic write-amplification problem on a table that only ever appends.
//
// Layout, most significant first:
//   48 bits  unix milliseconds
//    4 bits  version, 0b0111
//   12 bits  rand_a — used here as a monotonic counter, see below
//    2 bits  variant, 0b10
//   62 bits  rand_b
//
// WHY NOT `crypto.randomUUIDv7`, WHICH NODE NOW HAS. It is a fair question and the answer is
// two measurements, not taste.
//
//   Version floor. Measured on the machines this repo pins: ABSENT in Node 24.9.0, present in
//   24.19.0. `engines.node` is `>=24.11.0`, so the built-in straddles our own declared floor —
//   a self-hoster on a version we explicitly support would get `undefined is not a function`.
//   Revisit if the floor ever rises above whichever 24.x added it.
//
//   Not monotonic. Of 2000 ids drawn inside one millisecond, ~50% of consecutive pairs sort
//   backwards. Coarse ordering by millisecond survives, which is all B-tree locality needs,
//   but `ORDER BY id` over same-millisecond rows is then arbitrary — and a gateway at any real
//   rate produces many per millisecond, so "the last N requests" would be non-deterministic.
//   It also has no defence against a clock stepping backwards.
//
// Related trap, since it costs nothing to record: `crypto.randomUUID({ version: 7 })` does not
// throw and does not return a v7. It ignores the option and hands back a v4.

import { randomBytes, randomInt } from 'node:crypto';

/** 12 bits of `rand_a`. */
const SEQ_MAX = 0xfff;

/**
 * Seed the counter in the low half of its range rather than at zero.
 *
 * RFC 9562 section 6.2 calls this out: a counter always starting at zero leaks how many ids
 * were issued in a millisecond, and starting anywhere in the full range risks immediate
 * rollover. Half leaves 2048 spare in the same millisecond, far past what one process serves.
 */
const SEED_MAX = 0x7ff;

/**
 * A generator with its own monotonic state.
 *
 * A factory rather than module-level `let`s. Monotonicity is inherently stateful, and hidden
 * process-wide state is the kind that makes tests order-dependent: a test pinning a timestamp
 * is silently corrected by whatever an earlier test left behind, so it asserts the guard
 * instead of the encoding it meant to check. That happened while writing this file.
 *
 * Production uses the single `uuidv7` below. Anything needing an isolated clock makes its own.
 */
export function createIdGenerator(): (nowMs?: number) => string {
	let lastMs = -1;
	let seq = 0;
	return (nowMs: number = Date.now()): string => {
		if (nowMs > lastMs) {
			lastMs = nowMs;
			seq = randomInt(0, SEED_MAX + 1);
		} else {
			// Same millisecond, or the clock went backwards. Either way, do not go backwards.
			seq += 1;
			if (seq > SEQ_MAX) {
				// Counter exhausted inside one millisecond: borrow from the next. Correct rather
				// than clever — the alternative is blocking, and 4096 ids in a millisecond is far
				// beyond anything this process will do.
				lastMs += 1;
				seq = 0;
			}
		}
		return encode(lastMs, seq);
	};
}

/**
 * The process-wide generator.
 *
 * Monotonic within a process even when two calls land in the same millisecond, and monotonic
 * across a clock that steps backwards — NTP corrections and suspended laptops both do this,
 * and an id that goes backwards would break the "time-ordered" property that the partition
 * and index layout depend on. When the clock regresses the last timestamp is reused and the
 * counter advances instead, so ordering holds even though the embedded time briefly does not.
 */
export const uuidv7: (nowMs?: number) => string = createIdGenerator();

function encode(ms: number, seq: number): string {
	const b = randomBytes(16);
	// 48-bit timestamp. Written in two halves because a 48-bit integer exceeds what bitwise
	// operators can hold — `>>` coerces to int32, which would silently truncate.
	b[0] = Math.floor(ms / 2 ** 40) & 0xff;
	b[1] = Math.floor(ms / 2 ** 32) & 0xff;
	b[2] = Math.floor(ms / 2 ** 24) & 0xff;
	b[3] = Math.floor(ms / 2 ** 16) & 0xff;
	b[4] = Math.floor(ms / 2 ** 8) & 0xff;
	b[5] = ms & 0xff;
	// Version 7 in the high nibble, the counter's top 4 bits in the low nibble.
	b[6] = 0x70 | ((seq >> 8) & 0x0f);
	b[7] = seq & 0xff;
	// Variant 0b10, keeping the 6 random bits already in place.
	b[8] = 0x80 | ((b[8] as number) & 0x3f);

	const hex = b.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The millisecond encoded in a v7 id. Reading it back is how the tests stay honest. */
export function uuidv7Time(id: string): number {
	return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

/**
 * What we accept as a caller-supplied request id.
 *
 * Deliberately narrow. This value is echoed into a response header, written to the request
 * log, and shown in support threads, so it is attacker-controlled input on three surfaces at
 * once. The charset excludes CR and LF (header splitting), and the length bound stops a
 * caller making every log line arbitrarily large.
 *
 * Not restricted to UUIDs: callers arrive with their own trace ids, and forcing our format
 * would mean they cannot correlate with their own systems, which is the entire point.
 */
const CALLER_ID = /^[A-Za-z0-9_.-]{1,64}$/;

export function isValidRequestId(value: string): boolean {
	return CALLER_ID.test(value);
}

/**
 * The id for this request: the caller's if usable, otherwise a fresh one.
 *
 * A rejected value is replaced silently rather than erroring. Refusing the whole request over
 * a malformed trace header would turn a debugging aid into an outage, and the caller still
 * gets a usable id back in the response.
 */
export function requestIdFrom(supplied: string | undefined | null): string {
	if (typeof supplied === 'string' && isValidRequestId(supplied)) return supplied;
	return uuidv7();
}
