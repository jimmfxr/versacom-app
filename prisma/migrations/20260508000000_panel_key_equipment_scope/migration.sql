-- Migrate PanelKey + ChangeRequest from member-scoped to equipment-scoped.
--
-- Before: PanelKey.@@unique([projectMemberId, keyIndex, page, expansion])
-- After:  PanelKey.@@unique([equipmentId, keyIndex, page, expansion])
--
-- A member with multiple panel-category devices used to share PanelKey rows
-- across all their devices. We now clone existing rows so each device has
-- its own copy of the current key state. ChangeRequest gets equipmentId
-- denormalized so the admin review surface can group by device.

-- 1) Add nullable columns first so we can backfill before making them
--    required. IF NOT EXISTS makes the migration safe to re-run after a
--    partial-failure recovery (Postgres doesn't roll back DDL across the
--    whole script — only inside an explicit transaction block).
ALTER TABLE "PanelKey" ADD COLUMN IF NOT EXISTS "equipmentId" INTEGER;
ALTER TABLE "ChangeRequest" ADD COLUMN IF NOT EXISTS "equipmentId" INTEGER;

-- 2a) Every member's existing PanelKey rows belong to ONE canonical
--     device — the lowest-id panel-category equipment assigned to them.
--     Set those rows to that equipmentId.
WITH canonical AS (
  SELECT
    pm.id AS member_id,
    (
      SELECT e.id FROM "Equipment" e
      WHERE e."assignedToId" = pm.id
        AND e.category IN ('panels', 'hardwire_bp', 'wireless_bp')
      ORDER BY e.id ASC
      LIMIT 1
    ) AS equipment_id
  FROM "ProjectMember" pm
)
UPDATE "PanelKey" pk
SET "equipmentId" = c.equipment_id
FROM canonical c
WHERE pk."projectMemberId" = c.member_id
  AND c.equipment_id IS NOT NULL;

-- 2b) Drop PanelKey rows whose member has no panel-category equipment at
--     all — they're orphans. Cascade through their dependent rows first.
DELETE FROM "ChangeRequestItem" WHERE "panelKeyId" IN (
  SELECT id FROM "PanelKey" WHERE "equipmentId" IS NULL
);
DELETE FROM "KeyDraft" WHERE "panelKeyId" IN (
  SELECT id FROM "PanelKey" WHERE "equipmentId" IS NULL
);
DELETE FROM "PanelKey" WHERE "equipmentId" IS NULL;

-- 3) Drop the old member-scoped unique INDEX before cloning. The clones
--    below intentionally insert rows that share (memberId, slot) with an
--    existing row but differ on equipmentId, so the old unique must be
--    gone first. (Prisma created this as a unique index, not a constraint,
--    so we drop the index by name.)
DROP INDEX IF EXISTS "PanelKey_projectMemberId_keyIndex_page_expansion_key";

-- 4) For each member with MORE THAN ONE panel-category device, clone the
--    canonical device's PanelKey rows for every other device. Each clone
--    gets the same key state as the canonical device at migration time —
--    subsequent edits diverge per-device.
INSERT INTO "PanelKey" (
  "projectMemberId", "equipmentId", "keyIndex", "page", "expansion",
  "pickListItemId", "triggerMode", "talkMode"
)
SELECT
  pk."projectMemberId",
  e.id AS equipment_id,
  pk."keyIndex",
  pk."page",
  pk."expansion",
  pk."pickListItemId",
  pk."triggerMode",
  pk."talkMode"
FROM "PanelKey" pk
JOIN "Equipment" e
  ON e."assignedToId" = pk."projectMemberId"
 AND e.category IN ('panels', 'hardwire_bp', 'wireless_bp')
 AND e.id <> pk."equipmentId";

-- 5) Backfill ChangeRequest.equipmentId from the first item's panelKey.
--    By the time this runs, every PanelKey has an equipmentId set.
UPDATE "ChangeRequest" cr
SET "equipmentId" = (
  SELECT pk."equipmentId"
  FROM "ChangeRequestItem" cri
  JOIN "PanelKey" pk ON pk.id = cri."panelKeyId"
  WHERE cri."changeRequestId" = cr.id
  ORDER BY cri.id ASC
  LIMIT 1
);

-- 5b) Drop ChangeRequests with no items (and therefore no derivable
--     equipment). These are vestigial drafts from before this migration.
DELETE FROM "ChangeRequest" WHERE "equipmentId" IS NULL;

-- 6) Make the columns required.
ALTER TABLE "PanelKey" ALTER COLUMN "equipmentId" SET NOT NULL;
ALTER TABLE "ChangeRequest" ALTER COLUMN "equipmentId" SET NOT NULL;

-- 7) Add the new equipment-scoped unique index on PanelKey (matches the
--    Prisma-generated naming for @@unique constraints).
CREATE UNIQUE INDEX "PanelKey_equipmentId_keyIndex_page_expansion_key"
  ON "PanelKey"("equipmentId", "keyIndex", "page", "expansion");

-- 8) Index for member-scoped queries (sibling lookups, member dashboards).
CREATE INDEX "PanelKey_projectMemberId_idx" ON "PanelKey"("projectMemberId");

-- 9) Index for ChangeRequest equipment lookups.
CREATE INDEX "ChangeRequest_equipmentId_idx" ON "ChangeRequest"("equipmentId");

-- 10) Foreign keys for the new columns.
ALTER TABLE "PanelKey"
  ADD CONSTRAINT "PanelKey_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ChangeRequest"
  ADD CONSTRAINT "ChangeRequest_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
