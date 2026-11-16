import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Vulnerability { severity: string }
export interface AuditReport { vulnerabilities: Record<string, Vulnerability>; error?: unknown }

export function auditFindings(report: AuditReport): string[] {
  if (report.error || !report.vulnerabilities) throw new Error('Audit did not return a usable vulnerability report.');
  return Object.entries(report.vulnerabilities).map(([name, vulnerability]) => `${name}: ${vulnerability.severity}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failures = 0;
  for (const project of ['.', 'simulator']) {
    const cwd = resolve(project);
    const result = spawnSync('npm', ['audit', '--json'], { cwd, encoding: 'utf8' });
    if (result.error || result.status === null || result.status > 1) {
      throw new Error(`npm audit failed for ${project}; refusing to treat a failed check as clean.`);
    }
    const report = JSON.parse(result.stdout) as AuditReport;
    const findings = auditFindings(report);
    console.log(`${project}: ${Object.keys(report.vulnerabilities).length} reported packages; ${findings.length} blocking findings.`);
    for (const finding of findings) console.error(finding);
    failures += findings.length;
  }
  console.log('All reported vulnerabilities fail the audit; no exceptions.');
  process.exitCode = failures ? 1 : 0;
}
