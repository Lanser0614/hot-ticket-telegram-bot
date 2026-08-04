import { describe, expect, it } from 'vitest';

import { isAllowedRuntimeImport, validateDeployPath } from '../../scripts/build-policy.js';

describe('validateDeployPath', () => {
  it.each([
    'schema.js',
    'handlers/message.js',
    'handlers/callback_query.js',
    'lib/sync-hot-tickets.js'
  ])('принимает %s', (path) => {
    expect(validateDeployPath(path)).toBe(true);
  });

  it.each([
    'package.json',
    'handlers/nested/message.js',
    'lib/file.ts',
    'schema.ts'
  ])('отклоняет %s', (path) => {
    expect(validateDeployPath(path)).toBe(false);
  });
});

describe('isAllowedRuntimeImport', () => {
  it.each(['sdk', 'sdk/db', 'sdk/api', 'sdk/fetch', 'schema', 'lib/shared'])('принимает %s', (value) => {
    expect(isAllowedRuntimeImport(value)).toBe(true);
  });

  it.each(['node:crypto', 'lodash', './relative.js'])('отклоняет %s', (value) => {
    expect(isAllowedRuntimeImport(value)).toBe(false);
  });
});
