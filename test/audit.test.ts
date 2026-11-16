import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditFindings, AuditReport } from '../scripts/audit.js';

test('audit fails closed for every reported vulnerability, including former exceptions', () => {
  assert.deepEqual(auditFindings({ vulnerabilities: {} }), []);
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) {
    assert.deepEqual(auditFindings({ vulnerabilities: { minimatch: { severity }, esbuild: { severity }, other: { severity } } }),
      [`minimatch: ${severity}`, `esbuild: ${severity}`, `other: ${severity}`]);
  }
  assert.throws(() => auditFindings({ vulnerabilities: {}, error: 'network' }));
  assert.throws(() => auditFindings({} as AuditReport));
});
