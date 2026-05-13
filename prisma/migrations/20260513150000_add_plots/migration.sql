-- CreateTable: per-project stage plots. Stores a label + URL pointing
-- at an externally-hosted PDF (typically Google Drive). Cascades on
-- project delete so orphaned plots can't pile up.
CREATE TABLE "Plot" (
    "id"        SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "label"     TEXT NOT NULL,
    "url"       TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Plot_projectId_idx" ON "Plot"("projectId");

-- AddForeignKey
ALTER TABLE "Plot"
  ADD CONSTRAINT "Plot_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
