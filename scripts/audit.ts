import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Advisory { url: string; severity: string }
interface Vulnerability { via: (string | Advisory)[]; nodes: string[]; severity: string }
export interface AuditReport { vulnerabilities: Record<string, Vulnerability>; error?: unknown }
export interface Lockfile { packages: Record<string, { dev?: boolean }> }

// Short-lived, dev-only exceptions; no production or simulator exceptions.
// minimatch: fixed local lint globs, not attacker-controlled runtime patterns.
// esbuild: Drizzle Kit's transitive loader; no esbuild serve/Studio command is used.
// Upstream-compatible fixes are preferred over npm audit fix --force downgrades.
const exceptions = new Set(['GHSA-g3hv-75wg-m249', 'GHSA-67mh-4wv8-2f99']);
const reviewDeadline = '2026-11-19';

export function auditFindings(report: AuditReport, lock: Lockfile, allowDevExceptions: boolean, date: string): string[] {
  if (report.error || !report.vulnerabilities) throw new Error('Audit did not return a usable vulnerability report.');
  function advisories(name: string, visited = new Set<string>()): Advisory[] {
    if (visited.has(name)) throw new Error(`Unresolved audit dependency cycle: ${name}`);
    const vulnerability = report.vulnerabilities[name];
    if (!vulnerability) throw new Error(`Missing audit dependency: ${name}`);
    return vulnerability.via.flatMap((item) => typeof item === 'string'
      ? advisories(item, new Set([...visited, name])) : [item]);
  }
  return Object.entries(report.vulnerabilities).flatMap(([name, vulnerability]) => {
    const sources = advisories(name);
    const excepted = allowDevExceptions && date < reviewDeadline
      && vulnerability.severity === 'moderate' && vulnerability.nodes.length > 0
      && vulnerability.nodes.every((node) => lock.packages[node]?.dev === true)
      && sources.length > 0 && sources.every((source) => source.severity === 'moderate'
        && exceptions.has(source.url.split('/').at(-1) ?? ''));
    return excepted ? [] : [`${name}: ${vulnerability.severity} (untriaged, runtime, or exception review due)`];
  });
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
    const lock = JSON.parse(readFileSync(resolve(cwd, 'package-lock.json'), 'utf8')) as Lockfile;
    const findings = auditFindings(report, lock, project === '.', new Date().toISOString().slice(0, 10));
    console.log(`${project}: ${Object.keys(report.vulnerabilities).length} reported packages; ${findings.length} blocking findings.`);
    for (const finding of findings) console.error(finding);
    failures += findings.length;
  }
  console.log(`Dev-only exceptions require review before ${reviewDeadline}; new advisories fail closed.`);
  process.exitCode = failures ? 1 : 0;
}
