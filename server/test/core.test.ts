import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, isOffline, THRESHOLDS } from '../src/alerts.ts';
import { generateKeys, signPackage, verifyPackage } from '../src/signing.ts';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';

const s = (temp: number, cpu = 10) => ({ ts: 0, cpu, mem: 30, temp, humidity: 40, power: 100 });

test('temperature rule: warning then critical', () => {
  assert.deepEqual(evaluate([s(50)]), []);
  assert.equal(evaluate([s(61)])[0].severity, 'warning');
  assert.equal(evaluate([s(71)])[0].severity, 'critical');
});

test('cpu rule needs consecutive samples', () => {
  assert.equal(evaluate([s(30, 95), s(30, 40), s(30, 95)]).length, 0);
  assert.equal(evaluate([s(30, 95), s(30, 96), s(30, 97)])[0].rule, 'cpu');
});

test('offline after threshold', () => {
  assert.equal(isOffline(1000, 1000 + THRESHOLDS.offlineMs - 1), false);
  assert.equal(isOffline(1000, 1000 + THRESHOLDS.offlineMs + 1), true);
  assert.equal(isOffline(null, 0), true);
});

test('package signature binds version and content', () => {
  const k = generateKeys();
  const content = new TextEncoder().encode('firmware-bytes');
  const { signature } = signPackage(k.privateKey, '1.2.0', content);
  assert.equal(verifyPackage(k.publicKey, '1.2.0', content, signature), true);
  assert.equal(verifyPackage(k.publicKey, '1.3.0', content, signature), false, 'replay on another version');
  assert.equal(verifyPackage(k.publicKey, '1.2.0', new TextEncoder().encode('tampered'), signature), false, 'tampered content');
  assert.equal(verifyPackage(generateKeys().publicKey, '1.2.0', content, signature), false, 'wrong key');
});

test('end to end: register, telemetry, alert, signed rollout piggybacked on telemetry', async () => {
  const k = generateKeys();
  let clock = 1_000_000;
  const { server } = createApp({ db: openDb(':memory:'), publicKeyPem: k.publicKey, now: () => clock });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  const j = (p: string, init: RequestInit = {}) => fetch(base + p, init).then(async (r) => ({ status: r.status, body: await r.json() as any }));
  try {
    const login = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ user: 'admin', password: 'demo' }) });
    const auth = { authorization: `Bearer ${login.body.token}` };
    const reg = await j('/api/devices/register', { method: 'POST', body: JSON.stringify({ serial: 'T-1', model: 'TH-100', pairCode: 'FD-DEMO-PAIR' }) });
    const dev = { 'x-device-token': reg.body.token };
    const tel = (temp: number) => j(`/api/devices/${reg.body.id}/telemetry`, { method: 'POST', headers: dev, body: JSON.stringify({ cpu: 10, mem: 30, temp, humidity: 40, power: 100 }) });

    await tel(72);
    let alerts = await j('/api/alerts?open=1', { headers: auth });
    assert.equal(alerts.body[0].severity, 'critical');
    clock += 1000; await tel(30);
    alerts = await j('/api/alerts?open=1', { headers: auth });
    assert.equal(alerts.body.length, 0, 'alert resolves when value recovers');

    const content = new TextEncoder().encode('fw-1.1.0');
    const bad = await j('/api/packages', { method: 'POST', headers: auth, body: JSON.stringify({ version: '1.1.0', contentBase64: Buffer.from(content).toString('base64'), signature: 'AAAA' }) });
    assert.equal(bad.status, 422, 'unsigned package rejected');
    const { signature } = signPackage(k.privateKey, '1.1.0', content);
    const pkg = await j('/api/packages', { method: 'POST', headers: auth, body: JSON.stringify({ version: '1.1.0', contentBase64: Buffer.from(content).toString('base64'), signature }) });
    assert.equal(pkg.status, 201);
    await j('/api/rollouts', { method: 'POST', headers: auth, body: JSON.stringify({ packageId: pkg.body.id, deviceIds: [reg.body.id] }) });
    const t = await tel(31);
    assert.equal(t.body.update.version, '1.1.0', 'update rides on the telemetry response');

    const viewer = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ user: 'viewer', password: 'demo' }) });
    const denied = await j('/api/rollouts', { method: 'POST', headers: { authorization: `Bearer ${viewer.body.token}` }, body: '{}' });
    assert.equal(denied.status, 403, 'viewer cannot start rollouts');
  } finally {
    server.close();
  }
});
