// Token Launch Radar — entry program (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, prices every protocol that records no
// token with the model in lib/model.ts, and writes the hand-in into the
// output directory:
//   board.json    the ranked board (rows with implied values and farm plans)
//   data.js       the same board as window.RADAR, for the dashboard
//   dashboard/    a copy of this repository's static dashboard
//   screenshots/  a copy of this repository's three screenshots
//   dossier.json  the judge's summary, built by vendor/makefun-board.ts
//
// In the grader's container the snapshot is at /input/snapshot.json and the
// output directory is /output. Locally:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../makefun/token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));

function flagValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && args[at + 1] !== undefined) return args[at + 1]!;
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = flagValue('input', process.env.MAKEFUN_INPUT_DIR ?? '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  process.stderr.write(`radar: no snapshot at ${snapshotPath} — pass --input <snapshot.json|dir> or set MAKEFUN_INPUT_DIR\n`);
  process.exit(2);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`radar: refusing to hand in a board the gate would refuse: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Recursively copy a directory's plain files (dot-names skipped) into the output. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (statSync(src).isDirectory()) {
      copied.push(...copyTree(src, join(to, name)));
    } else if (statSync(src).isFile()) {
      copyFileSync(src, join(to, name));
      copied.push(name);
    }
  }
  return copied;
}

const pageFiles = copyTree(join(repoDir, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyTree(join(repoDir, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`radar: screenshots/ holds ${shots.length} images — hand in 3: the board, a detail view and a filtered view\n`);
  process.exit(1);
}

// Written last, from the finished output, so the dossier matches byte for byte.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `radar: ${snapshot.protocols.length} protocols read, ${snapshot.watchlist.length} on the watchlist, ${board.length} pre-token rows ranked\n` +
    `radar: wrote board.json, data.js, dashboard/ (${pageFiles.length} files), screenshots/ (${shots.length} images), dossier.json into ${outDir}\n`,
);
