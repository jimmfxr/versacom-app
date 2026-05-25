-- CreateTable
CREATE TABLE "Radio" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "department" TEXT,
    "position" TEXT,
    "barcode" TEXT,
    "checkedOut" BOOLEAN NOT NULL DEFAULT false,
    "checkedOutAt" TIMESTAMP(3),
    "assignedToProjectMemberId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Radio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Radio_projectId_idx" ON "Radio"("projectId");

-- CreateIndex
CREATE INDEX "Radio_assignedToProjectMemberId_idx" ON "Radio"("assignedToProjectMemberId");

-- CreateIndex
CREATE INDEX "Radio_projectId_name_idx" ON "Radio"("projectId", "name");

-- AddForeignKey
ALTER TABLE "Radio" ADD CONSTRAINT "Radio_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Radio" ADD CONSTRAINT "Radio_assignedToProjectMemberId_fkey" FOREIGN KEY ("assignedToProjectMemberId") REFERENCES "ProjectMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
