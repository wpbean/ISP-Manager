-- A core leaving a TJ box can be spliced to any incoming core (splice position), not only the
-- same-numbered one. Existing cores keep the old rule: Out N is joined to In N.
ALTER TABLE "FiberLink" ADD COLUMN "spliceIn" INTEGER;

UPDATE "FiberLink" l
SET "spliceIn" = l."fromPort"
FROM "FiberNode" n
WHERE n."id" = l."fromNodeId" AND n."type" = 'TJ_BOX' AND l."fromPort" IS NOT NULL;

CREATE UNIQUE INDEX "FiberLink_fromNodeId_spliceIn_key" ON "FiberLink"("fromNodeId", "spliceIn");
