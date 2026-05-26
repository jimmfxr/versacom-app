-- Replace the Radio.checkedOut boolean with a status string enum so
-- the operator can mark damaged / lost / N/A in addition to the
-- in/out cycle. All existing radios reset to 'na' so the new flow
-- starts from a clean slate — admins re-scan or set status manually.

ALTER TABLE "Radio" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'na';

ALTER TABLE "Radio" DROP COLUMN "checkedOut";
