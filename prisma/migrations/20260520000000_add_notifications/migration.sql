-- CreateTable: in-app notification history. One row per recipient per
-- notification — written alongside every push send so /notifications
-- can show what each user would have received even if push failed.
CREATE TABLE "Notification" (
    "id"        SERIAL NOT NULL,
    "userId"    INTEGER NOT NULL,
    "title"     TEXT NOT NULL,
    "body"      TEXT,
    "url"       TEXT,
    "tag"       TEXT,
    "read"      BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey: cascade so a deleted user clears their history too
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
