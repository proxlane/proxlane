// The honest-stub harness. Exits 1, never 0, and never 127.
//
// A zero-exit stub does not merely fail to help — it terminates the work. Eleven of the
// twelve agent briefs define done as "command X exits 0", so a command that exits 0 before
// its subject exists lets an agent satisfy its brief by the letter while having built
// nothing. Two of these commands are launch gates in operations.md section 9, where a
// vacuous 0 puts a false statement in the launch record.
//
// 127 is also wrong: it reads as "command not found", which is precisely the false claim
// being refuted. The command IS wired and reachable. It fails because its subject does not
// exist.
//
// Zero dependencies on purpose — this must run before `pnpm install` has ever succeeded.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

type Entry = {
	id: string;
	kind: string;
	owner: string;
	brief: string;
	spec: string;
	subject: string;
	blockedBy?: string[];
	status: string;
	gate?: string;
	ci: string;
};

const id = process.argv[2];
if (!id) {
	process.stderr.write('not-implemented.ts: expected a command id as argv[2]\n');
	process.exit(2);
}

const manifest = JSON.parse(
	readFileSync(join(ROOT, 'scripts/commands.json'), 'utf8'),
) as Record<string, Entry>;
const entry = manifest[id];

if (!entry) {
	process.stderr.write(
		`not-implemented.ts: "${id}" is not in scripts/commands.json.\n` +
			'Every command in the CLAUDE.md Commands table must have an entry.\n',
	);
	process.exit(2);
}

const invocation = entry.kind === 'bin' ? entry.id : `pnpm ${entry.id}`;
const subjectState = existsSync(join(ROOT, entry.subject))
	? '(EXISTS — flip status to "implemented" in scripts/commands.json)'
	: '(does not exist)';

const lines = [
	'',
	`NOT IMPLEMENTED: ${invocation}`,
	'',
	`  Owner     ${entry.owner}   ${entry.brief}`,
	`  Spec      ${entry.spec}`,
	`  Subject   ${entry.subject}   ${subjectState}`,
];

if (entry.blockedBy?.length) {
	lines.push(`  Blocked   ${entry.blockedBy.join('\n            ')}`);
}
if (entry.gate) {
	lines.push('', `  Gate      ${wrap(entry.gate, 12)}`);
}

lines.push(
	'',
	'  This command is wired and reachable. It fails because its subject does not',
	'  exist, not because the wiring is missing.',
	'',
);

process.stderr.write(lines.join('\n'));
process.exit(1);

function wrap(text: string, indent: number): string {
	const width = 76 - indent;
	const pad = ' '.repeat(indent);
	const out: string[] = [];
	let line = '';
	for (const word of text.split(/\s+/)) {
		if (line.length + word.length + 1 > width) {
			out.push(line);
			line = word;
		} else {
			line = line ? `${line} ${word}` : word;
		}
	}
	if (line) out.push(line);
	return out.join(`\n${pad}`);
}
