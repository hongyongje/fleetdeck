// Signs a firmware package and (optionally) uploads it.
// node tools/sign.ts <file> <version> [--notes "..."] [--upload http://localhost:8787 --user admin --password demo]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signPackage } from '../server/src/signing.ts';

const [file, version] = process.argv.slice(2);
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
if (!file || !version) { console.error('사용법: node tools/sign.ts <file> <version> [--notes ...] [--upload URL]'); process.exit(1); }

const keyPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'keys', 'release.key.pem');
const content = readFileSync(file);
const { sha256, signature } = signPackage(readFileSync(keyPath, 'utf8'), version, content);
const bundle = { version, notes: arg('--notes') ?? '', contentBase64: content.toString('base64'), signature };
writeFileSync(`${file}.signed.json`, JSON.stringify(bundle));
console.log(`서명 완료 ${version} sha256=${sha256.slice(0, 16)}… -> ${file}.signed.json`);

const url = arg('--upload');
if (url) {
  const login = await fetch(`${url}/api/auth/login`, { method: 'POST', body: JSON.stringify({ user: arg('--user') ?? 'admin', password: arg('--password') ?? 'demo' }) }).then((r) => r.json());
  const r = await fetch(`${url}/api/packages`, { method: 'POST', headers: { authorization: `Bearer ${login.token}` }, body: JSON.stringify(bundle) });
  console.log('업로드:', r.status, await r.text());
}
