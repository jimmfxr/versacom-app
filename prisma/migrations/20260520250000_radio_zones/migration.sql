-- CreateTable
CREATE TABLE "Zone" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Zone_projectId_idx" ON "Zone"("projectId");

-- CreateTable
CREATE TABLE "ZoneChannel" (
    "id" SERIAL NOT NULL,
    "zoneId" INTEGER NOT NULL,
    "channelIndex" INTEGER NOT NULL,
    "name" TEXT,

    CONSTRAINT "ZoneChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZoneChannel_zoneId_channelIndex_key" ON "ZoneChannel"("zoneId", "channelIndex");

-- CreateIndex
CREATE INDEX "ZoneChannel_zoneId_idx" ON "ZoneChannel"("zoneId");

-- CreateTable
CREATE TABLE "RadioZone" (
    "radioId" INTEGER NOT NULL,
    "zoneId" INTEGER NOT NULL,

    CONSTRAINT "RadioZone_pkey" PRIMARY KEY ("radioId", "zoneId")
);

-- CreateIndex
CREATE INDEX "RadioZone_zoneId_idx" ON "RadioZone"("zoneId");

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneChannel" ADD CONSTRAINT "ZoneChannel_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadioZone" ADD CONSTRAINT "RadioZone_radioId_fkey" FOREIGN KEY ("radioId") REFERENCES "Radio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadioZone" ADD CONSTRAINT "RadioZone_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
