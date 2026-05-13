-- AlterTable: add mult-specific columns on Equipment
ALTER TABLE "Equipment"
  ADD COLUMN "trunkEquipmentId" INTEGER,
  ADD COLUMN "strandCount" INTEGER;

-- AddForeignKey: trunk end of a mult points at another Equipment row
ALTER TABLE "Equipment"
  ADD CONSTRAINT "Equipment_trunkEquipmentId_fkey"
  FOREIGN KEY ("trunkEquipmentId") REFERENCES "Equipment"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- CreateTable: MultStrand — one row per strand/pair on a mult.
CREATE TABLE "MultStrand" (
    "id" SERIAL NOT NULL,
    "multEquipmentId" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "channelName" TEXT NOT NULL DEFAULT '',
    "attachedEquipmentId" INTEGER,

    CONSTRAINT "MultStrand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MultStrand_multEquipmentId_index_key"
  ON "MultStrand"("multEquipmentId", "index");

-- CreateIndex
CREATE INDEX "MultStrand_attachedEquipmentId_idx"
  ON "MultStrand"("attachedEquipmentId");

-- AddForeignKey: cascade delete strands when the mult equipment row is deleted
ALTER TABLE "MultStrand"
  ADD CONSTRAINT "MultStrand_multEquipmentId_fkey"
  FOREIGN KEY ("multEquipmentId") REFERENCES "Equipment"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- AddForeignKey: nullify strand attachment when the attached equipment is deleted
ALTER TABLE "MultStrand"
  ADD CONSTRAINT "MultStrand_attachedEquipmentId_fkey"
  FOREIGN KEY ("attachedEquipmentId") REFERENCES "Equipment"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
