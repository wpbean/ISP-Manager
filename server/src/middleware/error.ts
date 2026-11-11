import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z, ZodError } from 'zod';
import { HttpError } from '../lib/http';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.path}`, code: 'NOT_FOUND' } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { message: err.message, code: err.code, details: err.details } });
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({
      error: {
        message: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: z.flattenError(err).fieldErrors,
      },
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      return res.status(409).json({
        error: { message: `A record with this ${target} already exists`, code: 'DUPLICATE', details: { fields: err.meta?.target } },
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { message: 'Record not found', code: 'NOT_FOUND' } });
    }
  }
  console.error(err);
  res.status(500).json({ error: { message: 'Internal server error', code: 'INTERNAL' } });
}
