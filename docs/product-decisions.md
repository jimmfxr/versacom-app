# Nodal Control — Product Decisions

A living record of key product decisions and the reasoning behind them.

---

## PD-001: PIN-based authentication (no email/password)

**Decision:** Users authenticate with a PIN only. No email addresses or passwords.

**Why:** Production environments are fast-paced — crew share workstations, rotate between shows, and need instant access. Email/password adds friction with no benefit on-site. A PIN is quick to enter and easy to remember.

**PIN delivery:** Admin creates or resets a PIN, then communicates it to the user verbally or in person (manager-to-crew). There is no automated email or SMS delivery.

---

## PD-002: No email field on User model

**Decision:** The User model has no email field.

**Why:** Keeping the model simple. Email would imply password reset flows, notification systems, and off-site access patterns that don't match how this tool is used. Users are on-site crew who get their PIN from their manager directly. Less fields = less to manage.

---

## PD-003: REST API only (no WebSocket)

**Decision:** All client-server communication uses REST API. No WebSocket connections.

**Why:** Simplifies the architecture. The app doesn't need real-time push — users can refresh or poll to see updated state. REST is easier to debug, cache, and scale.

---

## PD-004: Next.js 16 + Tailwind CSS

**Decision:** The app is built with Next.js 16 (App Router) and Tailwind CSS.

**Why:** Replaces the previous React 17 + Vanilla CSS + Express stack. Next.js provides both frontend and API routes in one framework, eliminating the need for a separate Express backend. Tailwind speeds up UI development.

---

## PD-005: Offline resilience is not a priority

**Decision:** No offline-first or local caching strategy.

**Why:** Nodal Control is a web app used on-site where internet access is available. It doesn't connect to hardware directly — it's a management and planning tool. If the network is down, the show comms still work (Riedel hardware operates independently). The app can wait for connectivity to resume.

---

## PD-006: No audit log for Admin actions

**Decision:** No separate audit log table for tracking Admin changes.

**Why:** Only Admins can make direct edits (equipment, users, pick list, etc.), so we already know who made changes. This is a tool built for Admins to make their own jobs easier — it doesn't connect to external systems or have external stakeholders who need an audit trail. The change request flow already tracks Crew/User changes with full history.

---

## PD-007: CR rejection displays inline via polling

**Decision:** When a change request is rejected, the rejection note displays directly in the user's Panel Studio UI. Keys revert to Yellow (draft) so the user can edit and resubmit.

**How it works:** The UI polls the API for CR status. When the status comes back as `rejected`, the rejection note from the Admin renders inline on the page alongside the affected keys. No separate notification system — the user sees it next time they view their panel.
