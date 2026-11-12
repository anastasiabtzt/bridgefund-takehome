import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditFindings, AuditReport } from '../scripts/audit.js';

test('audit triage is advisory-specific, dev-only, expiring and fail-closed', () => {
  const report: AuditReport = { vulnerabilities: { minimatch: {
    via: [{ url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249', severity: 'moderate' }],
    severity: 'moderate', nodes: ['node_modules/minimatch'],
  } } };
  const lock = { packages: { 'node_modules/minimatch': { dev: true } } };
  assert.deepEqual(auditFindings(report, lock, true, '2026-11-12'), []);
  assert.equal(auditFindings(report, lock, false, '2026-11-12').length, 1);
  assert.equal(auditFindings(report, lock, true, '2026-11-19').length, 1);
  assert.equal(auditFindings(report, { packages: { 'node_modules/minimatch': {} } }, true, '2026-11-12').length, 1);
  const unknown = structuredClone(report);
  unknown.vulnerabilities.minimatch.via = [{ url: 'https://github.com/advisories/NEW', severity: 'moderate' }];
  assert.equal(auditFindings(unknown, lock, true, '2026-11-12').length, 1);
  assert.throws(() => auditFindings({ ...report, error: 'network' }, lock, true, '2026-11-12'));
});
