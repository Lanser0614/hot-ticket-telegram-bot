import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (extname(entry.name) === '.ts') files.push(path);
  }
  return files;
}

describe('VDS production build contract', () => {
  it('не содержит Telegram Serverless imports', () => {
    for (const file of sourceFiles('src')) {
      expect(readFileSync(file, 'utf8'), file)
        .not.toMatch(/from ['"]sdk(?:\/[^'"]*)?['"]/u);
    }
  });

  it('содержит только VDS scripts и dependencies', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Readonly<Record<string, string>>;
      dependencies?: Readonly<Record<string, string>>;
      devDependencies?: Readonly<Record<string, string>>;
    };
    expect(packageJson.scripts).toMatchObject({
      build: 'tsc -p tsconfig.build.json',
      start: 'node --env-file-if-exists=.env dist/entries/bot.js',
      sync: 'node --env-file-if-exists=.env dist/entries/sync.js'
    });
    expect(packageJson.scripts).not.toHaveProperty('cloud:login');
    expect(packageJson.dependencies).toHaveProperty('better-sqlite3');
    expect(packageJson.devDependencies).not.toHaveProperty('@tgcloud/cli');
  });
});
