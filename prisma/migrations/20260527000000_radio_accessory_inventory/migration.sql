-- Per-project total counts of radio accessories (fist mic, surveillance,
-- double muff, LWHS). Mirrors ProjectHeadsetInventory: the new Radios
-- bulk-add card flows accessory-type "brought" totals through this
-- table, independent from the per-Radio accessory boolean flags.
CREATE TABLE "ProjectAccessoryInventory" (
  "id" SERIAL PRIMARY KEY,
  "projectId" INTEGER NOT NULL,
  "accessoryType" TEXT NOT NULL,
  "brought" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectAccessoryInventory_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "ProjectAccessoryInventory_projectId_accessoryType_key"
  ON "ProjectAccessoryInventory"("projectId", "accessoryType");

CREATE INDEX "ProjectAccessoryInventory_projectId_idx"
  ON "ProjectAccessoryInventory"("projectId");
