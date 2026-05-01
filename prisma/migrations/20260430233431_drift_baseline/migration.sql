-- AlterTable
ALTER TABLE "public"."Equipment" DROP COLUMN "bpNumber",
DROP COLUMN "frequency",
DROP COLUMN "source",
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "name" TEXT NOT NULL,
ALTER COLUMN "deployStatus" SET DEFAULT 'na';

-- AlterTable
ALTER TABLE "public"."PickListItem" ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "public"."Project" ADD COLUMN     "pin" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_pin_key" ON "public"."Project"("pin" ASC);
