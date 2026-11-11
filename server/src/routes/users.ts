import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { userCreateSchema, userUpdateSchema } from '@isp/shared';
import { prisma } from '../lib/prisma';
import { badRequest } from '../lib/http';
import { serializeUser } from '../lib/serialize';
import { requirePermission } from '../middleware/auth';

export const usersRouter = Router();
usersRouter.use(requirePermission('users:manage'));

usersRouter.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  res.json({ data: users.map(serializeUser) });
});

usersRouter.post('/', async (req, res) => {
  const { password, ...data } = userCreateSchema.parse(req.body);
  const user = await prisma.user.create({
    data: { ...data, phone: data.phone ?? null, passwordHash: await bcrypt.hash(password, 10) },
  });
  res.status(201).json({ data: serializeUser(user) });
});

usersRouter.patch('/:id', async (req, res) => {
  const { password, ...data } = userUpdateSchema.parse(req.body);
  const isSelf = String(req.params.id) === req.user!.id;
  if (isSelf && (data.isActive === false || (data.role && data.role !== 'ADMIN'))) {
    throw badRequest('You cannot deactivate or demote your own account');
  }
  const user = await prisma.user.update({
    where: { id: String(req.params.id) },
    data: { ...data, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
  });
  res.json({ data: serializeUser(user) });
});

usersRouter.delete('/:id', async (req, res) => {
  if (String(req.params.id) === req.user!.id) throw badRequest('You cannot delete your own account');
  await prisma.user.delete({ where: { id: String(req.params.id) } });
  res.status(204).end();
});
