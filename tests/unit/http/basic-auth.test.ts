import { describe, expect, it } from 'vitest';

import { verifyBasicAuth } from '../../../src/infrastructure/http/basic-auth.js';

function header(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

describe('verifyBasicAuth', () => {
  it('принимает верные логин и пароль', () => {
    expect(verifyBasicAuth(header('admin', 's3cret'), 'admin', 's3cret')).toBe(true);
  });

  it('пропускает пароль с двоеточием', () => {
    expect(verifyBasicAuth(header('admin', 'a:b:c'), 'admin', 'a:b:c')).toBe(true);
  });

  it('отклоняет неверный пароль и логин', () => {
    expect(verifyBasicAuth(header('admin', 'wrong'), 'admin', 's3cret')).toBe(false);
    expect(verifyBasicAuth(header('root', 's3cret'), 'admin', 's3cret')).toBe(false);
  });

  it('отклоняет отсутствующий или чужой заголовок', () => {
    expect(verifyBasicAuth(undefined, 'admin', 's3cret')).toBe(false);
    expect(verifyBasicAuth('Bearer token', 'admin', 's3cret')).toBe(false);
    expect(verifyBasicAuth('Basic не-base64!', 'admin', 's3cret')).toBe(false);
  });
});
