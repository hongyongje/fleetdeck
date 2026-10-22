import { useEffect, useState } from 'react';
import { api, ago, me, type Pkg, type Rollout, type Device } from '../api.ts';

export function Updates({ tick }: { tick: number }) {
  const [pkgs, setPkgs] = useState<Pkg[]>([]); const [rolls, setRolls] = useState<Rollout[]>([]); const [devs, setDevs] = useState<Device[]>([]);
  const [pkgId, setPkgId] = useState<number | ''>(''); const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState(''); const [reload, setReload] = useState(0);
  useEffect(() => { api<Pkg[]>('/api/packages').then(setPkgs); api<Rollout[]>('/api/rollouts').then(setRolls); api<Device[]>('/api/devices').then(setDevs); }, [tick, reload]);

  async function upload(f: File) {
    try { const bundle = JSON.parse(await f.text()); await api('/api/packages', { method: 'POST', body: JSON.stringify(bundle) }); setMsg(`패키지 ${bundle.version} 서명 확인 후 등록`); setReload((x) => x + 1); }
    catch (e) { setMsg(`거절: ${(e as Error).message}`); }
  }
  async function start() {
    try { await api('/api/rollouts', { method: 'POST', body: JSON.stringify({ packageId: pkgId, deviceIds: [...sel] }) }); setSel(new Set()); setMsg('배포를 시작했습니다. 다음 상태 보고 때 기기에 전달됩니다.'); setReload((x) => x + 1); }
    catch (e) { setMsg((e as Error).message); }
  }
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <>
      <header><h2>원격 업데이트</h2><span className="muted">Ed25519 서명 패키지만 등록 · 기기도 설치 전에 다시 검증</span></header>
      <div className="grid2">
        <section className="card">
          <h3>패키지</h3>
          {me?.role === 'admin' && <label className="upload">서명된 패키지(.signed.json) 올리기<input type="file" accept=".json" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>}
          <table><thead><tr><th>버전</th><th>내용</th><th>SHA-256</th><th>크기</th><th>등록</th></tr></thead><tbody>
            {pkgs.map((p) => <tr key={p.id}><td><code>{p.version}</code></td><td>{p.notes}</td><td><code className="muted">{p.sha256.slice(0, 12)}…</code></td><td>{(p.size / 1024).toFixed(1)} KB</td><td className="muted">{p.uploaded_by} · {ago(p.created_at)}</td></tr>)}
          </tbody></table>
        </section>
        <section className="card">
          <h3>새 배포</h3>
          <select value={pkgId} onChange={(e) => setPkgId(Number(e.target.value) || '')}><option value="">패키지 선택</option>{pkgs.map((p) => <option key={p.id} value={p.id}>{p.version}</option>)}</select>
          <div className="pick">{devs.map((d) => <label key={d.id} className={sel.has(d.id) ? 'on' : ''}><input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} />{d.name}<small>{d.fw}</small></label>)}</div>
          <div className="row"><button className="chip" onClick={() => setSel(new Set(devs.map((d) => d.id)))}>전체 선택</button><button className="primary" disabled={!pkgId || !sel.size || me?.role === 'viewer'} onClick={start}>{sel.size}대에 배포</button></div>
          {msg && <div className="note">{msg}</div>}
        </section>
      </div>
      <section className="card flush">
        <table><thead><tr><th>#</th><th>버전</th><th>진행</th><th>완료</th><th>실패</th><th>진행 중</th><th>시작</th></tr></thead><tbody>
          {rolls.map((r) => (
            <tr key={r.id}><td>{r.id}</td><td><code>{r.version}</code></td>
              <td style={{ width: '34%' }}><div className="bar"><i className="done" style={{ width: `${(r.done / r.total) * 100}%` }} /><i className="fail" style={{ width: `${(r.failed / r.total) * 100}%` }} /></div></td>
              <td>{r.done}/{r.total}</td><td>{r.failed ? <span className="crit">{r.failed}</span> : 0}</td><td>{r.running}</td><td className="muted">{r.created_by} · {ago(r.created_at)}</td></tr>))}
        </tbody></table>
      </section>
    </>
  );
}
