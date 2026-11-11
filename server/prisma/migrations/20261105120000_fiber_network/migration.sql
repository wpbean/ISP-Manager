-- CreateEnum
CREATE TYPE "FiberNodeType" AS ENUM ('OLT', 'TJ_BOX', 'SPLITTER');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "fiberNodeId" TEXT;

-- CreateTable
CREATE TABLE "FiberNode" (
    "id" TEXT NOT NULL,
    "type" "FiberNodeType" NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "address" TEXT,
    "ipAddress" TEXT,
    "model" TEXT,
    "ponPorts" INTEGER,
    "ponPrefix" TEXT,
    "splitterRatio" TEXT,
    "boxId" TEXT,
    "notes" TEXT,
    "posX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "posY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiberNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiberLink" (
    "id" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "fromPort" INTEGER,
    "toNodeId" TEXT NOT NULL,
    "cableCode" TEXT,
    "coreCount" INTEGER,
    "tubeColor" TEXT,
    "coreNumber" INTEGER,
    "coreColor" TEXT,
    "length" INTEGER,
    "path" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiberLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiberNode_type_name_key" ON "FiberNode"("type", "name");

-- CreateIndex
CREATE INDEX "FiberLink_toNodeId_idx" ON "FiberLink"("toNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "FiberLink_fromNodeId_fromPort_key" ON "FiberLink"("fromNodeId", "fromPort");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_fiberNodeId_splitterPort_key" ON "Customer"("fiberNodeId", "splitterPort");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_fiberNodeId_fkey" FOREIGN KEY ("fiberNodeId") REFERENCES "FiberNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiberNode" ADD CONSTRAINT "FiberNode_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "FiberNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiberLink" ADD CONSTRAINT "FiberLink_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "FiberNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiberLink" ADD CONSTRAINT "FiberLink_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "FiberNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

