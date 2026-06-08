-- Switch Studio: VlanProfile + SwitchPort tables.
-- Seeds VlanProfile with the 25-entry company-wide pool.
-- See prisma/schema.prisma for full field-level documentation.

-- ============================================================
-- 1. VlanProfile (global, seeded)
-- ============================================================
CREATE TABLE "VlanProfile" (
    "id"           SERIAL PRIMARY KEY,
    "name"         TEXT NOT NULL,
    "vlanId"       INTEGER NOT NULL,
    "color"        TEXT NOT NULL,
    "profileType"  TEXT NOT NULL,
    "description"  TEXT,
    "sortOrder"    INTEGER NOT NULL
);

CREATE UNIQUE INDEX "VlanProfile_vlanId_key" ON "VlanProfile"("vlanId");

-- Seed the 25 profiles. Order matches the table the operator sees in
-- NETGEAR ProAV Engage so the popover list reads identically.
-- V-CommsDante2 + VPN Transfer hex values sampled from the Engage
-- screenshot; everything else from the operator's typed VLAN list.
INSERT INTO "VlanProfile" ("name", "vlanId", "color", "profileType", "description", "sortOrder") VALUES
    ('Default',        1,     '#FFFFFF', 'Data',         'NOT USED',                                                                   10),
    ('Reserved',       2,     '#FFFFFF', 'Data',         'Reserved for AVB MVRP',                                                      20),
    ('Program',        1301,  '#8B5A2B', 'Audio Dante',  'Program VLAN; Main protocol of the gig. Reserved for Audio on converged networks.', 30),
    ('Secondary',      1311,  '#D80000', 'Audio Dante',  'Secondary Program VLAN (when separating AoIP Secondary is unavoidable)',     40),
    ('V-CommsDante1',  1331,  '#0072CE', 'Audio Dante',  'Comms Dante Traffic',                                                        50),
    ('V-CommsDante2',  1332,  '#002F6C', 'Audio Dante',  'Comms Dante Traffic',                                                        60),
    ('V-AES67_1',      1341,  '#006666', 'Audio AES67',  'AES67 Traffic, typically Comms',                                             70),
    ('V-AES67_2',      1342,  '#00A3A3', 'Audio AES67',  'AES67 Traffic, typically Comms',                                             80),
    ('Lighting1',      1351,  '#FFD700', 'Data',         'Used for Lighting',                                                          90),
    ('Lighting2',      1352,  '#FFC000', 'Data',         'Used for Lighting',                                                          100),
    ('Lighting3',      1353,  '#FFAA00', 'Data',         'Used for Lighting',                                                          110),
    ('Lighting4',      1354,  '#E59400', 'Data',         'Used for Lighting',                                                          120),
    ('Lighting5',      1355,  '#B36B00', 'Data',         'Used for Lighting',                                                          130),
    ('Video1',         1361,  '#4F8A10', 'Data',         'Used for Video',                                                             140),
    ('Video2',         1362,  '#7FB800', 'Data',         'Used for Video',                                                             150),
    ('Automation1',    1401,  '#5E3370', 'Data',         'Used for Automation',                                                        160),
    ('Automation2',    1402,  '#8E44AD', 'Data',         'Used for Automation',                                                        170),
    ('VLAN7',          1371,  '#0B3C5D', 'Data',         'Available (often renamed Truck 1 on a show)',                                180),
    ('VLAN8',          1381,  '#145A7D', 'Data',         'Available (often renamed Truck 2 on a show)',                                190),
    ('VLAN9',          1391,  '#1E789D', 'Data',         'Available (often renamed Truck 3 on a show)',                                200),
    ('WAN1',           666,   '#D119AE', 'Data',         'Primary Internet',                                                           210),
    ('WAN2',           667,   '#F07CDA', 'Data',         'Secondary Internet',                                                         220),
    ('VPN Transfer',   2211,  '#3D1A78', 'Data',         'VPN Transfer',                                                               230),
    ('Null/Blackhole', 999,   '#FFFFFF', 'Data',         'Security — connects but goes nowhere',                                       240),
    ('Management',     4000,  '#808080', 'Data',         'Untagged on Trunk ports used for switch management',                         250);

-- ============================================================
-- 2. SwitchPort (per-equipment, created lazily)
-- ============================================================
CREATE TABLE "SwitchPort" (
    "id"          SERIAL PRIMARY KEY,
    "equipmentId" INTEGER NOT NULL,
    "portIndex"   INTEGER NOT NULL,
    "portKind"    TEXT NOT NULL,
    "profileId"   INTEGER,
    "isTrunk"     BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "SwitchPort_equipment_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SwitchPort_profile_fkey"   FOREIGN KEY ("profileId")   REFERENCES "VlanProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SwitchPort_equipmentId_portIndex_key" ON "SwitchPort"("equipmentId", "portIndex");
CREATE INDEX "SwitchPort_equipmentId_idx" ON "SwitchPort"("equipmentId");
