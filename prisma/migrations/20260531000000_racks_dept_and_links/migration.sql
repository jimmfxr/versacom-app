-- Rack designer — Phase 1 schema changes.
--
-- 1. Scope every RackTemplate to a department ('comms' | 'radios')
--    so the Comms tab and the Radios tab don't see each other's
--    racks. Existing rows default to 'comms' since the only racks
--    on the system today are Comms-side.
-- 2. Optional Equipment link on every RackSlot so a slot can reflect
--    the real deploy status / IP / asset of a tagged piece of gear.
-- 3. RackLooseItem table — small devices tagged to a rack that don't
--    occupy an RU (Antaira / Intellanet / TP Link / Netgate /
--    Bolero Antenna Master). Optional Equipment link, same idea.
-- 4. RackDevice table — user-authored custom devices added via
--    "+ Custom device" in the library. Project-scoped or global.
-- 5. Cascade delete on RackSlot.rackTemplateId so dropping a rack
--    cleans up its slots automatically.

-- 1. Department field
ALTER TABLE "RackTemplate"
  ADD COLUMN "dept" TEXT NOT NULL DEFAULT 'comms';

-- 1b. Physical location at the show — FOH / MON / STAGE / "Studio A".
ALTER TABLE "RackTemplate"
  ADD COLUMN "location" TEXT;

-- 2. Optional equipment link on slots
ALTER TABLE "RackSlot"
  ADD COLUMN "equipmentId" INTEGER;

ALTER TABLE "RackSlot"
  ADD CONSTRAINT "RackSlot_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "RackSlot_equipmentId_idx" ON "RackSlot"("equipmentId");

-- Drop the old slot→template FK if present and re-add with cascade.
-- (Prisma generated a non-cascading FK originally; we want cascade
-- so deleting a rack template cleans up its slots.)
ALTER TABLE "RackSlot"
  DROP CONSTRAINT IF EXISTS "RackSlot_rackTemplateId_fkey";
ALTER TABLE "RackSlot"
  ADD CONSTRAINT "RackSlot_rackTemplateId_fkey"
  FOREIGN KEY ("rackTemplateId") REFERENCES "RackTemplate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Loose-gear table
CREATE TABLE "RackLooseItem" (
  "id" SERIAL PRIMARY KEY,
  "rackTemplateId" INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "label" TEXT,
  "equipmentId" INTEGER,
  CONSTRAINT "RackLooseItem_rackTemplateId_fkey"
    FOREIGN KEY ("rackTemplateId") REFERENCES "RackTemplate"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RackLooseItem_equipmentId_fkey"
    FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "RackLooseItem_rackTemplateId_idx" ON "RackLooseItem"("rackTemplateId");
CREATE INDEX "RackLooseItem_equipmentId_idx" ON "RackLooseItem"("equipmentId");

-- 4. Custom device library
CREATE TABLE "RackDevice" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "ruSize" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "projectId" INTEGER,
  "dept" TEXT NOT NULL DEFAULT 'comms',
  CONSTRAINT "RackDevice_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RackDevice_projectId_idx" ON "RackDevice"("projectId");
CREATE INDEX "RackDevice_dept_idx" ON "RackDevice"("dept");
