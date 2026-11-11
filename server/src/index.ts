import { createApp } from './app';
import { env } from './lib/env';
import { prisma } from './lib/prisma';

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`ISP Manager API listening on http://localhost:${env.port} (tz: ${env.timezone})`);
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
