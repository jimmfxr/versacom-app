# Nodal Zabbix Sync — sidecar service

Tiny FastAPI service that wraps `nodal_zabbix_core.py`. Nodal Control calls
it to push a project's equipment list into Zabbix and configure Webex
alerting, and to tear that setup down when a show ends.

Nodal cannot talk to Zabbix directly — it runs on Vercel (TypeScript /
Node.js), but the working Zabbix tooling is Python. This sidecar exists
so we don't reimplement that tooling from scratch.

## Endpoints

All endpoints (except `/healthz`) require `Authorization: Bearer <SIDECAR_SECRET>`.

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/healthz` | Liveness — no auth |
| `GET`  | `/proxies` | List Zabbix proxy names — populates the Nodal dropdown |
| `POST` | `/preview` | Build the CSV preview without touching Zabbix |
| `POST` | `/sync`    | Run Add/Update workflow — streams NDJSON progress |
| `POST` | `/remove`  | Tear down a show — streams NDJSON progress |

Streaming endpoints emit one `{"msg": "..."}` JSON object per line, with
the same wording as the underlying generators. Errors surface as a final
`{"error": "..."}` line.

## Environment variables

| Var | Required | Notes |
|---|---|---|
| `SIDECAR_SECRET` | ✅ | Long random string. Same value goes on the Nodal side. The service refuses to boot without it. |
| `ZABBIX_URL` | ✅ | e.g. `https://atk-zabbix.ddns.net/zabbix/` |
| `ZABBIX_USER` | ✅ | Zabbix login username |
| `ZABBIX_PASSWORD` | ✅ | Zabbix password |
| `WEBEX_BOT_TOKEN` | ✅ | Webex bot bearer token |
| `BOLERO_HUB_URL` | ✅ | `http://atk-zabbix.ddns.net:5005/inventory/antenna/{kit_number}` (core module refuses to boot without it) |

## Local dev

```bash
cd services/zabbix-sync
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export SIDECAR_SECRET=dev-secret-change-me
export ZABBIX_URL=...
export ZABBIX_USER=...
export ZABBIX_PASSWORD=...
export WEBEX_BOT_TOKEN=...
export BOLERO_HUB_URL=...
uvicorn main:app --reload --port 8080
```

Quick smoke test:

```bash
curl http://localhost:8080/healthz
curl -H "Authorization: Bearer dev-secret-change-me" http://localhost:8080/proxies
```

## Deploying

**Render (recommended for v1)**

1. Create a new Web Service pointing at this repo.
2. Set the root directory to `services/zabbix-sync`.
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add all env vars from the table above under "Environment".
6. Deploy. Note the public URL — that's what Nodal needs.

**Fly.io** works equally well; same Python + `requirements.txt` flow.

**Don't use Vercel Python functions** for this — the device-push
workflow regularly runs longer than 60s (Vercel's serverless timeout)
and the streaming response model is awkward there.

## What's next on the Nodal side

Once deployed, send back:

1. The sidecar's public URL (e.g. `https://nodal-zabbix.onrender.com`)
2. The `SIDECAR_SECRET` value

I'll wire Nodal to it: add `Project.zabbixProxy`, build the
"Sync to Zabbix" / "Remove from Zabbix" buttons on Project Details,
and auto-add admin emails to the Webex room when admins change.

## Files

| File | Why |
|---|---|
| `nodal_zabbix_core.py` | The original working module — do not edit, treat as a vendored library. |
| `main.py` | Thin HTTP wrapper. Endpoints, auth, NDJSON streaming. |
| `requirements.txt` | Pinned deps for reproducible deploys. |
