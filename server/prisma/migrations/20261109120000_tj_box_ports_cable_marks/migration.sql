-- TJ box: numbered outgoing cable ports (one cable in, N out).
ALTER TABLE "FiberNode" ADD COLUMN "cablePorts" INTEGER;

-- Cable sheath meter marks at each end of a link.
ALTER TABLE "FiberLink" ADD COLUMN "startMark" INTEGER,
ADD COLUMN "endMark" INTEGER;

-- Existing TJ box outputs had no port: number them 1..N in creation order.
UPDATE "FiberLink" l
SET "fromPort" = r.rn
FROM (
  SELECT fl."id", ROW_NUMBER() OVER (PARTITION BY fl."fromNodeId" ORDER BY fl."createdAt", fl."id") AS rn
  FROM "FiberLink" fl
  JOIN "FiberNode" n ON n."id" = fl."fromNodeId"
  WHERE n."type" = 'TJ_BOX' AND fl."fromPort" IS NULL
) r
WHERE l."id" = r."id";

-- Give every TJ box at least 4 ports (more if it already has more cables out).
UPDATE "FiberNode" n
SET "cablePorts" = GREATEST(4, COALESCE((SELECT MAX(fl."fromPort") FROM "FiberLink" fl WHERE fl."fromNodeId" = n."id"), 0))
WHERE n."type" = 'TJ_BOX';
