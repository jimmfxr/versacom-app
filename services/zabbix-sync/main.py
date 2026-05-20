"""
Nodal → Zabbix sync sidecar.

Tiny FastAPI wrapper around nodal_zabbix_core.py. Nodal calls this
service to push a project's equipment list into Zabbix, set up a Webex
alert space, and tear everything down when the show is over.

The core module's generators stream progress as plain strings. This
wrapper exposes each operation as an NDJSON streaming HTTP endpoint —
every yielded line becomes one JSON object on the wire, so the calling
app can render progress live.

Auth is a single shared bearer token (SIDECAR_SECRET env var). Set it on
this service AND on Nodal; requests without a matching token are 401'd.
Everything else (Zabbix creds, Webex bot, Bolero hub URL) is the same
set of env vars the core module already reads via its Config class.
"""

from __future__ import annotations

import json
import os
from typing import Generator, List, Optional

from fastapi import FastAPI, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from nodal_zabbix_core import (
    DataProcessor,
    WebexManager,
    ZabbixManager,
    run_add_update,
    run_remove,
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SIDECAR_SECRET = os.getenv("SIDECAR_SECRET", "")
if not SIDECAR_SECRET:
    # Refuse to boot without a secret — protects you from accidentally
    # exposing the Zabbix / Webex creds to the open internet.
    raise RuntimeError(
        "SIDECAR_SECRET env var must be set. Generate a long random string "
        "and put the same value on this service and on the Nodal side."
    )


app = FastAPI(title="Nodal Zabbix Sync", version="0.1.0")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class Device(BaseModel):
    """One device row, matching the DataProcessor schema."""
    device_name: str = Field(..., description="Location / position label")
    ip: str = Field(..., description="IPv4 or Dante .local hostname")
    model: Optional[str] = Field(None, description="UPS template override only")
    device_type: str = Field(..., description="Must match DEVICE_REGISTRY key")


class SyncRequest(BaseModel):
    show_name: str
    proxy_name: str
    devices: List[Device]
    emails: List[str] = Field(default_factory=list)
    do_devices: bool = True
    do_webex: bool = True


class RemoveRequest(BaseModel):
    show_name: str
    remove_devices: bool = True
    remove_webex: bool = True
    # Pass a substring to scope removal to one device category;
    # null = remove everything matching `{show_name} - `.
    group_filter: Optional[str] = None


class PreviewRequest(BaseModel):
    show_name: str
    proxy_name: str
    devices: List[Device]


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def _require_secret(authorization: Optional[str]) -> None:
    """Bearer-token check. Raises 401 on mismatch."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )
    token = authorization.removeprefix("Bearer ").strip()
    if token != SIDECAR_SECRET:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )


# ---------------------------------------------------------------------------
# Streaming helper
# ---------------------------------------------------------------------------
def _ndjson_stream(gen: Generator[str, None, None]) -> StreamingResponse:
    """
    Wrap a string generator as an NDJSON HTTP stream.

    Every yielded line becomes one JSON object on the wire:
        {"msg": "..."}\n

    The trailing newline keeps clients happy when parsing line-by-line.
    Exceptions surface as a final {"error": "..."} line so the caller
    doesn't have to guess whether the stream ended cleanly.
    """
    def iterator():
        try:
            for line in gen:
                yield json.dumps({"msg": line}) + "\n"
        except Exception as e:
            yield json.dumps({"error": str(e)}) + "\n"

    return StreamingResponse(iterator(), media_type="application/x-ndjson")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/healthz")
def healthz():
    """Liveness probe — no auth, no DB hit."""
    return {"ok": True}


@app.get("/proxies")
def proxies(authorization: Optional[str] = Header(None)):
    """List Zabbix proxy names. Drives the proxy dropdown on the Nodal side."""
    _require_secret(authorization)
    zm = ZabbixManager()
    zapi = zm.login()
    if not zapi:
        raise HTTPException(status_code=502, detail="Zabbix login failed")
    try:
        return {"proxies": zm.get_proxy_names(zapi)}
    finally:
        zm.logout(zapi)


@app.post("/preview")
def preview(body: PreviewRequest, authorization: Optional[str] = Header(None)):
    """
    Build the CSV preview without touching Zabbix.

    Returns the list of {Device Name, Group Name, Template} rows so the
    UI can show the user exactly what's about to be pushed.
    """
    _require_secret(authorization)
    dp = DataProcessor()
    csv_text = dp.build_csv(
        [d.model_dump() for d in body.devices],
        body.show_name,
        body.proxy_name,
    )
    return {"rows": dp.build_preview_table(csv_text)}


@app.post("/sync")
def sync(body: SyncRequest, authorization: Optional[str] = Header(None)):
    """
    Run the full Add/Update workflow. Streams progress as NDJSON.
    """
    _require_secret(authorization)
    gen = run_add_update(
        devices=[d.model_dump() for d in body.devices],
        show_name=body.show_name,
        proxy_name=body.proxy_name,
        email_list=body.emails,
        do_devices=body.do_devices,
        do_webex=body.do_webex,
    )
    return _ndjson_stream(gen)


@app.post("/remove")
def remove(body: RemoveRequest, authorization: Optional[str] = Header(None)):
    """
    Tear down devices, host groups, Webex space, and trigger actions
    for a show. Streams progress as NDJSON.
    """
    _require_secret(authorization)
    gen = run_remove(
        show_name=body.show_name,
        remove_devices=body.remove_devices,
        remove_webex=body.remove_webex,
        group_filter=body.group_filter,
    )
    return _ndjson_stream(gen)
