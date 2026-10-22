// Creates the release signing key pair.
// keys/release.key.pem  -> keep offline on the release machine (git-ignored)
// keys/release.pub.pem  -> shipped to the server and every device
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeys } from '../server/src/signing.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'keys');
mkdirSync(dir, { recursive: true });
if (existsSync(join(dir, 'release.key.pem')) && !process.argv.includes('--force')) {
  console.log('이미 키가 있습니다. 새로 만들려면 --force');
  process.exit(0);
}
const { publicKey, privateKey } = generateKeys();
writeFileSync(join(dir, 'release.key.pem'), privateKey, { mode: 0o600 });
writeFileSync(join(dir, 'release.pub.pem'), publicKey);
console.log('keys/release.key.pem (개인키, 배포 PC 밖으로 내보내지 마십시오)\nkeys/release.pub.pem (공개키)');
