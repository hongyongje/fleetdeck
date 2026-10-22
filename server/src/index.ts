// Entry point: node server/src/index.ts
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.ts';
import { createApp } from './app.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pubPath = process.env.FD_PUBLIC_KEY ?? join(root, 'keys', 'release.pub.pem');
if (!existsSync(pubPath)) {
  console.error(`공개키가 없습니다: ${pubPath}\n먼저 "npm run keygen" 으로 서명 키를 만드십시오.`);
  process.exit(1);
}
const db = openDb(process.env.FD_DB ?? join(root, 'data', 'fleetdeck.db'));
const staticDir = join(root, 'web', 'dist');
const { server, sweep } = createApp({ db, publicKeyPem: readFileSync(pubPath, 'utf8'), staticDir: existsSync(staticDir) ? staticDir : undefined });
const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => console.log(`FleetDeck server on http://localhost:${port}`));
setInterval(sweep, 5_000).unref();
