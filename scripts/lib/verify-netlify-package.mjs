import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, toNamespacedPath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

// Import the actual archived workload while rejecting accidental resolution from
// the operator's surrounding node_modules. AWS SDK imports are supplied by Lambda.
export async function verifyNativePackage(bundle, directory) {
  if (bundle.runtimeAPIVersion !== 2) return;
  const destination = resolve(directory, bundle.name);
  const entries = JSON.parse(execFileSync('python', ['-c', 'import sys,zipfile,json; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', bundle.path], { encoding: 'utf8' }));
  for (const entry of entries) {
    const workload = entry === bundle.name + '.mjs' ||
      /\/source-[a-f0-9]{40}\//.test(entry) && entry.endsWith('/netlify/functions/' + bundle.name + '.mjs');
    if (entry.split('/').includes('..') || entry.startsWith('/') ||
        /(?:^|\/)(?:\.env(?:\.|$)|AGENTS\.mdx$|operator-config\.mjs$|release\.json$)/i.test(entry) ||
        !(entry.startsWith('node_modules/') || entry.startsWith('___netlify-') || workload)) {
      throw Error('unreviewed_function_archive_path:' + entry);
    }
  }
  await mkdir(destination, { recursive: true });
  execFileSync('python', ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', bundle.path, toNamespacedPath(destination)]);
  const bootstrap = await readFile(join(destination, '___netlify-entry-point.mjs'), 'utf8');
  const entry = bootstrap.match(/getLambdaHandler\(['"]([^'"]+)['"]\)/)?.[1];
  if (!entry) throw Error('native_workload_entry_missing');
  const root = pathToFileURL(destination + '/').href;
  const target = new URL(entry, root).href;
  const script = `
    import { registerHooks } from 'node:module';
    const root = ${JSON.stringify(root)};
    registerHooks({resolve(specifier, context, next) {
      const result = next(specifier, context);
      if (context.parentURL?.startsWith(root) && result.url.startsWith('file:') && !result.url.startsWith(root)
          && !specifier.startsWith('@aws-sdk/') && specifier !== 'aws-sdk') {
        throw Error('dependency_outside_function_package:' + specifier);
      }
      return result;
    }});
    const workload = await import(${JSON.stringify(target)});
    if (typeof workload.default !== 'function') throw Error('native_handler_missing');
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: destination,
    env: { ...process.env, NODE_PATH: '' },
    stdio: 'pipe',
  });
}
