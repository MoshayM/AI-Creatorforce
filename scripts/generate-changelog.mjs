#!/usr/bin/env node
/**
 * Changelog generator (docs4/29 / docs4/45): regenerates CHANGELOG.md from
 * conventional-commit history. No tags exist in this local-first repo, so
 * entries are grouped by commit date (newest first) instead of releases;
 * switch to tag ranges once releases are cut.
 *
 * Usage: node scripts/generate-changelog.mjs   (or `pnpm changelog`)
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const TYPE_HEADINGS = {
  feat: 'Features',
  fix: 'Fixes',
  perf: 'Performance',
  refactor: 'Refactoring',
  docs: 'Documentation',
  test: 'Tests',
  chore: 'Chores',
  ci: 'CI',
  build: 'Build',
};
const TYPE_ORDER = Object.keys(TYPE_HEADINGS);

const raw = execSync('git log --pretty=format:%h%x09%ad%x09%s --date=short', {
  encoding: 'utf8',
});

// date → type → [{hash, scope, subject}]
const byDate = new Map();
let unconventional = 0;

for (const line of raw.split('\n')) {
  const [hash, date, ...rest] = line.split('\t');
  const subject = rest.join('\t');
  const m = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
  if (!m || !TYPE_HEADINGS[m[1]]) {
    unconventional++;
    continue;
  }
  const [, type, scope, breaking, text] = m;
  if (!byDate.has(date)) byDate.set(date, new Map());
  const byType = byDate.get(date);
  if (!byType.has(type)) byType.set(type, []);
  byType.get(type).push({ hash, scope, breaking: !!breaking, text });
}

let out = '# Changelog\n\n';
out += '> Generated from conventional commits by `pnpm changelog` — do not edit by hand.\n';

for (const [date, byType] of byDate) {
  out += `\n## ${date}\n`;
  for (const type of TYPE_ORDER) {
    const entries = byType.get(type);
    if (!entries) continue;
    out += `\n### ${TYPE_HEADINGS[type]}\n\n`;
    for (const e of entries) {
      const scope = e.scope ? `**${e.scope}**: ` : '';
      const bang = e.breaking ? ' **[BREAKING]**' : '';
      out += `- ${scope}${e.text}${bang} (${e.hash})\n`;
    }
  }
}

writeFileSync('CHANGELOG.md', out);
const days = byDate.size;
const total = [...byDate.values()].reduce(
  (s, m) => s + [...m.values()].reduce((a, v) => a + v.length, 0),
  0,
);
console.log(
  `changelog: wrote CHANGELOG.md — ${total} conventional commit(s) across ${days} day(s)` +
  (unconventional ? `; skipped ${unconventional} non-conventional` : ''),
);
