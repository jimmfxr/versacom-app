-- AlterTable: physical length in feet (mults only — nullable on
-- everything else).
ALTER TABLE "Equipment"
  ADD COLUMN "lengthFeet" INTEGER;
