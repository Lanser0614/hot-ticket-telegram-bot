import { timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyBasicAuth(
  header: string | undefined,
  username: string,
  password: string
): boolean {
  if (header === undefined) return false;
  const match = /^Basic (.+)$/u.exec(header.trim());
  if (match === null || match[1] === undefined) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return false;
  }
  const separator = decoded.indexOf(':');
  if (separator === -1) return false;
  const providedUser = decoded.slice(0, separator);
  const providedPassword = decoded.slice(separator + 1);
  // Compare both fields unconditionally to keep timing independent of which failed.
  const userOk = safeEqual(providedUser, username);
  const passwordOk = safeEqual(providedPassword, password);
  return userOk && passwordOk;
}

export function basicAuth(username: string, password: string, realm = 'HotTicket Admin'): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (verifyBasicAuth(request.headers.authorization, username, password)) {
      next();
      return;
    }
    response.setHeader('WWW-Authenticate', `Basic realm="${realm}", charset="UTF-8"`);
    response.status(401).type('text/plain; charset=utf-8').send('Требуется авторизация');
  };
}
