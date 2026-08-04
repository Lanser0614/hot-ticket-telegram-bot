import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const deployDirectory = resolve(projectRoot, 'telegram-dist');
const executable = resolve(projectRoot, 'node_modules/.bin/tgcloud');
const argumentsList = process.argv.slice(2);

await mkdir(deployDirectory, { recursive: true });

const child = spawn(executable, argumentsList, {
  cwd: deployDirectory,
  env: process.env,
  stdio: 'inherit'
});

child.on('error', (error) => {
  console.error(`Не удалось запустить tgcloud: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal !== null) {
    console.error(`tgcloud завершён сигналом ${signal}`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
