import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const privateDirectory = resolve('private');
const publicPath = resolve('utility', 'portabase-license-public.pem');
const privatePath = resolve(privateDirectory, 'portabase-license-private.pem');
await mkdir(privateDirectory, { recursive: true });
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
await writeFile(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
await writeFile(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
console.log(`Created public verifier: ${publicPath}`);
console.log(`Created ignored private signer: ${privatePath}`);
console.log('Move the private signer into AWS Secrets Manager before issuing production licenses.');
