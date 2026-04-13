# Nodal Control — Product Requirements Document

**Version:** 1.0
**Date:** April 12, 2026
**Author:** Jimmy Xlou / Versacom (ATK / Clair Global)
**Status:** Draft

---

## 1. Product Overview

### 1.1 What is Nodal Control?

Nodal Control is a collaborative intercom management platform for live production environments. It replaces the triple-entry workflow of Google Sheets + Riedel hardware programming + manual tracking with a single source of truth for show design, panel key assignments, change requests, equipment deployment, and device monitoring.

### 1.2 Problem Statement

Production comms teams currently maintain show designs in Google Sheets, manually program Riedel frames, and track deployments across disconnected tools. This creates:

- Triple data entry (sheet, hardware, tracking)
- Version conflicts when multiple people edit the same sheet
- No approval workflow for panel changes during live shows
- No real-time visibility into deployment progress
- No audit trail for who changed what and when

### 1.3 Solution

A four-page web application that serves as the single hub for all comms management:

| Page | Purpose |
|------|---------|
| **Distribution** | Master equipment view — replaces the Google Sheet entirely |
| **Panel Studio** | Pick list and key assignment with hardware-accurate panel layouts |
| **Inbox** | Change request and access request management |
| **Monitoring** | Device health, RF signal, switch stats (replaces Grafana) |

### 1.4 Target Users

Clair Global / ATK / Versacom comms teams operating at top-tier live events (Grammys, Super Bowl, Oscars, World Cup, etc.). Initially proving on Versacom (west coast) shows before company-wide rollout.

---

## 2. User Roles & Permissions

### 2.1 Role Definitions

| Role | Description | Location |
|------|-------------|----------|
| **Admin** | Plans shows, manages everything, final approval authority | Show site / Office |
| **Manager** | Oversees assigned projects, soft endorsement on changes | Show site |
| **Crew** | Deploys gear, marks status, flags NFG, edits own panel | Show site / Field |
| **User** | Views own panel, submits change requests only | Show site |
| **Shop** | Warehouse/repair staff, sees NFG reports, views show design | Warehouse |

### 2.2 Permission Matrix

#### Distribution Page

| Action | Admin | Manager | Crew | User | Shop |
|--------|-------|---------|------|------|------|
| Create / Edit Equipment | Yes | — | — | — | — |
| Assign Equipment to Person | Yes | — | — | — | — |
| Import / Export CSV | Yes | — | — | — | — |
| Manage Rack Templates | Yes | — | — | — | — |
| Update Deploy Status | Yes | — | Yes | — | — |
| View Distribution | Yes | Yes | Yes | — | Yes |
| Flag Device as NFG | — | — | Yes | — | — |
| View NFG Reports | — | — | — | — | Yes |

#### Panel Studio

| Action | Admin | Manager | Crew | User | Shop |
|--------|-------|---------|------|------|------|
| Edit Any User Panel | Yes | — | — | — | — |
| Edit Assigned Panels | — | Yes | — | — | — |
| Edit Own Panel | — | — | Yes | — | — |
| View Own Panel | — | — | — | Yes | — |
| Submit Change Request | — | — | Yes | Yes | — |
| Approve Changes — Final | Yes | — | — | — | — |
| Approve Changes — Tier 1 (Soft) | — | Yes | — | — | — |

#### Inbox

| Action | Admin | Manager | Crew | User | Shop |
|--------|-------|---------|------|------|------|
| Approve All Requests | Yes | — | — | — | — |
| Manage Access Requests | Yes | — | — | — | — |
| Approve Assigned Requests (Soft) | — | Yes | — | — | — |
| View Own Requests | — | — | Yes | Yes | — |

#### Monitoring

| Action | Admin | Manager | Crew | User | Shop |
|--------|-------|---------|------|------|------|
| Full Dashboard Access | Yes | — | — | — | — |
| View Assigned Devices | — | Yes | Yes | — | — |
| View Device Health | — | — | — | — | Yes |

### 2.3 Project Security

All roles including Admin can ONLY see projects they have created or been invited to. There is no global view across projects.

---

## 3. Data Model

### 3.1 Phase 1 — Pick List / Panels / Change Requests (9 Models)

#### USER
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| firstName | string | |
| lastName | string | |
| pin | string | Authentication credential |
| createdAt | datetime | |
| updatedAt | datetime | |

#### PROJECT
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| name | string | |
| status | string | active, archived |
| createdById | int | FK → User |
| createdAt | datetime | |
| updatedAt | datetime | |

#### PROJECT_MEMBER
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| userId | int | FK → User |
| projectId | int | FK → Project |
| role | string | admin, manager, crew, user |
| position | string | e.g. PLHQ, A1, A2 |
| location | string | e.g. FOH, MON, STAGE |
| hardwareType | string | e.g. RSP-1232, Bolero |
| ipAddress | string | Panel IP address |
| headsetType | string | e.g. 4 LWHS, DT290 |
| deployStatus | string | deployed, done, returned, not-needed, damaged, na |
| riedelId | int | Riedel hardware ID |

#### PICK_LIST_ITEM
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| projectId | int | FK → Project |
| name | string | Function name |
| type | string | PTP, CONF, IFB, Audio_IO |

#### PANEL_KEY
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| projectMemberId | int | FK → ProjectMember |
| keyIndex | int | Physical key position |
| page | string | main, shift |
| expansion | int | 0 = main panel, 1-6 = expansion |
| pickListItemId | int | FK → PickListItem (nullable) |
| triggerMode | string | latch, momentary, auto |

#### KEY_DRAFT
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| panelKeyId | int | FK → PanelKey |
| editedById | int | FK → User |
| pickListItemId | int | FK → PickListItem |
| triggerMode | string | |
| status | string | draft, submitted |
| createdAt | datetime | |

#### CHANGE_REQUEST
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| projectId | int | FK → Project |
| submittedById | int | FK → User |
| targetMemberId | int | FK → ProjectMember |
| status | string | draft, submitted, mgr_endorsed, approved, rejected, applied |
| rejectionNote | string | Reason if rejected |
| createdAt | datetime | |
| resolvedAt | datetime | |

#### CHANGE_REQUEST_ITEM
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| changeRequestId | int | FK → ChangeRequest |
| panelKeyId | int | FK → PanelKey |
| fieldChanged | string | Which field was modified |
| previousValue | string | Value before change |
| newValue | string | Value after change |

#### ACCESS_REQUEST
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| userId | int | FK → User |
| projectId | int | FK → Project |
| status | string | pending, approved, rejected |
| createdAt | datetime | |
| resolvedAt | datetime | |

### 3.2 Phase 2-4 — Equipment / Assets / Racks / NFG (5 Models)

#### EQUIPMENT
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| projectId | int | FK → Project |
| assignedToId | int | FK → ProjectMember (nullable) |
| category | string | panels, wireless_bp, hardwire_bp, switches, antennas |
| hardwareType | string | Specific model |
| position | string | e.g. A1, A2, STAGE MGR |
| location | string | e.g. FOH, MON, STAGE |
| headsetType | string | |
| frequency | string | 1.9 / 2.4 GHz bands |
| bpNumber | string | Beltpack number |
| source | string | Signal source |
| deployStatus | string | planning, holding, deployed, done, returned, not-needed, nfg |
| notes | string | Free-form notes |
| assetId | int | FK → Asset (nullable) |

#### ASSET
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| qrCode | string | Physical QR label |
| hardwareType | string | |
| serialNumber | string | |
| owner | string | e.g. Clair Global |
| status | string | active, retired, repair |
| createdAt | datetime | |

#### RACK_TEMPLATE
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| name | string | e.g. FS11, Bolero, Bolero to Helixnet |
| description | string | |
| totalRU | int | Total rack units |
| type | string | standard (touring) or custom |
| projectId | int | FK → Project (nullable for templates) |

#### RACK_SLOT
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| rackTemplateId | int | FK → RackTemplate |
| ruPosition | int | Starting RU position (top = 1) |
| ruSize | int | Height in RU (1RU = 1.75 inches) |
| side | string | front, rear |
| deviceType | string | e.g. Artist-64 Frame, Antaira Switch |
| label | string | Display label |
| color | string | Color code for visual grouping |

#### NFG_REPORT
| Field | Type | Notes |
|-------|------|-------|
| id | int | PK |
| equipmentId | int | FK → Equipment |
| assetId | int | FK → Asset (nullable) |
| reportedById | int | FK → User |
| notes | string | Description of the issue |
| status | string | open, acknowledged, resolved |
| createdAt | datetime | |
| resolvedAt | datetime | |

### 3.3 Relationships Summary

```
USER ──1:N──> PROJECT (creates)
USER ──1:N──> PROJECT_MEMBER (belongs to)
USER ──1:N──> CHANGE_REQUEST (submits)
USER ──1:N──> KEY_DRAFT (edits)
USER ──1:N──> ACCESS_REQUEST (requests)
USER ──1:N──> NFG_REPORT (reports)

PROJECT ──1:N──> PROJECT_MEMBER
PROJECT ──1:N──> PICK_LIST_ITEM
PROJECT ──1:N──> CHANGE_REQUEST
PROJECT ──1:N──> ACCESS_REQUEST
PROJECT ──1:N──> EQUIPMENT
PROJECT ──1:N──> RACK_TEMPLATE

PROJECT_MEMBER ──1:N──> PANEL_KEY
PROJECT_MEMBER ──1:N──> EQUIPMENT (assigned to)

PICK_LIST_ITEM ──1:N──> PANEL_KEY (used by)
PICK_LIST_ITEM ──1:N──> KEY_DRAFT (draft uses)

PANEL_KEY ──1:N──> KEY_DRAFT
PANEL_KEY ──1:N──> CHANGE_REQUEST_ITEM

CHANGE_REQUEST ──1:N──> CHANGE_REQUEST_ITEM

RACK_TEMPLATE ──1:N──> RACK_SLOT

ASSET ──1:N──> EQUIPMENT (tracked as)
ASSET ──1:N──> NFG_REPORT

EQUIPMENT ──1:N──> NFG_REPORT
```

---

## 4. State Machines

### 4.1 Panel Key State

Keys have three visual states that are uniform across all roles:

| State | Color | Meaning |
|-------|-------|---------|
| **Clear** | No highlight | Live on hardware — current active assignment |
| **Yellow** | `#f59e0b` | Local draft — user has made changes not yet submitted |
| **Green** | `#10b981` | Submitted — change request awaiting approval |

**Transitions:**
```
[Created] → Clear
Clear → Yellow      (User edits key)
Yellow → Yellow     (Additional edits)
Yellow → Clear      (User discards changes)
Yellow → Green      (User submits change request)
Green → Clear       (Admin approves — applied to live)
Green → Yellow      (Rejected — reverted to draft for re-edit)
```

### 4.2 Change Request Lifecycle

Manager approval is a **soft endorsement** — it is advisory, not blocking. Admin has sole final approval authority. Requests can skip directly to Admin review.

| Status | Description |
|--------|-------------|
| **Draft** | User has local edits, not yet submitted |
| **Submitted** | Sent for review, visible in Inbox |
| **MgrEndorsed** | Manager has reviewed and endorsed (soft) |
| **Approved** | Admin has approved |
| **Applied** | Changes written to live PanelKey records |
| **Rejected** | Denied by Admin (with rejection note) |
| **Discarded** | User cancelled before submitting |

**Transitions:**
```
[Created] → Draft
Draft → Submitted           (User submits)
Draft → Discarded           (User cancels)
Submitted → MgrEndorsed     (Manager endorses — soft approval)
Submitted → AdminReview      (Skips to Admin directly)
MgrEndorsed → Applied        (Admin approves)
MgrEndorsed → Rejected       (Admin rejects)
AdminReview → Applied        (Admin approves)
AdminReview → Rejected       (Admin rejects)
Applied → [Done]
Rejected → [Done]
Discarded → [Done]
```

### 4.3 Equipment Deploy Status

| Status | Color | Background | Description |
|--------|-------|------------|-------------|
| **Planning** | — | — | Added to show design, not yet assigned |
| **Holding** | — | — | Assigned to person/location, not yet installed |
| **Deployed** | `#0178a3` | `rgba(1,120,163,0.15)` | Physically installed and working on site |
| **Done** | `#059669` | `rgba(5,150,105,0.20)` | Show complete, gear still in place |
| **Returned** | `#f97316` | `rgba(249,115,22,0.15)` | Gear checked back into warehouse |
| **Not Needed** | `#ef4444` | `rgba(239,68,68,0.15)` | Cut from show |
| **NFG** | `#a855f7` | `rgba(168,85,247,0.15)` | Non-functional, flagged for Shop |
| **Damaged** | `#a855f7` | `rgba(168,85,247,0.15)` | Physical damage reported |
| **NA** | `rgba(148,163,184,0.5)` | `rgba(255,255,255,0.04)` | Not applicable |

**Transitions:**
```
[Added] → Planning
Planning → Holding           (Assigned to person + location)
Planning → Not Needed        (Cut before deployment)
Holding → Deployed           (Crew installs on site)
Holding → Not Needed         (Cut from show)
Deployed → Done              (Show complete)
Deployed → Returned          (Pulled early)
Deployed → NFG               (Device fails — creates NFG Report)
NFG → Returned               (After repair or replacement)
Done → Returned              (Gear checked back in)
Returned → [End]
Not Needed → [End]
```

---

## 5. Core Workflows

### 5.1 Change Request Flow (Key Edit to Approval)

```
1. Crew taps key in Panel Studio → assigns pick list function
2. Key turns YELLOW (draft)
3. Crew edits more keys as needed
4. Crew taps Submit → POST /change-requests
5. API creates ChangeRequest + ChangeRequestItems + KeyDrafts
6. Keys turn GREEN (submitted)
7. Manager sees request in Inbox → endorses (soft) → PATCH /cr/:id
8. Admin sees request in Inbox → approves → PATCH /cr/:id
9. API writes KeyDraft values to live PanelKey records
10. API deletes KeyDrafts
11. On next refresh, keys turn CLEAR (live)
```

### 5.2 Equipment Deployment Flow

```
1. Admin adds equipment entry → POST /equipment (status: planning)
2. Admin assigns to person + location → PATCH /equipment/:id (status: holding)
3. Admin can bulk import via CSV → POST /equipment/import
4. Crew opens Distribution on site → sees equipment list
5. Crew marks device as Deployed → PATCH /equipment/:id/status
6a. Show wraps → Crew marks Done
6b. Device fails → Crew flags NFG → creates NFG Report
7. Shop sees NFG reports → acknowledges
8. Crew marks gear as Returned when checked back in
```

### 5.3 Join Project / Access Request Flow

```
1. New user taps "Join Project" on Login screen
2. Enters name + project code → POST /access-requests (status: pending)
3. Shown "Request Pending" screen
4. Admin sees request in Inbox → approves
5. API creates ProjectMember record + generates PIN
6. User returns to Login → enters PIN → authenticated
7. Navigated to Dashboard
```

---

## 6. Authentication

### 6.1 Auth Method

PIN-based authentication. No emails or passwords — practical for production environments where people share workstations.

### 6.2 Auth Views (6 Total)

| View | Purpose |
|------|---------|
| **authLogin** | PIN entry + project selection |
| **authJoin** | Join Project request form |
| **authForgot** | Forgot PIN request form |
| **authSetup** | Initial setup |
| **authPending** | Access request awaiting admin approval |
| **authPinPending** | PIN reset awaiting admin action |

### 6.3 Auth Flow

```
App Launch → Logout Modal → Login Screen
Login → Enter PIN → Valid? → Login & Connect → Dashboard
Login → Join Project → Submit Request → Pending → Admin Approves → Login
Login → Forgot PIN → Submit → Pending → Admin Resets → Login
```

---

## 7. Panel Hardware Specifications

### 7.1 Supported Hardware Types

| Hardware | Key Count | Grid Layout | Blocks |
|----------|-----------|-------------|--------|
| RSP-1216 | 16 | 8x1 | 2 blocks |
| RSP-1232 | 32 | 8x2 | 2 blocks |
| KP-32 | 32 | 8x2 | 2 blocks |
| KP-5032 | 32 | 8x2 | 2 blocks |
| RSP-2318 PRO | 18 | 2x3 | 3 blocks |
| DSP-2312 | 12 | 2x3 | 2 blocks |
| Bolero | 6 | 2x3 | 1 block |
| DBP | 4 | 2x2 | 1 block |
| ST-374 | 4 | 4x1 | 1 block |
| ST-370 | 2 | 2x1 | 1 block |
| C3 | 2 | 2x1 | 1 block |

### 7.2 Panel Layout Rules

- Layouts are **fixed** — they mirror the physical hardware exactly
- Key size: 64x64px
- User scrolls if the panel exceeds viewport
- Panels are NOT editable/rearrangeable — the grid matches what the user physically sees

### 7.3 Expansion Panels

Only the following hardware supports expansion panels (max 6):
- RSP-1216
- RSP-1232
- KP-32
- KP-5032
- RSP-2318 PRO

### 7.4 Shift/Main Pages

Main and Shift page toggle is **hidden** for:
- Bolero (6-Key)
- DBP (4-Key)
- ST-374
- ST-370
- C3

### 7.5 Key Display

| Element | Position | Format |
|---------|----------|--------|
| Function type | Bottom-left | Single letter: P (PTP), C (CONF), I (IFB), 4 (Audio_IO), G (GPIO) |
| Trigger mode | Bottom-right | Single letter: L (Latch), M (Momentary), A (Auto) |
| PTP label | Center | First name only, truncated to 8 chars |
| Font size | — | 0.55rem, nowrap |

### 7.6 Pick List Function Types

| Type | Description |
|------|-------------|
| PTP | Point to Point |
| CONF | Conference |
| IFB | Interruptible Foldback |
| Audio_IO | Audio Input/Output (formerly 4-Wire) |

---

## 8. UI/UX Specifications

### 8.1 Color Scheme (Authorized — Do Not Change)

```css
--accent-cyan:   #0178a3
--accent-green:  #10b981
--accent-red:    #ef4444
--accent-yellow: #f59e0b
--accent-blue:   #3b82f6
--bg-dark:       #0f1115
--bg-panel:      #000000
Body:            #202020
Sidebar:         #313131
Header:          #202020
Font:            Roboto
```

### 8.2 Role Badges

All gray, no per-role colors:
```css
background: rgba(255,255,255,0.08);
color: rgba(148,163,184,0.8);
```

### 8.3 Mobile Breakpoint

**900px** — at 900px and below, switch to mobile layout.

### 8.4 Dashboard Layout

- Tabs pinned at top: INBOX, USERS, PROJECTS, PICK LIST, UPLOAD
- Content scrolls beneath the tabs
- Accordion flush pattern for all data lists (Users, Projects, Pick List)
- Only one accordion row open at a time per group

### 8.5 User Accordion Header — Desktop

```
[STATUS] | ID | Name + Position | Location | Hardware | Headset | IP | Role | chevron
```

Grid layout with `display:contents` technique to dissolve inner container so all children participate in the parent grid — enables consistent column alignment across all accordion rows.

### 8.6 User Accordion Header — Mobile (below 900px)

```
Row 1: [STATUS]   Name       Position    Role     chevron
Row 2:    ID      Location   Hardware    IP
```

Headset hidden on mobile.

### 8.7 User Accordion Body — Desktop

```
Row 1: First Name | Last Name | Position | Role
Row 2: ID | Hardware | IP Address | Headset
Row 3: Save | Delete
```

Location field hidden on desktop (visible in header).

### 8.8 User Accordion Body — Mobile

```
Row 1: First Name | Last Name
Row 2: Position | Role
Row 3: Location | ID
Row 4: Hardware | Headset
Row 5: IP Address
Row 6: Save | Delete
```

### 8.9 Mobile Panel Interaction

Bottom sheet pattern — half-screen sheet slides up from bottom when a key is tapped on mobile. Contains: Assign Function, Set Trigger Mode, View Key Details.

---

## 9. Equipment Categories (Distribution Page)

The Google Sheet had separate tabs per hardware type. Nodal Control replaces all tabs with **one unified Equipment model** filtered by category chips:

| Category | Fields Used | Person Assigned? |
|----------|-------------|------------------|
| **Panels** | status, stage, hardwareType, position, name, headsetType, source | Yes |
| **Wireless BP** | status, stage, frequency, position, name, headsetType, bpNumber | Yes |
| **Hardwire BP** | status, stage, bpType, bpNumber, position, name, source, headsetType | Yes |
| **Switches** | status, stage, deviceType, location, notes | No |
| **Antennas** | status, stage, frequency, location, source, notes | No |

Every category follows the same pattern: **a piece of equipment, optionally assigned to a person, at a location, with a deployment status**. The only difference is which metadata fields apply.

### 9.1 Distribution Page Features

- Filter chips: All, Panels, Wireless, Hardwire, Switches, Antennas
- Summary counts at top: Total / Deployed / Holding / Done / NFG
- Import CSV and Export (CSV, PDF)
- Inventory auto-calculated from equipment data (no separate tab)

---

## 10. Rack Layouts

### 10.1 Two Configuration Types

| Type | Description |
|------|-------------|
| **Standard** | Clair HQ touring packages — predefined templates reused across shows |
| **Custom** | ATK/Versacom one-off configurations per event |

### 10.2 Display Rules

- Accurate RU (Rack Unit) sizing: 1RU = 1 slot, 2RU = 2 slots, etc.
- Upright orientation — wheels at bottom, gear stacked top-to-bottom
- Color-coded by device type
- Front/rear view toggle
- Filter chips: All Racks, FS11, Bolero, etc.
- Export PDF, Print, Custom Build buttons

### 10.3 Standard Rack Configurations

| Rack | Total RU | Contents |
|------|----------|----------|
| **FS11** | 12 RU | 2x Artist-64 Frame (3RU), 2x Antaira Switch (1RU), XLR + BNC/Fiber Patch (1RU each), UPS (2RU) |
| **Bolero to Helixnet** | 12 RU | 2x Bolero AES (2RU), Helixnet HMS-4X (1RU), Antaira (1RU), Media Converter (1RU), XLR Patch (1RU), UPS (2RU) |
| **Bolero** | 10 RU | 2x Bolero AES (2RU), Antaira 9P+1F (1RU), Media Converter (1RU), XLR Patch (1RU), Blank (1RU), UPS (2RU) |
| **FS11 to OMS** | 14 RU | Artist-64 Frame (3RU), Compact Unit (2RU), 2x Antaira (1RU), 2x Media Converter (1RU), XLR + BNC/Fiber Patch (1RU each), UPS (2RU) |

---

## 11. Monitoring (Phase 3)

### 11.1 Data Sources

- APIs pushing alerts to Webex when devices go offline
- Grafana dashboards (to be replaced by in-app monitoring)
- Device names from Distribution serve as the naming authority for Webex and Grafana

### 11.2 Metrics

- Switch CPU usage
- SFP signal values
- Bolero RF: RSSI, antenna assignment, battery level
- Antenna signal strength
- Device online/offline status

---

## 12. NFG (Non-Functional Gear) Workflow

1. Crew or Admin flags a device as NFG with notes
2. NFG Report created, linked to Equipment and optionally to Asset
3. Shop role sees NFG reports in their view
4. Shop acknowledges and handles in company inventory system
5. Integration with company tracking database pending corporate approval
6. Nodal is read-only toward the company asset system for now

---

## 13. Phased Rollout

| Phase | Name | Scope |
|-------|------|-------|
| **Phase 1** | Pick List Beta | Login, panels, pick list, change requests, approval workflow. Codex refactoring in progress. |
| **Phase 2** | Show Design | Replace Google Sheet. One equipment catalog, filtered views, deployment tracking. This becomes the daily driver. |
| **Phase 3** | Monitoring | Device health, RF signal, switch stats tied to show design entries. |
| **Phase 4** | Asset Tracking | QR scanning, gear lifecycle, rack templates, shop visibility, NFG workflow. |

---

## 14. Technical Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16 (App Router) + TypeScript |
| **Styling** | Tailwind CSS |
| **Communication** | REST API |
| **Database** | Prisma ORM + Neon Postgres (Vercel-compatible serverless) |

---

## 15. API Design (REST)

### 15.1 Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | Validate PIN, return auth token |
| POST | `/auth/forgot-pin` | Request PIN reset |

### 15.2 Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects` | List user's projects |
| POST | `/projects` | Create new project |
| PATCH | `/projects/:id` | Update project |
| PATCH | `/projects/:id/archive` | Archive project |

### 15.3 Users / Project Members

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects/:id/members` | List members |
| POST | `/projects/:id/members` | Add member |
| PATCH | `/members/:id` | Update member fields |
| DELETE | `/members/:id` | Remove from project |
| PATCH | `/members/:id/deploy-status` | Update deploy status |

### 15.4 Pick List

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects/:id/picklist` | List functions |
| POST | `/projects/:id/picklist` | Create function |
| PATCH | `/picklist/:id` | Update function |
| DELETE | `/picklist/:id` | Delete function |

### 15.5 Panel Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/panels/:memberId/keys` | Get all keys for a member's panel |
| PATCH | `/keys/:id` | Update key assignment (creates draft) |

### 15.6 Change Requests

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/inbox/change-requests` | List pending CRs |
| POST | `/change-requests` | Submit new CR |
| PATCH | `/change-requests/:id` | Endorse (manager) or approve/reject (admin) |

### 15.7 Access Requests

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/access-requests` | Request to join project |
| GET | `/inbox/access-requests` | List pending access requests |
| PATCH | `/access-requests/:id` | Approve or reject |

### 15.8 Equipment (Phase 2)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/equipment?project=:id` | List equipment |
| POST | `/equipment` | Add equipment |
| POST | `/equipment/import` | Bulk CSV import |
| PATCH | `/equipment/:id` | Update equipment |
| PATCH | `/equipment/:id/status` | Update deploy status |
| POST | `/equipment/:id/nfg` | Flag as NFG |

### 15.9 NFG Reports (Phase 4)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/nfg-reports` | List NFG reports |
| PATCH | `/nfg-reports/:id` | Acknowledge / resolve |

---

## 16. UML Diagram References

All diagrams are maintained in the `/docs/` directory and viewable in-browser at `http://localhost:4445/uml-diagrams.html`:

| Diagram | Source File | Description |
|---------|-----------|-------------|
| User Flow | `docs/user-flow.md` | Full app navigation flowchart |
| Use Case | `docs/uml-use-case.md` | Role permissions per page |
| ERD | `docs/uml-erd.md` | Entity relationships (Phase 1 + Phase 2-4) |
| State Diagrams | `docs/uml-state-diagrams.md` | Key state, CR lifecycle, deploy status |
| Sequence Diagrams | `docs/uml-sequence-diagrams.md` | CR flow, deployment flow, join project flow |

Browser-viewable HTML with tab navigation: `docs/uml-diagrams.html`

---

## 17. Open Questions

1. **Bulk key operations**: Can a user submit changes to multiple keys in one change request? (Current assumption: yes, batch submit)
2. **Admin self-approval**: If an Admin edits their own panel, does it auto-apply or require another Admin?
3. **Company asset DB integration**: Timeline for Clair corporate approval for read access?
4. **Upload tab**: Currently defined in Phase 1 dashboard but no workflow specified. Replaced by Distribution Import in Phase 2?
