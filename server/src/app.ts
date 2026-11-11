import express, { Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './lib/env';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { customersRouter } from './routes/customers';
import { paymentsRouter } from './routes/payments';
import { dashboardRouter } from './routes/dashboard';
import { networkRouter } from './routes/network';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      // Requests without an Origin (mobile apps, curl) are allowed; browsers must match the list.
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
      exposedHeaders: ['Content-Disposition'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  if (env.nodeEnv !== 'test') app.use(morgan('dev'));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  const v1 = Router();
  v1.use('/auth', authRouter);
  v1.use(authenticate); // everything below requires a valid token
  v1.use('/users', usersRouter);
  v1.use('/customers', customersRouter);
  v1.use('/payments', paymentsRouter);
  v1.use('/dashboard', dashboardRouter);
  v1.use('/network', networkRouter);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
