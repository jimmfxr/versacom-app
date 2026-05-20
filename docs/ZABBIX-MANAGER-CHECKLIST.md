# Zabbix integration — manager-side checklist

This is the work that has to happen on the **manager's** side to bring
the Nodal ↔ Zabbix integration online. The Nodal-side code is being
built in parallel; once the items below are done and we have the
artifacts at the bottom of this doc, the Nodal half can be wired up in
a single pass.

If you're the Claude reading this from the manager's environment: every
section is a self-contained task. Work top to bottom. Report blockers
back with the specific item number — don't guess past gaps.

---

## What we're building

A small Python service (the "sidecar") sits between Nodal Control (the
Next.js app on Vercel) and the Zabbix server. When an admin clicks
**Sync to Zabbix** on a project in Nodal, Nodal POSTs the project's
equipment list to the sidecar; the sidecar talks to Zabbix's JSON-RPC
API to create hosts, host groups, and the Webex notification wiring.

Source already in the Nodal repo under [services/zabbix-sync/](../services/zabbix-sync/):

- [main.py](../services/zabbix-sync/main.py) — FastAPI wrapper, bearer-token auth, NDJSON streaming
- [nodal_zabbix_core.py](../services/zabbix-sync/nodal_zabbix_core.py) — vendored from the manager's existing tool, unchanged
- [requirements.txt](../services/zabbix-sync/requirements.txt) — pinned deps
- [README.md](../services/zabbix-sync/README.md) — deploy + env-var reference

The sidecar runs the existing Python code that already works in the
Streamlit/Google Sheets tool. Nothing is being reimplemented.

---

## 1. Zabbix server prerequisites

Confirm each of the following exists on the Zabbix server. If any are
missing, create them — the sidecar's import workflow assumes they're
present and will yield template-not-found errors otherwise.

### 1.1 Templates that must exist

| Template name (exact) | Used by | Where it's referenced |
|---|---|---|
| `Simple Ping` | Bolero antennas, Riedel KP panels, ADAM KP panels, Wired BPs | nodal_zabbix_core.py DEVICE_REGISTRY |
| `Netgear M4250 SNMP NW` | Switches | DEVICE_REGISTRY |
| `UPS Liebert Vertiv GTX5` | Vertiv UPS units | DEVICE_REGISTRY → model_templates |
| `UPS Tower` | Tower-style UPS units | DEVICE_REGISTRY → model_templates |
| `Bolero Collector` | Per-kit Bolero collector host | Created automatically during sync |

Name match is exact and case-sensitive. If the templates exist under
different names, list the actual names — we can map them in a small
override patch on the Nodal side.

### 1.2 Media type that must exist

| Media type name | Required field | Purpose |
|---|---|---|
| `Webex-Bulk` | A `room_id` parameter | Cloned per show to wire Webex alerts. The sidecar clones this template, sets the `room_id` parameter to the Webex space ID it just created/found, and renames the clone to `Webex-<show name>`. |

If `Webex-Bulk` doesn't exist, create it as a Webex-flavored media type
with a `room_id` parameter and the standard alert message templates.

### 1.3 User group ID

The sidecar's trigger-action creation defaults to `usrgrpid = "7"` for
the notification recipient group (look for `"opmessage_grp": [{"usrgrpid": "7"}]`
in `nodal_zabbix_core.py`). Confirm group 7 is the right group to notify
on your Zabbix instance, or report back the correct group ID.

### 1.4 Zabbix admin account

The sidecar logs in as a Zabbix administrator. Provide:

- Zabbix frontend URL (e.g. `https://atk-zabbix.ddns.net/zabbix/`)
- Admin username
- Admin password

Use a dedicated service account if possible — don't reuse a human's
credentials.

### 1.5 Network reachability

The sidecar host (see §3) must be able to reach the Zabbix frontend
URL over HTTPS. If Zabbix is on a private network or behind VPN, either:

- Deploy the sidecar inside the same network (preferred), or
- Provide a VPN tunnel from the chosen sidecar host into the Zabbix LAN, or
- Stand up a reverse proxy exposing only the Zabbix API endpoint with
  an allowlist for the sidecar's IP.

Report which option you'll use.

---

## 2. Webex bot setup

The sidecar uses a Webex Bot to create alert spaces, add admins, and
send messages. Same bot that the Streamlit tool uses today — if you
already have one, reuse its token.

If you need a new one:

1. Go to https://developer.webex.com/my-apps → **Create a Bot**.
2. Name: `Nodal Alerts` (or similar).
3. Capture the **Bot Access Token** — that's the value of the
   `WEBEX_BOT_TOKEN` env var below.
4. The bot needs these scopes (they're the defaults for a Bot, but
   confirm): `spark:rooms_write`, `spark:memberships_write`,
   `spark:messages_write`.

The bot is auto-added to every room it creates. Project admin emails
get added as members when Nodal calls `/sync`.

---

## 3. Deploy the sidecar

Pick one host. Render's free tier is recommended for v1 — zero infra
to babysit and the build command is one line. Fly.io works too; just
swap the deploy steps.

**Don't use Vercel Python functions** — the sync workflow regularly
takes longer than Vercel's 60s function timeout when there are dozens
of hosts.

### 3.1 Render deploy steps

1. Connect the GitHub repo `jimmfxr/versacom-app` to Render.
2. New → Web Service → pick the repo.
3. Settings:
   - **Root directory**: `services/zabbix-sync`
   - **Build command**: `pip install -r requirements.txt`
   - **Start command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Runtime**: Python 3.11+
4. Environment variables (under "Environment"):

   | Variable | Value |
   |---|---|
   | `SIDECAR_SECRET` | A long random string. Generate with `openssl rand -hex 32`. Save it — Nodal needs the same value. |
   | `ZABBIX_URL` | From §1.4 |
   | `ZABBIX_USER` | From §1.4 |
   | `ZABBIX_PASSWORD` | From §1.4 |
   | `WEBEX_BOT_TOKEN` | From §2 |
   | `BOLERO_HUB_URL` | `http://atk-zabbix.ddns.net:5005/inventory/antenna/{kit_number}` (or the equivalent on this network — confirm the host is reachable from the sidecar) |

5. Deploy. Note the public URL (e.g. `https://nodal-zabbix.onrender.com`).

### 3.2 Smoke test

From your laptop:

```bash
# Liveness — should return {"ok": true}, no auth needed
curl https://YOUR-SIDECAR-URL/healthz

# Auth wall — should return 401 without the secret
curl https://YOUR-SIDECAR-URL/proxies

# Real call — should return {"proxies": [...]} with your Zabbix proxies
curl -H "Authorization: Bearer YOUR-SIDECAR-SECRET" \
     https://YOUR-SIDECAR-URL/proxies
```

If `/proxies` returns proxy names from Zabbix, the sidecar is wired
correctly and the integration is ready for the Nodal side to call it.

---

## 4. Equipment data mapping (FYI for the Nodal-side build)

Nodal's `Equipment.category` values don't 1:1 match the Python
DEVICE_REGISTRY keys. Mapping the Nodal side will use:

| Nodal `Equipment.category` | DEVICE_REGISTRY key | Notes |
|---|---|---|
| `switches` | `networking` | SNMP, port 161 |
| `antennas` | `antennas` | Bolero, ping, Bolero inventory POST |
| `panels` | `panels-riedel` | Defaulting to Riedel; ADAM panels will need a per-equipment flag once that comes up |
| `wireless_bp` | `dante bp assign` | — |
| `hardwire_bp` | `dante bp assign` | Same registry entry; agent ping |
| `audio` | (skipped) | Per Jimmy: out of scope for v1 |
| `mults` | (skipped) | Out of scope for v1 |

If any of these mappings are wrong, flag it in your response — easier
to fix before the Nodal UI ships than after.

---

## 5. Hand back to me

When you're done, reply with:

1. **Sidecar public URL** (e.g. `https://nodal-zabbix.onrender.com`)
2. **`SIDECAR_SECRET` value** — Nodal needs to set the same value as a
   Vercel env var
3. **The output of the `/proxies` smoke test** — confirms Zabbix login
   is working end-to-end
4. **Any items above where the answer was "doesn't exist yet" or
   "different name"** — so we can fix them before going live

Optional but useful:
- The exact name and ID of the Zabbix user group that should receive
  Webex notifications (if not group 7).
- The Webex bot's email address (so we can pre-populate it in any UI
  that lets users add bots manually later).

---

## 6. What happens after you reply

Nodal-side work (already scoped, won't start until your reply lands):

- Add `Project.zabbixProxy` field to the schema + migration.
- Build the **Sync to Zabbix** / **Remove from Zabbix** buttons on the
  Project Details page.
- Map `Equipment.category` to DEVICE_REGISTRY (per §4) and build the
  request payload.
- Stream the sidecar's NDJSON progress into a log panel in the UI.
- Auto-add admin emails (`User.email`) to the Webex space when an admin
  is added/removed from a project.

Estimated turnaround: ~1 working session after we have the URL +
secret + smoke-test confirmation.
