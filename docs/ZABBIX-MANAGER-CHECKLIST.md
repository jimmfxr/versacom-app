# Zabbix integration — what we need from your side

Your Zabbix server is already running and your Streamlit tool already
talks to it. We're not asking you to build anything new — we're asking
you to **confirm a handful of things and share credentials** so the
Nodal Control web app can call the same Zabbix endpoints your existing
tool uses.

The Nodal-side code is already in place at
[services/zabbix-sync/](../services/zabbix-sync/) — a small Python
service (FastAPI wrapper around your `nodal_zabbix_core.py`, vendored
as-is) that Nodal calls when an admin clicks **Sync to Zabbix** on a
project. Versacom will host that service on Render against your
credentials; nothing has to run on your network.

---

## 1. Credentials to share

Send these directly to Jimmy (Signal / 1Password share / however you
normally exchange creds — **not in this repo**).

| # | What | Notes |
|---|---|---|
| 1 | `ZABBIX_URL` | Confirm: `https://atk-zabbix.ddns.net/zabbix/`? |
| 2 | `ZABBIX_USER` | Ideally a **dedicated service account** with admin rights, not your personal login. |
| 3 | `ZABBIX_PASSWORD` | Strong password for that service account. |
| 4 | `WEBEX_BOT_TOKEN` | The bot token your existing Streamlit tool uses. Don't create a new bot. |
| 5 | `BOLERO_HUB_URL` | Confirm: `http://atk-zabbix.ddns.net:5005/inventory/antenna/{kit_number}`? Keep the literal `{kit_number}` placeholder. |

---

## 2. Confirmations (one-line yes/no per item)

Your Streamlit tool already depends on each of these, so this should
all be quick confirmation. Flag anything that's been renamed or
removed.

### 2.1 Templates on the Zabbix server

| Template name (exact) |
|---|
| `Simple Ping` |
| `Netgear M4250 SNMP NW` |
| `UPS Liebert Vertiv GTX5` |
| `UPS Tower` |
| `Bolero Collector` |

### 2.2 Media type on the Zabbix server

`Webex-Bulk` — must exist, must have a `room_id` parameter. The sidecar
clones it per show and rewrites the `room_id`.

### 2.3 Notification user group

The trigger-action code in `nodal_zabbix_core.py` sends Webex alerts to
`usrgrpid = "7"`. Confirm that's the correct group on your server, or
tell us the ID we should use instead.

### 2.4 Network reachability

Your Zabbix frontend resolves via DDNS (`atk-zabbix.ddns.net`) and
appears to be publicly reachable — that's what lets Versacom host the
sidecar on Render and call into it. If that's wrong (firewall in front,
IP allowlist, etc.) say so now and we'll figure out a tunnel.

---

## 3. What you do NOT have to do

For clarity, none of these are on your plate:

- Provisioning a server / Docker host / VPN — the sidecar runs on
  Render (Versacom-owned).
- Writing or modifying any Python code — `nodal_zabbix_core.py` is
  vendored unchanged in our repo.
- Creating new templates, media types, or user groups — your existing
  ones get reused.
- Maintaining a separate sync schedule — Nodal triggers sync on demand
  per project.

---

## 4. What happens after you reply

Once we have items 1–5 + the confirmations from §2:

1. Versacom deploys the sidecar to Render with your credentials.
2. We smoke-test by calling `GET /proxies` — if your Zabbix proxies
   come back, the integration is wired.
3. Nodal-side work ships: schema field on Project, "Sync to Zabbix" /
   "Remove from Zabbix" buttons on Project Details, payload mapping
   from Nodal equipment to your DEVICE_REGISTRY, project admin emails
   auto-added to the Webex space.

Estimated turnaround after credentials land: ~1 working session.

---

## 5. Reference (FYI — don't act on this)

How Nodal's equipment categories will map to your DEVICE_REGISTRY keys
once it's wired. Flag any of these that look wrong.

| Nodal `Equipment.category` | DEVICE_REGISTRY key | Notes |
|---|---|---|
| `switches` | `networking` | SNMP, port 161 |
| `antennas` | `antennas` | Bolero, Simple Ping, Bolero inventory POST |
| `panels` | `panels-riedel` | Defaulting to Riedel; ADAM gets a per-equipment flag once it's needed. |
| `wireless_bp` | `dante bp assign` | — |
| `hardwire_bp` | `dante bp assign` | Same registry entry. |
| `audio` | (skipped in v1) | Per Jimmy. |
| `mults` | (skipped in v1) | Per Jimmy. |
