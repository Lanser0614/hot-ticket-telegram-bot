import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import { build } from 'esbuild';

import { isAllowedRuntimeImport, validateDeployPath } from './build-policy.js';

const projectRoot = resolve(import.meta.dirname, '..');
const outputRoot = resolve(projectRoot, 'telegram-dist');
const managedPaths = [
  resolve(outputRoot, 'schema.js'),
  resolve(outputRoot, 'handlers'),
  resolve(outputRoot, 'lib')
];

for (const managedPath of managedPaths) {
  await rm(managedPath, { force: true, recursive: true });
}

await mkdir(outputRoot, { recursive: true });

const result = await build({
  absWorkingDir: projectRoot,
  bundle: true,
  entryPoints: {
    schema: 'schema.ts',
    'handlers/message': 'src/handlers/message.ts',
    'handlers/callback_query': 'src/handlers/callback_query.ts',
    'lib/sync-hot-tickets': 'src/entries/sync-hot-tickets.ts'
  },
  external: ['sdk', 'sdk/*', 'schema'],
  format: 'esm',
  logLevel: 'silent',
  metafile: true,
  outdir: outputRoot,
  platform: 'neutral',
  sourcemap: false,
  target: 'es2022'
});

for (const [outputPath, metadata] of Object.entries(result.metafile.outputs)) {
  const deployPath = relative(outputRoot, resolve(projectRoot, outputPath)).split(sep).join('/');

  if (!validateDeployPath(deployPath)) {
    throw new Error(`Недопустимый путь deploy-модуля: ${deployPath}`);
  }

  for (const imported of metadata.imports) {
    if (imported.external && !isAllowedRuntimeImport(imported.path)) {
      throw new Error(`Недопустимый runtime import: ${imported.path}`);
    }
  }
}

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function listFiles(directory) {
  /** @type {string[]} */
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.tgcloud') continue;

    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

for (const filePath of await listFiles(outputRoot)) {
  const deployPath = relative(outputRoot, filePath).split(sep).join('/');
  if (!validateDeployPath(deployPath)) {
    throw new Error(`Недопустимый файл в telegram-dist: ${deployPath}`);
  }

  const source = await readFile(filePath, 'utf8');
  const importMatches = source.matchAll(/\bfrom\s+["']([^"']+)["']/g);
  for (const match of importMatches) {
    const importedPath = match[1];
    if (importedPath !== undefined && !isAllowedRuntimeImport(importedPath)) {
      throw new Error(`Недопустимый import в ${deployPath}: ${importedPath}`);
    }
  }
}

console.info(`Telegram build готов: ${relative(projectRoot, outputRoot)}`);
