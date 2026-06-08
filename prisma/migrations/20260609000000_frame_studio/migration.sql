-- Frame Studio: Equipment.frameNodeId + FrameSlot table.
-- Companion to switch_studio (20260608000000) — same shape, different
-- domain. See prisma/schema.prisma for full field-level docs.

-- ============================================================
-- 1. Equipment.frameNodeId — Riedel node ID, only set when
--    category='frames'. Free-form string so any Riedel naming
--    convention works (numeric, hyphenated, etc.).
-- ============================================================
ALTER TABLE "Equipment" ADD COLUMN "frameNodeId" TEXT;

-- ============================================================
-- 2. FrameSlot — per-bay state per Riedel Artist frame. One row per
--    editable bay on the chassis. (equipmentId, bayKey) unique so a
--    frame's bay set is consistent. Cascade-delete with Equipment so
--    deleting a frame removes its bay config.
-- ============================================================
CREATE TABLE "FrameSlot" (
    "id"          SERIAL PRIMARY KEY,
    "equipmentId" INTEGER NOT NULL,
    "bayKey"      TEXT NOT NULL,
    "cardType"    TEXT NOT NULL DEFAULT 'unused',
    "notes"       TEXT,

    CONSTRAINT "FrameSlot_equipmentId_fkey"
        FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FrameSlot_equipmentId_bayKey_key"
    ON "FrameSlot" ("equipmentId", "bayKey");

CREATE INDEX "FrameSlot_equipmentId_idx"
    ON "FrameSlot" ("equipmentId");
