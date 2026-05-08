# Nodal Control — Entity Relationship Diagram

**Updated:** 2026-05-08
**Source of truth:** `prisma/schema.prisma`. Regenerate this diagram when the schema changes.

---

## Full ERD

```mermaid
erDiagram
    User ||--o{ Project : "creates"
    User ||--o{ ProjectMember : "has memberships"
    User ||--o{ ChangeRequest : "submits"
    User ||--o{ AccessRequest : "requests"
    User ||--o{ KeyDraft : "edits"
    User ||--o{ NfgReport : "reports"

    Project ||--o{ ProjectMember : "has members"
    Project ||--o{ PickListItem : "owns"
    Project ||--o{ ChangeRequest : "owns"
    Project ||--o{ AccessRequest : "receives"
    Project ||--o{ Equipment : "owns"
    Project ||--o{ RackTemplate : "scoped to"
    Project ||--o{ ProjectHeadsetInventory : "headset totals"

    ProjectMember ||--o{ PanelKey : "has keys"
    ProjectMember ||--o{ Equipment : "assigned to"
    ProjectMember ||--o{ ChangeRequest : "targeted by"
    Equipment ||--o{ PanelKey : "scoped to"
    Equipment ||--o{ ChangeRequest : "scoped to"

    PickListItem ||--o{ PanelKey : "assigned to key"
    PickListItem ||--o{ KeyDraft : "assigned in draft"

    PanelKey ||--o{ KeyDraft : "has drafts"
    PanelKey ||--o{ ChangeRequestItem : "referenced in item"

    ChangeRequest ||--o{ ChangeRequestItem : "contains"

    Asset ||--o{ Equipment : "physical inventory"
    Asset ||--o{ NfgReport : "referenced in NFG"
    Equipment ||--o{ NfgReport : "subject of"

    RackTemplate ||--o{ RackSlot : "has slots"

    User {
        int id PK
        string firstName
        string lastName
        string pin "bcrypt, null until first-login"
        int failedAttempts
        datetime lockedUntil
        datetime lastFailedAt
        datetime createdAt
        datetime updatedAt
    }

    Project {
        int id PK
        string name
        string pin UK "4-digit join code"
        string status "active or archived"
        int createdById FK
        int goosenecksBrought "panel misc inventory"
        int footswitchesBrought
        int speakersBrought
        int quarterXlrmBrought "1/4-XLRM cables"
        int db9XlrfBrought "DB9-XLRF cables"
        int rj45XlrmfBrought "RJ45-XLRM/F cables"
        boolean returnPhaseActive "drives crew /tasks Return queue"
        datetime createdAt
        datetime updatedAt
    }

    ProjectHeadsetInventory {
        int id PK
        int projectId FK
        string headsetType
        int brought
        datetime updatedAt
    }

    ProjectMember {
        int id PK
        int userId FK
        int projectId FK
        string role "admin manager crew user"
        string position "A1 FOH etc"
        string location "STAGE FOH MON"
        string hardwareType "legacy equipment carries this"
        string ipAddress "legacy"
        string headsetType "legacy"
        string deployStatus "legacy"
        int riedelId "unused"
    }

    PickListItem {
        int id PK
        int projectId FK
        string code "C1 IF1 G1 A1 or position for PTP"
        string name
        string type "PTP CONF IFB Audio_IO GRP"
    }

    PanelKey {
        int id PK
        int projectMemberId FK
        int equipmentId FK "scoped per device since 2026-05-08"
        int keyIndex "physical key position"
        string page "main or shift"
        int expansion "0 main 1-6 expansion"
        int pickListItemId FK
        string triggerMode "latch momentary auto"
        string talkMode "tl t l"
    }

    KeyDraft {
        int id PK
        int panelKeyId FK
        int editedById FK
        int pickListItemId FK
        string triggerMode
        string status "draft or submitted"
        datetime createdAt
    }

    ChangeRequest {
        int id PK
        int projectId FK
        int submittedById FK
        int targetMemberId FK
        int equipmentId FK "scoped per device since 2026-05-08"
        string status "submitted mgr_endorsed applied rejected"
        string rejectionNote
        datetime createdAt
        datetime resolvedAt
    }

    ChangeRequestItem {
        int id PK
        int changeRequestId FK
        int panelKeyId FK
        string fieldChanged "pickListItemId or triggerMode"
        string previousValue
        string newValue
    }

    AccessRequest {
        int id PK
        int userId FK
        int projectId FK
        string status "pending approved rejected"
        datetime createdAt
        datetime resolvedAt
    }

    Equipment {
        int id PK
        int projectId FK
        int assignedToId FK
        string name "PNL 1 WLBP 3 etc"
        string category "panels wireless_bp hardwire_bp switches antennas audio"
        string hardwareType "KP-5032 Bolero etc"
        string position
        string location
        string headsetType
        string ipAddress
        string patch
        string deployStatus "na deployed done returned not-needed damaged"
        string notes
        int assetId FK
        boolean gooseneck "panel misc accessory"
        int footswitches
        int speakers
    }

    Asset {
        int id PK
        string qrCode UK
        string hardwareType
        string serialNumber
        string owner
        string status "active retired repair"
        datetime createdAt
    }

    RackTemplate {
        int id PK
        string name
        string description
        int totalRU
        string type "standard or custom"
        int projectId FK
    }

    RackSlot {
        int id PK
        int rackTemplateId FK
        int ruPosition "top = 1"
        int ruSize
        string side "front or rear"
        string deviceType
        string label
        string color
    }

    NfgReport {
        int id PK
        int equipmentId FK
        int assetId FK
        int reportedById FK
        string notes
        string status "open acknowledged resolved"
        datetime createdAt
        datetime resolvedAt
    }
```

---

## Phase 1 core (active, in-use subset)

The subset of models driven by the UI today:

```mermaid
erDiagram
    User ||--o{ ProjectMember : ""
    Project ||--o{ ProjectMember : ""
    Project ||--o{ PickListItem : ""
    Project ||--o{ Equipment : ""
    ProjectMember ||--o{ PanelKey : ""
    ProjectMember ||--o{ Equipment : "assignedTo"
    Equipment ||--o{ PanelKey : "scoped to"
    Equipment ||--o{ ChangeRequest : "scoped to"
    PickListItem ||--o{ PanelKey : ""
    PanelKey ||--o{ KeyDraft : ""
    PanelKey ||--o{ ChangeRequestItem : ""
    ChangeRequest ||--o{ ChangeRequestItem : ""
    ChangeRequest }o--|| ProjectMember : "targetMember"
    ChangeRequest }o--|| User : "submittedBy"
```

---

## Unique constraints

| Model | Unique constraint | Enforces |
|---|---|---|
| `Project` | `pin` | No two active projects share a 4-digit join PIN |
| `ProjectMember` | `(userId, projectId)` | A user isn't on the same project twice |
| `PanelKey` | `(equipmentId, keyIndex, page, expansion)` | One physical key position per device — multi-device members get one row per device per slot (changed 2026-05-08; was scoped by `projectMemberId`) |
| `Asset` | `qrCode` | Every physical asset has a unique QR |
| `ProjectHeadsetInventory` | `(projectId, headsetType)` | One brought-total row per headset type per project |

---

## Model groupings

### Phase 1 — Pick List / Panels / Change Requests (in use)

`User`, `Project`, `ProjectHeadsetInventory`, `ProjectMember`, `PickListItem`, `PanelKey`, `KeyDraft`, `ChangeRequest`, `ChangeRequestItem`, `AccessRequest`

### Phase 2-4 — Equipment / Assets / Racks / NFG

`Equipment` (promoted into v2 — Equipment tab drives the app now), `Asset`, `RackTemplate`, `RackSlot`, `NfgReport` (schema present, no UI yet)
