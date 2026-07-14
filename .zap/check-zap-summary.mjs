// Severity gate for the ZAP baseline scan (docs4/23): High-risk findings
// block the pipeline; Medium/Low/Informational are reported but don't fail.
// Reads the traditional-json report produced by .zap/plan.yaml.
// Usage: node .zap/check-zap-summary.mjs [path/to/zap-baseline-web.json]
import { readFileSync } from 'node:fs';

const reportPath = process.argv[2] ?? '.zap/zap-baseline-web.json';
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

const alerts = (report.site ?? []).flatMap((s) => s.alerts ?? []);
const byRisk = new Map();
for (const a of alerts) {
  const risk = Number(a.riskcode);
  if (!byRisk.has(risk)) byRisk.set(risk, []);
  byRisk.get(risk).push(a);
}

const RISK_NAMES = { 3: 'High', 2: 'Medium', 1: 'Low', 0: 'Informational' };
for (const risk of [3, 2, 1, 0]) {
  for (const a of byRisk.get(risk) ?? []) {
    const count = a.instances?.length ?? 0;
    console.log(`[${RISK_NAMES[risk]}] ${a.alert} (rule ${a.pluginid}, ${count} instance${count === 1 ? '' : 's'})`);
  }
}

const high = byRisk.get(3) ?? [];
if (high.length > 0) {
  console.error(`\nFAIL: ${high.length} High-risk finding(s) — see report artifact.`);
  process.exit(1);
}
console.log(`\nPASS: no High-risk findings (${alerts.length} total alerts).`);
