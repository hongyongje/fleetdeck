// FleetDeck HTTP API. Plain node:http, no framework.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { type Db, addEvent } from './db.ts';
import { evaluate, isOffline, type Sample } from './alerts.ts';
import { verifyPackage, sha256Hex } from './signing.ts';

export type Role = 'admin' | 'operator' | 'viewer';
interface Session { user: string; role: Role }

const USERS: Record<string, { password: string; role: Role }> = {
  admin: { password: 'demo', role: 'admin' },
  operator: { password: 'demo', role: 'operator' },
  viewer: { password: 'demo', role: 'viewer' },
};
const PAIR_CODE = process.env.FD_PAIR_CODE ?? 'FD-DEMO-PAIR';

export interface AppOptions { db: Db; publicKeyPem: string; staticDir?: string; now?: () => number }

export function createApp(opts: AppOptions): { server: Server; sweep: () => void } {
  const { db, publicKeyPem } = opts;
  const now = opts.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const streams = new Set<ServerResponse>();

  function broadcast(type: string, data: unknown) {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of streams) res.write(msg);
  }

  function event(deviceId: string | null, kind: string, message: string) {
    addEvent(db, deviceId, kind, message, now());
    broadcast('event', { ts: now(), deviceId, kind, message });
  }

  // ---- alerts: open / resolve with de-duplication per (device, rule) ----
  function syncAlerts(deviceId: string, firing: { rule: string; severity: string; message: string }[], rulesChecked: string[]) {
    const open = db.prepare('SELECT id, rule, severity FROM alerts WHERE device_id = ? AND resolved_at IS NULL').all(deviceId) as { id: number; rule: string; severity: string }[];
    for (const f of firing) {
      const cur = open.find((o) => o.rule === f.rule);
      if (!cur) {
        db.prepare('INSERT INTO alerts (device_id, rule, severity, message, opened_at) VALUES (?, ?, ?, ?, ?)').run(deviceId, f.rule, f.severity, f.message, now());
        event(deviceId, 'alert', `경보 발생: ${f.message}`);
        broadcast('alert', { deviceId, ...f });
      } else if (cur.severity !== f.severity) {
        db.prepare('UPDATE alerts SET severity = ?, message = ? WHERE id = ?').run(f.severity, f.message, cur.id);
        broadcast('alert', { deviceId, ...f });
      }
    }
    for (const o of open) {
      if (rulesChecked.includes(o.rule) && !firing.some((f) => f.rule === o.rule)) {
        db.prepare('UPDATE alerts SET resolved_at = ? WHERE id = ?').run(now(), o.id);
        event(deviceId, 'resolve', `경보 해제: ${o.rule}`);
        broadcast('alert', { deviceId, rule: o.rule, resolved: true });
      }
    }
  }

  /** Marks devices offline. Called on a timer; cheap because it only reads one row per device. */
  function sweep() {
    const devs = db.prepare('SELECT id, name, last_seen FROM devices').all() as { id: string; name: string; last_seen: number | null }[];
    for (const d of devs) {
      const off = isOffline(d.last_seen, now());
      syncAlerts(d.id, off ? [{ rule: 'offline', severity: 'critical', message: `${d.name} 응답 없음` }] : [], ['offline']);
    }
  }

  // ---- helpers ----
  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  async function body<T>(req: IncomingMessage, limit = 20 * 1024 * 1024): Promise<T> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, '요청이 너무 큽니다'); chunks.push(c as Buffer); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T; } catch { throw new HttpError(400, 'JSON 형식이 아닙니다'); }
  }
  function session(req: IncomingMessage, minRole: Role = 'viewer'): Session {
    const h = req.headers.authorization ?? '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : new URL(req.url ?? '/', 'http://x').searchParams.get('token') ?? '';
    const s = sessions.get(tok);
    if (!s) throw new HttpError(401, '로그인이 필요합니다');
    const rank: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };
    if (rank[s.role] < rank[minRole]) throw new HttpError(403, '권한이 없습니다');
    return s;
  }
  function device(req: IncomingMessage, id: string) {
    const tok = (req.headers['x-device-token'] as string) ?? '';
    const d = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as any;
    if (!d || d.token.length !== tok.length || !timingSafeEqual(Buffer.from(d.token), Buffer.from(tok))) throw new HttpError(401, '기기 인증 실패');
    return d;
  }

  // ---- routes ----
  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname; const m = req.method ?? 'GET';
    let g: RegExpMatchArray | null;

    if (m === 'POST' && p === '/api/auth/login') {
      const b = await body<{ user: string; password: string }>(req);
      const u = USERS[b.user];
      if (!u || u.password !== b.password) throw new HttpError(401, '아이디 또는 비밀번호가 맞지 않습니다');
      const token = randomBytes(24).toString('hex');
      sessions.set(token, { user: b.user, role: u.role });
      return json(res, 200, { token, user: b.user, role: u.role });
    }

    // device side ------------------------------------------------------
    if (m === 'POST' && p === '/api/devices/register') {
      const b = await body<{ serial: string; model: string; name?: string; site?: string; fw?: string; pairCode: string }>(req);
      if (b.pairCode !== PAIR_CODE) throw new HttpError(403, '페어링 코드가 맞지 않습니다');
      const existing = db.prepare('SELECT id, token FROM devices WHERE serial = ?').get(b.serial) as { id: string; token: string } | undefined;
      if (existing) return json(res, 200, { id: existing.id, token: existing.token });
      const id = randomUUID(); const token = randomBytes(24).toString('hex');
      db.prepare('INSERT INTO devices (id, serial, name, model, site, fw, token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, b.serial, b.name ?? b.serial, b.model, b.site ?? '', b.fw ?? '1.0.0', token, now());
      event(id, 'register', `${b.name ?? b.serial} 등록 (${b.model})`);
      broadcast('device', { id });
      return json(res, 201, { id, token });
    }
    if (m === 'POST' && (g = p.match(/^\/api\/devices\/([\w-]+)\/telemetry$/))) {
      const d = device(req, g[1]);
      const s = await body<Omit<Sample, 'ts'> & { fw?: string }>(req);
      const ts = now();
      const wasOffline = isOffline(d.last_seen, ts);
      db.prepare('INSERT INTO telemetry (device_id, ts, cpu, mem, temp, humidity, power) VALUES (?, ?, ?, ?, ?, ?, ?)').run(d.id, ts, s.cpu, s.mem, s.temp, s.humidity, s.power);
      db.prepare('UPDATE devices SET last_seen = ?, fw = COALESCE(?, fw) WHERE id = ?').run(ts, s.fw ?? null, d.id);
      if (wasOffline && d.last_seen != null) event(d.id, 'online', `${d.name} 다시 연결됨`);
      const recent = (db.prepare('SELECT ts, cpu, mem, temp, humidity, power FROM telemetry WHERE device_id = ? ORDER BY ts DESC LIMIT 5').all(d.id) as unknown as Sample[]).reverse();
      syncAlerts(d.id, evaluate(recent), ['temp', 'cpu', 'offline']);
      broadcast('telemetry', { id: d.id, ts, ...s });
      // Piggyback: a pending update rides on the telemetry response, so devices never poll a separate endpoint.
      const job = db.prepare(`SELECT j.id, p.version, p.sha256, p.signature, p.size FROM jobs j JOIN rollouts r ON r.id = j.rollout_id JOIN packages p ON p.id = r.package_id
                               WHERE j.device_id = ? AND j.status = 'pending' ORDER BY j.id LIMIT 1`).get(d.id) as any;
      if (job) {
        db.prepare("UPDATE jobs SET status = 'delivered', updated_at = ? WHERE id = ?").run(now(), job.id);
        broadcast('job', { id: job.id, status: 'delivered' });
      }
      return json(res, 200, { ok: true, update: job ? { jobId: job.id, version: job.version, sha256: job.sha256, signature: job.signature, size: job.size, url: `/api/devices/${d.id}/jobs/${job.id}/package` } : null });
    }
    if (m === 'GET' && (g = p.match(/^\/api\/devices\/([\w-]+)\/jobs\/(\d+)\/package$/))) {
      const d = device(req, g[1]);
      const row = db.prepare('SELECT p.content FROM jobs j JOIN rollouts r ON r.id = j.rollout_id JOIN packages p ON p.id = r.package_id WHERE j.id = ? AND j.device_id = ?').get(Number(g[2]), d.id) as any;
      if (!row) throw new HttpError(404, '작업이 없습니다');
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(Buffer.from(row.content));
    }
    if (m === 'POST' && (g = p.match(/^\/api\/devices\/([\w-]+)\/jobs\/(\d+)\/result$/))) {
      const d = device(req, g[1]);
      const b = await body<{ status: 'installing' | 'done' | 'failed'; detail?: string; version?: string }>(req);
      db.prepare('UPDATE jobs SET status = ?, detail = ?, updated_at = ? WHERE id = ? AND device_id = ?').run(b.status, b.detail ?? '', now(), Number(g[2]), d.id);
      if (b.status === 'done' && b.version) db.prepare('UPDATE devices SET fw = ? WHERE id = ?').run(b.version, d.id);
      if (b.status !== 'installing') event(d.id, b.status === 'done' ? 'update' : 'update-fail', b.status === 'done' ? `${d.name} 펌웨어 ${b.version} 설치 완료` : `${d.name} 업데이트 실패: ${b.detail ?? ''}`);
      broadcast('job', { id: Number(g[2]), status: b.status });
      return json(res, 200, { ok: true });
    }

    // admin side -------------------------------------------------------
    if (m === 'GET' && p === '/api/stream') {
      session(req);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    if (m === 'GET' && p === '/api/stats') {
      session(req);
      const devs = db.prepare('SELECT last_seen FROM devices').all() as { last_seen: number | null }[];
      const online = devs.filter((d) => !isOffline(d.last_seen, now())).length;
      const openAlerts = db.prepare('SELECT severity, COUNT(*) n FROM alerts WHERE resolved_at IS NULL GROUP BY severity').all() as { severity: string; n: number }[];
      const jobs = db.prepare("SELECT status, COUNT(*) n FROM jobs GROUP BY status").all() as { status: string; n: number }[];
      const since = now() - 10 * 60_000;
      const tempSeries = db.prepare(`SELECT (ts / 30000) * 30000 AS t, AVG(temp) temp, AVG(cpu) cpu FROM telemetry WHERE ts > ? GROUP BY t ORDER BY t`).all(since);
      return json(res, 200, { total: devs.length, online, openAlerts, jobs, tempSeries });
    }
    if (m === 'GET' && p === '/api/devices') {
      session(req);
      const rows = db.prepare(`SELECT d.id, d.serial, d.name, d.model, d.site, d.fw, d.last_seen,
          (SELECT temp FROM telemetry t WHERE t.device_id = d.id ORDER BY ts DESC LIMIT 1) temp,
          (SELECT cpu FROM telemetry t WHERE t.device_id = d.id ORDER BY ts DESC LIMIT 1) cpu,
          (SELECT power FROM telemetry t WHERE t.device_id = d.id ORDER BY ts DESC LIMIT 1) power,
          (SELECT COUNT(*) FROM alerts a WHERE a.device_id = d.id AND a.resolved_at IS NULL) alerts
        FROM devices d ORDER BY d.name`).all() as any[];
      return json(res, 200, rows.map((r) => ({ ...r, online: !isOffline(r.last_seen, now()) })));
    }
    if (m === 'GET' && (g = p.match(/^\/api\/devices\/([\w-]+)$/))) {
      session(req);
      const d = db.prepare('SELECT id, serial, name, model, site, fw, last_seen, created_at FROM devices WHERE id = ?').get(g[1]) as any;
      if (!d) throw new HttpError(404, '기기가 없습니다');
      const since = now() - Number(url.searchParams.get('minutes') ?? 15) * 60_000;
      const series = db.prepare('SELECT ts, cpu, mem, temp, humidity, power FROM telemetry WHERE device_id = ? AND ts > ? ORDER BY ts').all(d.id, since);
      const events = db.prepare('SELECT ts, kind, message FROM events WHERE device_id = ? ORDER BY id DESC LIMIT 30').all(d.id);
      const alerts = db.prepare('SELECT * FROM alerts WHERE device_id = ? ORDER BY id DESC LIMIT 20').all(d.id);
      return json(res, 200, { ...d, online: !isOffline(d.last_seen, now()), series, events, alerts });
    }
    if (m === 'GET' && p === '/api/alerts') {
      session(req);
      const onlyOpen = url.searchParams.get('open') === '1';
      const rows = db.prepare(`SELECT a.*, d.name device_name FROM alerts a JOIN devices d ON d.id = a.device_id ${onlyOpen ? 'WHERE a.resolved_at IS NULL' : ''} ORDER BY a.resolved_at IS NOT NULL, a.id DESC LIMIT 200`).all();
      return json(res, 200, rows);
    }
    if (m === 'POST' && (g = p.match(/^\/api\/alerts\/(\d+)\/ack$/))) {
      const s = session(req, 'operator');
      db.prepare('UPDATE alerts SET acked_by = ? WHERE id = ?').run(s.user, Number(g[1]));
      broadcast('alert', { id: Number(g[1]), acked: s.user });
      return json(res, 200, { ok: true });
    }
    if (m === 'GET' && p === '/api/events') {
      session(req);
      return json(res, 200, db.prepare('SELECT e.*, d.name device_name FROM events e LEFT JOIN devices d ON d.id = e.device_id ORDER BY e.id DESC LIMIT 100').all());
    }
    if (m === 'GET' && p === '/api/packages') {
      session(req);
      return json(res, 200, db.prepare('SELECT id, version, notes, sha256, size, uploaded_by, created_at FROM packages ORDER BY id DESC').all());
    }
    if (m === 'POST' && p === '/api/packages') {
      const s = session(req, 'admin');
      const b = await body<{ version: string; notes?: string; contentBase64: string; signature: string }>(req);
      const content = Buffer.from(b.contentBase64, 'base64');
      if (!/^\d+\.\d+\.\d+$/.test(b.version)) throw new HttpError(400, '버전은 1.2.3 형식이어야 합니다');
      if (!verifyPackage(publicKeyPem, b.version, content, b.signature)) {
        event(null, 'security', `서명 검증 실패로 패키지 ${b.version} 거절`);
        throw new HttpError(422, '서명이 맞지 않는 패키지입니다');
      }
      if (db.prepare('SELECT 1 FROM packages WHERE version = ?').get(b.version)) throw new HttpError(409, '같은 버전이 이미 있습니다(덮어쓰기 금지)');
      const r = db.prepare('INSERT INTO packages (version, notes, sha256, size, signature, content, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(b.version, b.notes ?? '', sha256Hex(content), content.length, b.signature, content, s.user, now());
      event(null, 'package', `패키지 ${b.version} 등록 (서명 확인)`);
      return json(res, 201, { id: Number(r.lastInsertRowid) });
    }
    if (m === 'GET' && p === '/api/rollouts') {
      session(req);
      const rows = db.prepare(`SELECT r.id, r.created_at, r.created_by, p.version,
          SUM(j.status = 'done') done, SUM(j.status = 'failed') failed, SUM(j.status IN ('pending','delivered','installing')) running, COUNT(j.id) total
        FROM rollouts r JOIN packages p ON p.id = r.package_id LEFT JOIN jobs j ON j.rollout_id = r.id GROUP BY r.id ORDER BY r.id DESC`).all();
      return json(res, 200, rows);
    }
    if (m === 'POST' && p === '/api/rollouts') {
      const s = session(req, 'operator');
      const b = await body<{ packageId: number; deviceIds: string[] }>(req);
      const pkg = db.prepare('SELECT version FROM packages WHERE id = ?').get(b.packageId) as { version: string } | undefined;
      if (!pkg || !b.deviceIds?.length) throw new HttpError(400, '패키지와 대상 기기를 고르십시오');
      const r = db.prepare('INSERT INTO rollouts (package_id, created_by, created_at) VALUES (?, ?, ?)').run(b.packageId, s.user, now());
      const rid = Number(r.lastInsertRowid);
      const ins = db.prepare("INSERT INTO jobs (rollout_id, device_id, status, updated_at) VALUES (?, ?, 'pending', ?)");
      for (const id of b.deviceIds) ins.run(rid, id, now());
      event(null, 'rollout', `${pkg.version} 배포 시작 · 대상 ${b.deviceIds.length}대 (${s.user})`);
      broadcast('job', { rolloutId: rid });
      return json(res, 201, { id: rid });
    }
    if (m === 'GET' && p === '/api/public-key') return json(res, 200, { publicKeyPem });

    // static web ------------------------------------------------------
    if (m === 'GET' && opts.staticDir && !p.startsWith('/api/')) return serveStatic(opts.staticDir, p, res);
    throw new HttpError(404, '없는 경로입니다');
  }

  const server = createServer((req, res) => {
    route(req, res).catch((e: unknown) => {
      const he = e instanceof HttpError ? e : new HttpError(500, '서버 오류');
      if (!(e instanceof HttpError)) console.error(e);
      if (!res.headersSent) json(res, he.status, { error: he.message });
    });
  });
  return { server, sweep };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
function serveStatic(dir: string, path: string, res: ServerResponse) {
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
  let file = join(dir, safe);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}
