-- TJ boxes take several cores (from one or more multi-core cables): each incoming core lands
-- on a splice position N and continues out on "Out N".
ALTER TABLE "FiberLink" ADD COLUMN "toPort" INTEGER;

-- Existing TJ boxes had a single input cable: put it on position 1.
UPDATE "FiberLink" l
SET "toPort" = 1
FROM "FiberNode" n
WHERE n."id" = l."toNodeId" AND n."type" = 'TJ_BOX';

CREATE UNIQUE INDEX "FiberLink_toNodeId_toPort_key" ON "FiberLink"("toNodeId", "toPort");
