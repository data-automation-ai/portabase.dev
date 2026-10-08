import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const site = '794217cc-42ab-4a9f-81da-06a661403573';
const config = JSON.parse(await readFile(join(process.env.APPDATA, 'netlify/Config/config.json'), 'utf8'));
const token = config.users?.[config.userId]?.auth?.token;
if (!token) throw new Error('Active Netlify CLI authentication unavailable');
const out = '.netlify/homepage-release';
await mkdir(out, { recursive: true });
for (const [name, path] of [
  ['files', `/sites/${site}/files`],
  ['functions', `/sites/${site}/functions`],
  ['deploy-functions', '/deploys/6ab288426450b9689079fdab/functions'],
]) {
  const response = await fetch(`https://api.netlify.com/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) { console.log(name, response.status); continue; }
  const data = await response.json();
  const rows = Array.isArray(data) ? data : data.functions || data.data || [];
  console.log(JSON.stringify({ name, count: rows.length, keys: Object.keys(data).slice(0, 12), rowKeys: Object.keys(rows[0] || {}), sample: rows.slice(0, 2).map(r => ({ id: r.id, name: r.name, path: r.path, sha: r.sha, runtime: r.runtime })) }));
  // File and function manifests only; provider responses may contain signed URLs.
  const safe = rows.map(r => ({ id: r.id, name: r.name || r.n, path: r.path, sha: r.sha || r.id, runtime: r.runtime || r.r, size: r.size, schedule: r.schedule, displayName: r.dn, generator: r.g }));
  if (name.includes('functions')) console.log(JSON.stringify(safe.slice(0, 2)));
  await writeFile(`${out}/${name}.json`, JSON.stringify(safe, null, 2));
}
const files = JSON.parse(await readFile(`${out}/files.json`, 'utf8'));
for (const path of ['/index.html', '/netlify.toml']) {
  const response = await fetch(`https://6ab288426450b9689079fdab--portabase-dev.netlify.app${path}`);
  if (!response.ok) throw new Error(`Baseline download ${path}: HTTP ${response.status}`);
  const content = Buffer.from(await response.arrayBuffer());
  const sha = createHash('sha1').update(content).digest('hex');
  if (sha !== files.find(row => row.path === path)?.sha) throw new Error(`Baseline hash mismatch: ${path}`);
  await writeFile(`${out}/baseline-${path.slice(1)}`, content);
  console.log(JSON.stringify({ baseline: path, verified: true }));
}
