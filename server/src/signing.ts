// Ed25519 signing for update packages.
// The private key lives only on the release machine (tools/sign.ts).
// The server and every device hold only the public key and refuse unsigned or tampered packages.
import { createHash, createPublicKey, createPrivateKey, sign, verify, generateKeyPairSync } from 'node:crypto';

export function sha256Hex(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** The signed message binds version and content hash so a signature cannot be replayed on another version. */
export function signedMessage(version: string, sha256: string): Buffer {
  return Buffer.from(`fleetdeck-package:v1:${version}:${sha256}`, 'utf8');
}

export function signPackage(privateKeyPem: string, version: string, content: Uint8Array): { sha256: string; signature: string } {
  const sha = sha256Hex(content);
  const sig = sign(null, signedMessage(version, sha), createPrivateKey(privateKeyPem));
  return { sha256: sha, signature: sig.toString('base64') };
}

export function verifyPackage(publicKeyPem: string, version: string, content: Uint8Array, signatureB64: string): boolean {
  try {
    const sha = sha256Hex(content);
    return verify(null, signedMessage(version, sha), createPublicKey(publicKeyPem), Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

export function generateKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}
