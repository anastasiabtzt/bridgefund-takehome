import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { sign } from './sign.mjs';

test('Axios sender preserves signed raw bytes and request identity across retries', async () => {
  const calls = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    calls.push({ body: Buffer.concat(chunks).toString('utf8'), signature: request.headers['x-signature'] });
    response.writeHead(204).end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/webhooks/payments`;
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./send-webhook.mjs', import.meta.url)),
      '--url', url, '--session', '550e8400-e29b-41d4-a716-446655440000', '--amount', '1000',
      '--payment-id', 'transport-test', '--times', '2'],
    { env: { ...process.env, WEBHOOK_SECRET: 'local-test-secret' }, timeout: 5000 });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[0].signature, sign(calls[0].body, 'local-test-secret'));
    assert.equal(JSON.parse(calls[0].body).paymentId, 'transport-test');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
