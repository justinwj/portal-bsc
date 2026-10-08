import { ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export function createCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

export function attachCsrfToken(req: Request & { session?: any; csrfToken?: () => string }, _res: Response, next: NextFunction) {
  if (!req.session) {
    return next();
  }

  req.session.csrfToken ??= createCsrfToken();
  req.csrfToken = () => req.session.csrfToken;
  return next();
}

export function csrfMiddleware(req: Request & { session?: any }, _res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  if (!req.session) {
    return next(new ForbiddenException('Session required for CSRF validation'));
  }

  const expected = req.session.csrfToken;
  const headers = req.headers ?? {};
  const actual = typeof req.body?._csrf === 'string'
    ? req.body._csrf
    : typeof headers['x-csrf-token'] === 'string'
      ? headers['x-csrf-token']
      : '';

  if (!expected || actual !== expected) {
    return next(new ForbiddenException('Invalid or missing CSRF token'));
  }

  return next();
}
