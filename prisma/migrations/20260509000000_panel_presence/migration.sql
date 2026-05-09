-- PanelPresence: soft "who's looking at this panel" tracker.
-- One row per (user, equipment). Heartbeat refreshes `lastSeen`.
-- Read queries filter on lastSeen within the last ~30s.

CREATE TABLE "PanelPresence" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "equipmentId" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'viewing',
  "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "PanelPresence_userId_equipmentId_key"
  ON "PanelPresence"("userId", "equipmentId");

CREATE INDEX "PanelPresence_equipmentId_lastSeen_idx"
  ON "PanelPresence"("equipmentId", "lastSeen");

ALTER TABLE "PanelPresence"
  ADD CONSTRAINT "PanelPresence_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PanelPresence"
  ADD CONSTRAINT "PanelPresence_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
