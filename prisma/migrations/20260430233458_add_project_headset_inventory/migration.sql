-- CreateTable
CREATE TABLE "ProjectHeadsetInventory" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "headsetType" TEXT NOT NULL,
    "brought" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectHeadsetInventory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectHeadsetInventory_projectId_idx" ON "ProjectHeadsetInventory"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectHeadsetInventory_projectId_headsetType_key" ON "ProjectHeadsetInventory"("projectId", "headsetType");

-- AddForeignKey
ALTER TABLE "ProjectHeadsetInventory" ADD CONSTRAINT "ProjectHeadsetInventory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
