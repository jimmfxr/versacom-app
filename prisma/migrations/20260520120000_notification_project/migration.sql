-- AlterTable: project scope on each notification. Nullable so future
-- global-scope notifications stay supported.
ALTER TABLE "Notification"
  ADD COLUMN "projectId" INTEGER;

-- CreateIndex
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");

-- AddForeignKey: cascade so deleting a project sweeps its notifications.
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
