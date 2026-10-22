export interface Device {
  id: string; serial: string; name: string; model: string; site: string; fw: string;
  last_seen: number | null; online: boolean; temp: number | null; cpu: number | null; power: number | null; alerts: number;
}
export interface Alert {
  id: number; device_id: string; device_name: string; rule: string; severity: 'warning' | 'critical';
  message: string; opened_at: number; resolved_at: number | null; acked_by: string | null;
}
export interface EventRow { id: number; ts: number; device_id: string | null; device_name?: string; kind: string; message: string }
export interface Pkg { id: number; version: string; notes: string; sha256: string; size: number; uploaded_by: string; created_at: number }
export interface Rollout { id: number; version: string; created_by: string; created_at: number; done: number; failed: number; running: number; total: number }
export interface Stats { total: number; online: number; openAlerts: { severity: string; n: number }[]; jobs: { status: string; n: number }[]; tempSeries: { t: number; temp: number; cpu: number }[] }
export interface Sample { ts: number; cpu: number; mem: number; temp: number; humidity: number; power: number }
export interface DeviceDetail extends Omit<Device, 'alerts'> { created_at: number; series: Sample[]; events: EventRow[]; alerts: Alert[] }

let token = localStorage.getItem('fd_token') ?? '';
export let me: { user: string; role: string } | null = JSON.parse(localStorage.getItem('fd_me') ?? 'null');

export async function login(user: string, password: string) {
  const r = await fetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ user, password }) });
  const b = await r.json();
  if (!r.ok) throw new Error(b.error);
  token = b.token; me = { user: b.user, role: b.role };
  localStorage.setItem('fd_token', token); localStorage.setItem('fd_me', JSON.stringify(me));
}
export function logout() { token = ''; me = null; localStorage.removeItem('fd_token'); localStorage.removeItem('fd_me'); }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  const b = await r.json();
  if (r.status === 401) { logout(); location.reload(); }
  if (!r.ok) throw new Error(b.error ?? r.statusText);
  return b as T;
}

export function stream(onEvent: (type: string, data: any) => void): () => void {
  const es = new EventSource(`/api/stream?token=${token}`);
  for (const t of ['telemetry', 'alert', 'event', 'job', 'device']) es.addEventListener(t, (e) => onEvent(t, JSON.parse((e as MessageEvent).data)));
  return () => es.close();
}

export const ago = (ts: number | null) => {
  if (!ts) return '-';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `${s}초 전` : s < 3600 ? `${Math.round(s / 60)}분 전` : `${Math.round(s / 3600)}시간 전`;
};
export const clock = (ts: number) => new Date(ts).toLocaleTimeString('ko-KR', { hour12: false });
