import { Router } from 'express';
import {
  DEFAULT_BOX_PORTS,
  fiberAssignSchema,
  fiberInsertBoxSchema,
  markLength,
  fiberLinkCreateSchema,
  fiberLinkUpdateSchema,
  fiberNodeCreateSchema,
  fiberNodeUpdateSchema,
  fiberPositionsSchema,
} from '@isp/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/http';
import { requirePermission } from '../middleware/auth';
import {
  assertBox,
  assertCoreFits,
  assertPortsFit,
  cableSiblings,
  insertBoxIntoCable,
  assertUniqueName,
  loadNetwork,
  portCount,
  resyncCustomers,
  serializeLink,
  serializeNode,
  sharedChanges,
  sharedOf,
  syncCable,
  validateAssignment,
  validateNewLink,
} from '../services/network';

/** Fiber network builder: OLTs, TJ boxes, splitters, cable links and customer patching. */
export const networkRouter = Router();
const manage = requirePermission('network:manage');

const jsonPath = (p: [number, number][] | null | undefined) =>
  p === undefined ? undefined : p === null || p.length === 0 ? Prisma.DbNull : p;

networkRouter.get('/', requirePermission('network:read'), async (_req, res) => {
  res.json({ data: await loadNetwork() });
});

// ---- Nodes ------------------------------------------------------------------
networkRouter.post('/nodes', manage, async (req, res) => {
  const data = fiberNodeCreateSchema.parse(req.body);
  await assertUniqueName(data.type, data.name);
  if (data.type === 'SPLITTER') await assertBox(data.boxId);
  const node = await prisma.fiberNode.create({
    data: {
      ...data,
      boxId: data.type === 'SPLITTER' ? (data.boxId ?? null) : null,
      // Splitters have no GPS of their own — they are located by their TJ box.
      ...(data.type === 'SPLITTER' ? { latitude: null, longitude: null } : {}),
      ponPorts: data.type === 'OLT' ? (data.ponPorts ?? 8) : null,
      ponPrefix: data.type === 'OLT' ? (data.ponPrefix ?? '0/1/') : null,
      cablePorts: data.type === 'TJ_BOX' ? (data.cablePorts ?? DEFAULT_BOX_PORTS) : null,
      splitterRatio: data.type === 'SPLITTER' ? (data.splitterRatio ?? '1:8') : null,
    },
  });
  res.status(201).json({ data: serializeNode(node) });
});

networkRouter.patch('/nodes/:id', manage, async (req, res) => {
  const id = String(req.params.id);
  const data = fiberNodeUpdateSchema.parse(req.body);
  const node = await prisma.fiberNode.findUnique({ where: { id } });
  if (!node) throw notFound('Node');
  if (data.name && data.name !== node.name) await assertUniqueName(node.type, data.name, id);
  if (data.boxId !== undefined) {
    if (node.type !== 'SPLITTER' && data.boxId) throw badRequest('Only splitters can be placed in a TJ box');
    await assertBox(data.boxId);
  }
  const next = { ...node, ...data };
  if (data.cablePorts !== undefined) {
    if (node.type !== 'TJ_BOX') delete data.cablePorts; // only TJ boxes have cable ports
    else data.cablePorts ??= DEFAULT_BOX_PORTS;
  }
  if (data.ponPorts !== undefined || data.splitterRatio !== undefined || data.cablePorts !== undefined) await assertPortsFit(id, portCount(next));
  const updated = await prisma.fiberNode.update({
    where: { id },
    data: node.type === 'SPLITTER' ? { ...data, latitude: null, longitude: null } : data,
  });
  await resyncCustomers();
  res.json({ data: serializeNode(updated) });
});

networkRouter.patch('/positions', manage, async (req, res) => {
  const { positions } = fiberPositionsSchema.parse(req.body);
  await prisma.$transaction(
    positions.map((p) => prisma.fiberNode.updateMany({ where: { id: p.id }, data: { posX: p.x, posY: p.y } })),
  );
  res.status(204).end();
});

networkRouter.delete('/nodes/:id', manage, async (req, res) => {
  // Cables cascade; patched customers and splitters inside a box are detached (SET NULL).
  await prisma.fiberNode.delete({ where: { id: String(req.params.id) } });
  await resyncCustomers();
  res.status(204).end();
});

// ---- Links (cable cores) ----------------------------------------------------
networkRouter.post('/links', manage, async (req, res) => {
  const data = fiberLinkCreateSchema.parse(req.body);
  const { fromPort, toPort } = await validateNewLink(data);
  const cableCode = data.cableCode?.trim() || null;
  // Another core of an existing cable: inherit its shared fields unless given, and keep the cable in sync.
  const siblings = await cableSiblings({ ...data, cableCode });
  const base = siblings[0] ? sharedOf(siblings[0]) : {};
  const coreCount = data.coreCount ?? base.coreCount ?? null;
  assertCoreFits(siblings, data.coreNumber, coreCount, cableCode);
  const startMark = data.startMark ?? base.startMark ?? null;
  const endMark = data.endMark ?? base.endMark ?? null;
  const length = data.length ?? base.length ?? markLength(startMark, endMark);
  const path = data.path?.length ? data.path : ((base.path as [number, number][] | null | undefined) ?? null);
  const link = await prisma.fiberLink.create({
    data: { ...data, cableCode, fromPort, toPort, coreCount, startMark, endMark, length, path: jsonPath(path) },
  });
  if (siblings[0]) await syncCable(link, link.id, sharedChanges(sharedOf(siblings[0]), sharedOf(link)));
  await resyncCustomers();
  res.status(201).json({ data: serializeLink(link) });
});

networkRouter.patch('/links/:id', manage, async (req, res) => {
  const id = String(req.params.id);
  const data = fiberLinkUpdateSchema.parse(req.body);
  const cur = await prisma.fiberLink.findUnique({ where: { id } });
  if (!cur) throw notFound('Cable');
  if (data.cableCode !== undefined) data.cableCode = data.cableCode?.trim() || null;
  const cableCode = data.cableCode !== undefined ? data.cableCode : cur.cableCode;
  const siblings = await cableSiblings({ ...cur, cableCode }, id);
  const movedCable = (cableCode ?? '') !== (cur.cableCode?.trim() ?? '');

  // No length given but both meter marks known → length is the distance between the marks.
  const start = data.startMark !== undefined ? data.startMark : cur.startMark;
  const end = data.endMark !== undefined ? data.endMark : cur.endMark;
  const length = data.length === undefined ? undefined : (data.length ?? markLength(start, end));
  const next = { ...data, ...(length !== undefined ? { length } : {}) };
  const changed = sharedChanges(sharedOf(cur), next);
  // Moving this core onto another existing cable: adopt that cable's shared fields (unless edited now).
  const adopt = movedCable && siblings[0] ? { ...sharedOf(siblings[0]), ...changed } : {};
  const coreCount = changed.coreCount !== undefined ? changed.coreCount : (adopt.coreCount ?? cur.coreCount);
  const coreNumber = data.coreNumber !== undefined ? data.coreNumber : cur.coreNumber;
  assertCoreFits(siblings, coreNumber, coreCount, cableCode);

  const { path: adoptPath, ...adoptRest } = adopt;
  const link = await prisma.fiberLink.update({
    where: { id },
    data: {
      ...next,
      ...adoptRest,
      path: adoptPath !== undefined && data.path === undefined ? jsonPath(adoptPath as [number, number][] | null) : jsonPath(data.path),
    },
  });
  await syncCable(link, id, changed);
  res.json({ data: serializeLink(link) });
});

/** Cut the cable and splice a TJ box (existing or new) into it. */
networkRouter.post('/links/:id/insert-box', manage, async (req, res) => {
  const data = fiberInsertBoxSchema.parse(req.body);
  res.status(201).json({ data: await insertBoxIntoCable(String(req.params.id), data) });
});

networkRouter.delete('/links/:id', manage, async (req, res) => {
  await prisma.fiberLink.delete({ where: { id: String(req.params.id) } });
  res.status(204).end();
});

// ---- Customer ↔ splitter port ------------------------------------------------
networkRouter.post('/assignments', manage, async (req, res) => {
  const { customerId, nodeId, port } = fiberAssignSchema.parse(req.body);
  await validateAssignment(customerId, nodeId, port);
  await prisma.customer.update({ where: { id: customerId }, data: { fiberNodeId: nodeId, splitterPort: port } });
  await resyncCustomers();
  res.status(204).end();
});

networkRouter.delete('/assignments/:customerId', manage, async (req, res) => {
  await prisma.customer.update({ where: { id: String(req.params.customerId) }, data: { fiberNodeId: null } });
  res.status(204).end();
});
