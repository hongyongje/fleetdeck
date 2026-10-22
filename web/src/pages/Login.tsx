import { useState } from 'react';
import { login } from '../api.ts';

export function Login() {
  const [user, setUser] = useState('admin'); const [pw, setPw] = useState('demo'); const [err, setErr] = useState('');
  return (
    <div className="login">
      <form onSubmit={async (e) => { e.preventDefault(); try { await login(user, pw); location.reload(); } catch (x) { setErr((x as Error).message); } }}>
        <h1>FleetDeck</h1>
        <p className="muted">IoT 기기 관제와 서명 기반 원격 업데이트</p>
        <label>아이디<input value={user} onChange={(e) => setUser(e.target.value)} /></label>
        <label>비밀번호<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {err && <div className="err">{err}</div>}
        <button className="primary">로그인</button>
        <p className="muted small">데모 계정: admin · operator · viewer / 비밀번호 demo</p>
      </form>
    </div>
  );
}
