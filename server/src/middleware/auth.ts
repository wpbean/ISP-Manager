import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { can, type Permission, type Role } from '@isp/shared';
import { env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { forbidden, HttpError } from '../lib/http';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: { id: string; role: Role }): string {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

/** Requires `Authorization: Bearer <jwt>`. Works for both the web app and mobile clients. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Authentication required', 'UNAUTHENTICATED');

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
  } catch {
    throw new HttpError(401, 'Session expired, please log in again', 'INVALID_TOKEN');
  }

  // Re-read the user so deactivation / role changes take effect immediately.
  const user = await prisma.user.findUnique({
    where: { id: String(payload.sub) },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) throw new HttpError(401, 'Account is disabled', 'ACCOUNT_DISABLED');

  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  next();
}

export function requirePermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    // Passes if the user has ANY of the listed permissions.
    if (!perms.some((p) => can(req.user?.role, p))) throw forbidden();
    next();
  };
}
