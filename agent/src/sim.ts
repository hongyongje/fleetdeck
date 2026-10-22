// Virtual device fleet. Each device registers with a pairing code, reports telemetry,
// and installs signed updates that ride on the telemetry response.
// node agent/src/sim.ts [--server http://localhost:8787] [--count 12]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPackage } from '../../server/src/signing.ts';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const SERVER = arg('--server', 'http://localhost:8787');
const COUNT = Number(arg('--count', '12'));
const TICK_MS = Number(arg('--tick', '3000'));
const HEARTBEAT_MS = 15_000;             // send at least this often even if nothing changed
const STATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'sim-state.json');
const saved: Record<string, string> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const PUB = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'keys', 'release.pub.pem'), 'utf8');

type Profile = 'normal' | 'overheat' | 'flaky' | 'busy' | 'lowdisk';
const SITES = ['서울 본사', '판교 랩', '부산 물류센터', '대전 공장'];
const MODELS = ['TH-100 온습도 센서', 'PM-200 전력 계측기', 'GW-300 게이트웨이'];

class VirtualDevice {
  id = ''; token = ''; fw = '1.0.0';
  t = 24 + Math.random() * 6; hum = 40 + Math.random() * 15; cpu = 10 + Math.random() * 20; power = 80 + Math.random() * 40;
  lastSent = { t: 0, cpu: 0, at: 0 };
  offlineUntil = 0; installing = false; tick = 0;
  readonly serial: string; readonly name: string; readonly model: string; readonly site: string; readonly profile: Profile;
  constructor(serial: string, name: string, model: string, site: string, profile: Profile) {
    this.serial = serial; this.name = name; this.model = model; this.site = site; this.profile = profile;
    this.fw = saved[serial] ?? '1.0.0';  // firmware survives a device restart, like real flash
  }

  async register() {
    const r = await fetch(`${SERVER}/api/devices/register`, { method: 'POST', body: JSON.stringify({ serial: this.serial, name: this.name, model: this.model, site: this.site, fw: this.fw, pairCode: 'FD-DEMO-PAIR' }) });
    const b = await r.json() as { id: string; token: string };
    this.id = b.id; this.token = b.token;
  }

  step() {
    this.tick++;
    const drift = (v: number, lo: number, hi: number, s: number) => Math.min(hi, Math.max(lo, v + (Math.random() - 0.5) * s));
    this.hum = drift(this.hum, 25, 80, 2);
    this.power = drift(this.power, 40, 220, 8);
    this.cpu = drift(this.cpu, 3, 60, 8);
    // overheat: slow climb past the thresholds, then cool down (fan recovers)
    if (this.profile === 'overheat') { const phase = this.tick % 150; this.t = phase < 110 ? Math.min(73 + Math.random(), this.t + 1.1) : Math.max(30, this.t - 1.5); }
    else this.t = drift(this.t, 18, 45, 0.8);
    if (this.profile === 'busy' && this.tick % 80 > 35) this.cpu = 92 + Math.random() * 7;
    if (this.profile === 'flaky' && this.tick % 120 === 20) this.offlineUntil = Date.now() + 120_000;
  }

  /** Low-load reporting: only send when values moved meaningfully or a heartbeat is due. */
  shouldSend(now: number) {
    return Math.abs(this.t - this.lastSent.t) >= 0.5 || Math.abs(this.cpu - this.lastSent.cpu) >= 10 || now - this.lastSent.at >= HEARTBEAT_MS;
  }

  async report() {
    const now = Date.now();
    if (now < this.offlineUntil || !this.shouldSend(now)) return;
    const res = await fetch(`${SERVER}/api/devices/${this.id}/telemetry`, {
      method: 'POST', headers: { 'x-device-token': this.token },
      body: JSON.stringify({ cpu: +this.cpu.toFixed(1), mem: +(35 + this.cpu / 3).toFixed(1), temp: +this.t.toFixed(1), humidity: +this.hum.toFixed(1), power: +this.power.toFixed(1), fw: this.fw }),
    });
    this.lastSent = { t: this.t, cpu: this.cpu, at: now };
    const b = await res.json() as { update: null | { jobId: number; version: string; signature: string; url: string } };
    if (b.update && !this.installing) void this.install(b.update);
  }

  async install(u: { jobId: number; version: string; signature: string; url: string }) {
    this.installing = true;
    const post = (status: string, detail = '', version?: string) => fetch(`${SERVER}/api/devices/${this.id}/jobs/${u.jobId}/result`, { method: 'POST', headers: { 'x-device-token': this.token }, body: JSON.stringify({ status, detail, version }) });
    try {
      const pkg = new Uint8Array(await (await fetch(`${SERVER}${u.url}`, { headers: { 'x-device-token': this.token } })).arrayBuffer());
      if (!verifyPackage(PUB, u.version, pkg, u.signature)) { await post('failed', '서명 검증 실패 - 설치 거부'); return; }
      await post('installing');
      await new Promise((r) => setTimeout(r, 4000 + Math.random() * 4000));
      if (this.profile === 'lowdisk') { await post('failed', '저장 공간 부족 (여유 12MB, 필요 48MB)'); return; }
      this.fw = u.version;
      saved[this.serial] = u.version; writeFileSync(STATE, JSON.stringify(saved));
      await post('done', '', u.version);
    } finally { this.installing = false; }
  }
}

const profiles: Profile[] = ['overheat', 'flaky', 'busy', 'lowdisk'];
const fleet = Array.from({ length: COUNT }, (_, i) => {
  const model = MODELS[i % MODELS.length];
  const prefix = model.slice(0, 2);
  return new VirtualDevice(`FD-${prefix}-${String(1001 + i)}`, `${prefix}-${String(i + 1).padStart(2, '0')}`, model, SITES[i % SITES.length], profiles[i] ?? 'normal');
});

for (const d of fleet) { await d.register(); }
console.log(`가상 기기 ${fleet.length}대 등록 완료 -> ${SERVER}`);
setInterval(() => { for (const d of fleet) { d.step(); d.report().catch((e) => console.error(d.name, e.message)); } }, TICK_MS);
