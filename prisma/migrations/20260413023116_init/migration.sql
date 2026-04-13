-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "position" TEXT,
    "location" TEXT,
    "hardwareType" TEXT,
    "ipAddress" TEXT,
    "headsetType" TEXT,
    "deployStatus" TEXT NOT NULL DEFAULT 'na',
    "riedelId" INTEGER,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickListItem" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "PickListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PanelKey" (
    "id" SERIAL NOT NULL,
    "projectMemberId" INTEGER NOT NULL,
    "keyIndex" INTEGER NOT NULL,
    "page" TEXT NOT NULL DEFAULT 'main',
    "expansion" INTEGER NOT NULL DEFAULT 0,
    "pickListItemId" INTEGER,
    "triggerMode" TEXT NOT NULL DEFAULT 'latch',

    CONSTRAINT "PanelKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyDraft" (
    "id" SERIAL NOT NULL,
    "panelKeyId" INTEGER NOT NULL,
    "editedById" INTEGER NOT NULL,
    "pickListItemId" INTEGER,
    "triggerMode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRequest" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "submittedById" INTEGER NOT NULL,
    "targetMemberId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "rejectionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeRequestItem" (
    "id" SERIAL NOT NULL,
    "changeRequestId" INTEGER NOT NULL,
    "panelKeyId" INTEGER NOT NULL,
    "fieldChanged" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,

    CONSTRAINT "ChangeRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "assignedToId" INTEGER,
    "category" TEXT NOT NULL,
    "hardwareType" TEXT,
    "position" TEXT,
    "location" TEXT,
    "headsetType" TEXT,
    "frequency" TEXT,
    "bpNumber" TEXT,
    "source" TEXT,
    "deployStatus" TEXT NOT NULL DEFAULT 'planning',
    "notes" TEXT,
    "assetId" INTEGER,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" SERIAL NOT NULL,
    "qrCode" TEXT NOT NULL,
    "hardwareType" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RackTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "totalRU" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "projectId" INTEGER,

    CONSTRAINT "RackTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RackSlot" (
    "id" SERIAL NOT NULL,
    "rackTemplateId" INTEGER NOT NULL,
    "ruPosition" INTEGER NOT NULL,
    "ruSize" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT,

    CONSTRAINT "RackSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NfgReport" (
    "id" SERIAL NOT NULL,
    "equipmentId" INTEGER NOT NULL,
    "assetId" INTEGER,
    "reportedById" INTEGER NOT NULL,
    "notes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "NfgReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_userId_projectId_key" ON "ProjectMember"("userId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PanelKey_projectMemberId_keyIndex_page_expansion_key" ON "PanelKey"("projectMemberId", "keyIndex", "page", "expansion");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_qrCode_key" ON "Asset"("qrCode");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickListItem" ADD CONSTRAINT "PickListItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanelKey" ADD CONSTRAINT "PanelKey_projectMemberId_fkey" FOREIGN KEY ("projectMemberId") REFERENCES "ProjectMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanelKey" ADD CONSTRAINT "PanelKey_pickListItemId_fkey" FOREIGN KEY ("pickListItemId") REFERENCES "PickListItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyDraft" ADD CONSTRAINT "KeyDraft_panelKeyId_fkey" FOREIGN KEY ("panelKeyId") REFERENCES "PanelKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyDraft" ADD CONSTRAINT "KeyDraft_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyDraft" ADD CONSTRAINT "KeyDraft_pickListItemId_fkey" FOREIGN KEY ("pickListItemId") REFERENCES "PickListItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_targetMemberId_fkey" FOREIGN KEY ("targetMemberId") REFERENCES "ProjectMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequestItem" ADD CONSTRAINT "ChangeRequestItem_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeRequestItem" ADD CONSTRAINT "ChangeRequestItem_panelKeyId_fkey" FOREIGN KEY ("panelKeyId") REFERENCES "PanelKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "ProjectMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RackTemplate" ADD CONSTRAINT "RackTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RackSlot" ADD CONSTRAINT "RackSlot_rackTemplateId_fkey" FOREIGN KEY ("rackTemplateId") REFERENCES "RackTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NfgReport" ADD CONSTRAINT "NfgReport_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NfgReport" ADD CONSTRAINT "NfgReport_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NfgReport" ADD CONSTRAINT "NfgReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
