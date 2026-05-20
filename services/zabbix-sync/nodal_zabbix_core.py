"""
nodal_zabbix_core.py
====================
Framework-agnostic core for Zabbix and Webex integration.

Replaces the Google-Sheets-backed Streamlit tool with a clean,
modular library that any UI or automation layer can import.

Key design choices
------------------
- No Streamlit, no Google Sheets, no pandas required.
- All long-running operations are *generators* that yield plain strings
  so the calling UI can stream progress messages however it likes.
- Device types live in DEVICE_REGISTRY — add a new entry there to
  onboard a new device category; no other code changes needed.
- Credentials are read from environment variables or passed explicitly
  so this module never hard-codes secrets.

Internal CSV record format (what DataProcessor produces and
ZabbixManager.push_devices consumes):
    tab,hostname,ip,group_name,proxy_name,template_name,check_type,port

Usage example
-------------
    from nodal_zabbix_core import ZabbixManager, WebexManager, DataProcessor, DEVICE_REGISTRY

    # Build a device list however the UI collected it
    devices = [
        {
            "device_name": "FOH-SW-01",
            "ip": "10.50.1.1",
            "model": None,
            "device_type": "networking",
        },
        ...
    ]

    dp  = DataProcessor()
    zm  = ZabbixManager()
    wm  = WebexManager()

    show_name  = "SuperBowl LX"
    proxy_name = "ATK-Kit-1"

    csv_text = dp.build_csv(devices, show_name, proxy_name)

    zapi = zm.login()
    for msg in zm.push_devices(csv_text, zapi):
        print(msg)

    room_id = wm.get_or_create_room(f"{show_name} Alerts")["id"]
    wm.add_member(room_id, "engineer@company.com")

    for msg in zm.push_webex_notification(zapi, room_id, show_name):
        print(msg)

    zm.logout(zapi)
"""

from __future__ import annotations

import os
import re
import requests
from typing import Generator, Optional

# ---------------------------------------------------------------------------
# Optional dependency: pyzabbix
# ---------------------------------------------------------------------------
try:
    from pyzabbix import ZabbixAPI
except ImportError:
    ZabbixAPI = None  # type: ignore


# ===========================================================================
# DEVICE REGISTRY
# ===========================================================================
# Each key is a lower-case identifier for the device category.
# Adding a new device type only requires a new entry here.
#
# Fields
# ------
# name_prefix   : Short label prepended to the device name in Zabbix
#                 (e.g. "SW" → "SW FOH-Switch-01 - 10.50.1.1")
# name_abbrev   : Abbreviation used in the Zabbix host display name
# template      : Exact Zabbix template name that must exist on the server
# group_suffix  : Appended to the show name to form the Zabbix host group
#                 (e.g. "Switches" → "SuperBowl LX - Switches")
# check_type    : Interface type — "agent" | "snmp" | "ipmi" | "jmx"
# port          : Default monitoring port (int)
# model_templates: Optional dict mapping model string → template override
#
DEVICE_REGISTRY: dict[str, dict] = {
    "networking": {
        "name_prefix":    "SW",
        "name_abbrev":    "SW",
        "template":       "Netgear M4250 SNMP NW",
        "group_suffix":   "Switches",
        "check_type":     "snmp",
        "port":           161,
        "model_templates": {},
    },
    "antennas": {
        "name_prefix":    "ANT",
        "name_abbrev":    "BOL",
        "template":       "Simple Ping",
        "group_suffix":   "Bolero",
        "check_type":     "agent",
        "port":           80,
        "model_templates": {},
    },
    "panels-riedel": {
        "name_prefix":    "Riedel KP",
        "name_abbrev":    "PNL",
        "template":       "Simple Ping",
        "group_suffix":   "Riedel KP",
        "check_type":     "agent",
        "port":           10050,
        "model_templates": {},
    },
    "panels-adam": {
        "name_prefix":    "ADAM KP",
        "name_abbrev":    "PNL",
        "template":       "Simple Ping",
        "group_suffix":   "ADAM KP",
        "check_type":     "agent",
        "port":           10050,
        "model_templates": {},
    },
    "dante bp assign": {
        "name_prefix":    "WIRED BP",
        "name_abbrev":    "BP",
        "template":       "Simple Ping",
        "group_suffix":   "WIRED BP",
        "check_type":     "agent",
        "port":           10050,
        "model_templates": {},
    },
    "ups": {
        "name_prefix":    "UPS",
        "name_abbrev":    "UPS",
        "template":       "UPS Liebert Vertiv GTX5",
        "group_suffix":   "UPS",
        "check_type":     "snmp",
        "port":           161,
        "model_templates": {
            "Vertiv GTX5": "UPS Liebert Vertiv GTX5",
            "UPS Tower":   "UPS Tower",
        },
    },
}

# Zabbix interface type numbers
INTERFACE_TYPE_MAP: dict[str, int] = {
    "agent": 1,
    "snmp":  2,
    "ipmi":  3,
    "jmx":   4,
}

# Characters illegal in Zabbix host names
_ILLEGAL_CHARS = ['/', '+', '&', '(', ')', '#', "'", ',', '[', ']', ':', '>', '<']


# ===========================================================================
# CONFIGURATION
# ===========================================================================
class Config:
    """
    Central place for runtime credentials and endpoints.

    Values are read from environment variables at import time so nothing
    is ever hard-coded. Override by setting these env vars before launch,
    or subclass / monkey-patch Config for testing.
    """
    # Zabbix
    ZABBIX_URL:      str = os.getenv("ZABBIX_URL",      "https://atk-zabbix.ddns.net/zabbix/")
    ZABBIX_USER:     str = os.getenv("ZABBIX_USER",     "administrator")
    ZABBIX_PASSWORD: str = os.getenv("ZABBIX_PASSWORD", "")

    # Webex
    WEBEX_BOT_TOKEN: str = os.getenv("WEBEX_BOT_TOKEN", "")
    WEBEX_API_BASE:  str = "https://webexapis.com/v1"

    # Bolero inventory service — required for antenna monitoring
    BOLERO_HUB_URL:  str = os.getenv("BOLERO_HUB_URL",  "http://atk-zabbix.ddns.net:5005/inventory/antenna/{kit_number}")


# ===========================================================================
# DATA PROCESSOR
# ===========================================================================
class DataProcessor:
    """
    Converts a list of raw device dicts (as collected by the UI) into
    the CSV string that ZabbixManager.push_devices() consumes.

    Device dict schema (all keys expected from the UI layer)
    --------------------------------------------------------
    {
        "device_name": str,   # Location / position label from the data source
        "ip":          str,   # IPv4 address OR Dante .local hostname
        "model":       str | None,  # Used only for UPS template selection
        "device_type": str,   # Must match a key in DEVICE_REGISTRY (case-insensitive)
    }
    """

    # -------------------------------------------------------------------
    # Public API
    # -------------------------------------------------------------------
    def build_csv(
        self,
        devices:    list[dict],
        show_name:  str,
        proxy_name: str,
    ) -> str:
        """
        Turn a list of device dicts into the internal CSV string.

        Returns a multi-line string; each line is:
            tab,hostname,ip,group_name,proxy_name,template_name,check_type,port
        """
        lines: list[str] = []
        for dev in devices:
            line = self._device_to_csv_line(dev, show_name, proxy_name)
            if line:
                lines.append(line)
        return "\n".join(lines)

    def build_preview_table(self, csv_text: str) -> list[dict]:
        """
        Parse the CSV string back into a list of dicts for UI preview.

        Returns list of {"Device Name", "Group Name", "Template"} dicts.
        """
        rows = []
        for line in csv_text.strip().splitlines():
            parts = line.split(",")
            if len(parts) != 8:
                continue
            _tab, hostname, _ip, group_name, _proxy, template, _ct, _port = parts
            rows.append({
                "Device Name": hostname,
                "Group Name":  group_name,
                "Template":    template,
            })
        return rows

    # -------------------------------------------------------------------
    # Internal helpers
    # -------------------------------------------------------------------
    def _sanitize_name(self, name: str) -> str:
        """Remove or replace characters illegal in Zabbix host names."""
        for char in _ILLEGAL_CHARS:
            if char in ("'", ","):
                name = name.replace(char, "")
            else:
                name = name.replace(char, "-")
        return name.strip()

    def _resolve_device_config(self, device_type: str, model: Optional[str]) -> Optional[dict]:
        """Look up DEVICE_REGISTRY by device_type (case-insensitive partial match)."""
        key = device_type.lower()
        # Exact match first
        if key in DEVICE_REGISTRY:
            cfg = dict(DEVICE_REGISTRY[key])
            # Apply model-specific template override if present
            if model and model in cfg.get("model_templates", {}):
                cfg["template"] = cfg["model_templates"][model]
            return cfg
        # Partial match fallback
        for reg_key, reg_cfg in DEVICE_REGISTRY.items():
            if reg_key in key or key in reg_key:
                cfg = dict(reg_cfg)
                if model and model in cfg.get("model_templates", {}):
                    cfg["template"] = cfg["model_templates"][model]
                return cfg
        return None

    def _device_to_csv_line(
        self,
        dev:        dict,
        show_name:  str,
        proxy_name: str,
    ) -> Optional[str]:
        """Convert one device dict to a CSV line; return None if device_type unknown."""
        device_type = dev.get("device_type", "")
        cfg = self._resolve_device_config(device_type, dev.get("model"))
        if not cfg:
            return None

        raw_name  = self._sanitize_name(str(dev.get("device_name", "")))
        ip_raw    = str(dev.get("ip", "")).strip()
        abbrev    = cfg["name_abbrev"]
        template  = cfg["template"]
        group     = f"{show_name} - {cfg['group_suffix']}"
        ct        = cfg["check_type"]
        port      = str(cfg["port"])
        tab       = device_type.lower()

        hostname  = f"{abbrev} {raw_name} - {ip_raw}"

        return f"{tab},{hostname},{ip_raw},{group},{proxy_name},{template},{ct},{port}"


# ===========================================================================
# ZABBIX MANAGER
# ===========================================================================
class ZabbixManager:
    """
    All Zabbix API operations.  Methods that stream progress are generators.
    """

    def __init__(self, config: Config = None):
        self.cfg = config or Config()
        if ZabbixAPI is None:
            raise ImportError("pyzabbix is required: pip install pyzabbix")
        if not self.cfg.BOLERO_HUB_URL:
            raise EnvironmentError(
                "BOLERO_HUB_URL is required for antenna monitoring. "
                "Set it via the BOLERO_HUB_URL environment variable."
            )

    # -------------------------------------------------------------------
    # Session management
    # -------------------------------------------------------------------
    def login(self) -> Optional[object]:
        """
        Authenticate to Zabbix.  Returns a ZabbixAPI session object or None.
        Call logout() when done to invalidate the token server-side.
        """
        zapi = ZabbixAPI(self.cfg.ZABBIX_URL)
        try:
            zapi.login(user=self.cfg.ZABBIX_USER, password=self.cfg.ZABBIX_PASSWORD)
            return zapi
        except Exception as e:
            print(f"[ZabbixManager] Login failed: {e}")
            return None

    def logout(self, zapi) -> None:
        """Safely invalidate a Zabbix API session."""
        if zapi:
            try:
                zapi.user.logout()
            except Exception as e:
                print(f"[ZabbixManager] Logout warning: {e}")

    def is_session_alive(self, zapi) -> bool:
        """Ping the API to check whether the token is still valid."""
        try:
            zapi.apiinfo.version()
            return True
        except Exception:
            return False

    # -------------------------------------------------------------------
    # Proxy helpers
    # -------------------------------------------------------------------
    def get_all_proxies(self, zapi) -> list[dict]:
        """
        Return a list of proxy dicts: [{"proxyid": "...", "name": "..."}, ...]
        Returns empty list on failure.
        """
        try:
            return zapi.proxy.get(output=["proxyid", "name"])
        except Exception as e:
            print(f"[ZabbixManager] get_all_proxies failed: {e}")
            return []

    def get_proxy_names(self, zapi) -> list[str]:
        """Convenience: return a flat list of proxy name strings."""
        return [p["name"] for p in self.get_all_proxies(zapi)]

    def _get_proxyid_by_name(self, zapi, proxy_name: str) -> Optional[str]:
        if not proxy_name:
            return None
        for proxy in self.get_all_proxies(zapi):
            if proxy.get("name") == proxy_name:
                return proxy["proxyid"]
        return None

    # -------------------------------------------------------------------
    # Group / Template helpers
    # -------------------------------------------------------------------
    def _get_or_create_group(self, zapi, group_name: str) -> Optional[str]:
        """Return groupid for group_name, creating it if it doesn't exist."""
        try:
            groups = zapi.hostgroup.get(filter={"name": group_name})
            if groups:
                return groups[0]["groupid"]
            new_group = zapi.hostgroup.create(name=group_name)
            return new_group["groupids"][0]
        except Exception as e:
            print(f"[ZabbixManager] Group lookup/create failed for '{group_name}': {e}")
            return None

    def _get_templateid_by_name(self, zapi, template_name: str) -> Optional[str]:
        try:
            templates = zapi.template.get(filter={"host": template_name})
            if templates:
                return templates[0]["templateid"]
            print(f"[ZabbixManager] Template '{template_name}' not found.")
            return None
        except Exception as e:
            print(f"[ZabbixManager] Template lookup failed: {e}")
            return None

    def _get_usergroup_id_by_name(self, zapi, name: str) -> Optional[str]:
        try:
            groups = zapi.usergroup.get(filter={"name": name}, output=["usrgrpid"])
            return groups[0]["usrgrpid"] if groups else None
        except Exception:
            return None

    # -------------------------------------------------------------------
    # Bolero-specific: POST antenna IP to inventory hub
    # -------------------------------------------------------------------
    def _push_bolero_inventory(self, kit_number: str, ip_address: str) -> Generator[str, None, None]:
        hub_url = self.cfg.BOLERO_HUB_URL.format(kit_number=kit_number)
        payload = {"kit_id": str(kit_number), "antenna_ip": ip_address}
        try:
            response = requests.post(hub_url, json=payload, timeout=5)
            if response.status_code == 200:
                yield f"✅ Kit {kit_number} updated to {ip_address}"
            else:
                yield f"❌ Failed Bolero POST: {response.json().get('error')}"
        except Exception as e:
            yield f"⚠️ Bolero Connection Error: {e}"

    # -------------------------------------------------------------------
    # Primary: push devices from CSV
    # -------------------------------------------------------------------
    def push_devices(self, csv_text: str, zapi) -> Generator[str, None, None]:
        """
        Import / sync devices from the internal CSV string.

        CSV line format:
            tab,hostname,ip,group_name,proxy_name,template_name,check_type,port

        Yields human-readable status messages suitable for any UI.
        Creates hosts that don't exist, updates those that do, and removes
        hosts that were in the same Zabbix group but are no longer in the data.
        """
        if not zapi:
            yield "ERROR: No Zabbix session provided."
            return

        successful  = updated = deleted = failed = 0
        seen_ids:   set[str] = set()
        active_gid: Optional[str] = None

        # ── Step 1: Bulk-fetch all existing hosts ──────────────────────
        all_hosts: list[dict] = []
        limit, offset = 5000, 0
        yield "*Fetching existing hosts from Zabbix...*"
        while True:
            try:
                batch = zapi.host.get(
                    output=["hostid", "host", "proxyid", "monitored_by"],
                    selectGroups=["groupid"],
                    selectParentTemplates=["templateid"],
                    selectInterfaces=["interfaceid", "ip", "dns", "useip", "type", "main"],
                    limit=limit, offset=offset,
                    sortfield="hostid", sortorder="ASC",
                )
                if not batch:
                    break
                all_hosts.extend(batch)
                if len(batch) < limit:
                    break
                offset += limit
            except Exception as e:
                yield f"ERROR fetching hosts: {e}"
                break

        hosts_by_name: dict[str, dict] = {h["host"]: h for h in all_hosts}
        hosts_by_ip:   dict[str, dict] = {}
        hosts_by_dns:  dict[str, dict] = {}
        for h in all_hosts:
            for iface in h.get("interfaces", []):
                if iface.get("main") == "1":
                    if iface.get("ip"):
                        hosts_by_ip[iface["ip"]] = h
                    if iface.get("dns"):
                        hosts_by_dns[iface["dns"]] = h

        yield f"*Sync ready. {len(all_hosts)} hosts cached.*"
        yield "---"

        have_pushed_bolero = False

        # ── Step 2: Process each CSV line ─────────────────────────────
        for line in csv_text.strip().splitlines():
            line = line.strip()
            if not line:
                continue

            parts = line.split(",")
            if len(parts) != 8:
                yield f"Skipped malformed line: {line}"
                continue

            tab, hostname, ip_val, group_name, proxy_name, template_name, iface_type_str, port = parts
            hostname = hostname.replace("/", "-").strip()
            ip_val   = ip_val.strip()

            # Determine whether to use IP or DNS
            if ".local" in ip_val:
                dns_name   = ip_val
                ip_addr    = ""
                use_ip_tog = 0
            else:
                ip_addr    = ip_val
                dns_name   = ""
                use_ip_tog = 1

            iface_type_num = INTERFACE_TYPE_MAP.get(iface_type_str.lower(), 1)

            # ── Resolve IDs ──────────────────────────────────────────
            target_gid      = self._get_or_create_group(zapi, group_name)
            target_tpl_id   = self._get_templateid_by_name(zapi, template_name)
            target_proxy_id = self._get_proxyid_by_name(zapi, proxy_name)
            proxy_api_val   = str(target_proxy_id) if target_proxy_id else "0"

            active_gid = str(target_gid)

            iface_dict: dict = {
                "type":   iface_type_num,
                "main":   "1",
                "useip":  use_ip_tog,
                "ip":     ip_addr,
                "dns":    dns_name,
                "port":   port,
            }
            if iface_type_num == INTERFACE_TYPE_MAP["snmp"]:
                iface_dict["details"] = {"version": "2", "community": "CGRO", "bulk": "1"}

            # ── Bolero collector setup (once per group) ───────────────
            if not have_pushed_bolero and "Bolero" in group_name:
                digits_str = "".join(c for c in proxy_name if c.isdigit())
                yield from self._push_bolero_inventory(digits_str, ip_val)

                collector_host     = f"Bolero-Kit{digits_str}"
                collector_tpl_id   = self._get_templateid_by_name(zapi, "Bolero Collector")
                existing_collector = zapi.host.get(filter={"host": collector_host})

                collector_params = {
                    "host":       collector_host,
                    "interfaces": [{"type": 1, "main": 1, "useip": 1, "ip": "127.0.0.1", "dns": "", "port": "10050"}],
                    "groups":     [{"groupid": str(target_gid)}],
                    "templates":  [{"templateid": str(collector_tpl_id)}],
                }

                if not existing_collector:
                    res = zapi.host.create(**collector_params)
                    seen_ids.add(str(res["hostids"][0]))
                    yield f"    *Created Collector Host: **{collector_host}***"
                else:
                    h_id = existing_collector[0]["hostid"]
                    zapi.host.update(
                        hostid=h_id,
                        groups=collector_params["groups"],
                        templates=collector_params["templates"],
                    )
                    seen_ids.add(str(h_id))
                    yield f"    *Synced Collector Host: **{collector_host}***"
                    have_pushed_bolero = True

            common_params = {
                "host":       hostname,
                "interfaces": [iface_dict],
                "groups":     [{"groupid": str(target_gid)}],
                "templates":  [{"templateid": str(target_tpl_id)}],
            }

            # ── Lookup existing host ─────────────────────────────────
            existing = (
                hosts_by_name.get(hostname)
                or (hosts_by_ip.get(ip_addr)   if ip_addr  else None)
                or (hosts_by_dns.get(dns_name) if dns_name else None)
            )

            if existing:
                host_id   = existing["hostid"]
                seen_ids.add(str(host_id))
                update_p  = {"hostid": host_id}
                needs_upd = False

                # Name
                if existing["host"] != hostname:
                    update_p["host"]  = hostname
                    update_p["name"]  = hostname
                    needs_upd = True
                    yield f"    *Renaming: **{existing['host']}** → **{hostname}***"

                # Group
                cur_groups = {str(g["groupid"]) for g in existing.get("groups", [])}
                if str(target_gid) not in cur_groups:
                    update_p["groups"] = common_params["groups"]
                    needs_upd = True
                    yield f"    *Moving to group → **{group_name}***"

                # Proxy
                if proxy_api_val != str(existing.get("proxyid", "0")):
                    update_p["proxyid"]      = proxy_api_val
                    update_p["monitored_by"] = "1" if proxy_api_val != "0" else "0"
                    needs_upd = True
                    yield f"    *Updating proxy → **{proxy_name}***"

                # Interface
                c_ip = c_dns = c_useip = ""
                e_iface_id = None
                for iface in existing.get("interfaces", []):
                    if iface.get("main") == "1":
                        c_ip        = iface.get("ip", "")
                        c_dns       = iface.get("dns", "")
                        c_useip     = str(iface.get("useip"))
                        e_iface_id  = iface.get("interfaceid")
                        break

                if ip_addr != c_ip or dns_name != c_dns or str(use_ip_tog) != c_useip:
                    new_iface = iface_dict.copy()
                    if e_iface_id:
                        new_iface["interfaceid"] = e_iface_id
                    update_p["interfaces"] = [new_iface]
                    needs_upd = True
                    yield f"    *Updating {'IP' if use_ip_tog else 'DNS'}: **{c_ip or c_dns}** → **{ip_addr or dns_name}***"

                # Template
                cur_tpls = {str(t["templateid"]) for t in existing.get("parentTemplates", [])}
                if str(target_tpl_id) not in cur_tpls:
                    update_p["templates"] = common_params["templates"]
                    needs_upd = True
                    yield f"    *Updating template → **{template_name}***"

                if needs_upd:
                    try:
                        zapi.host.update(**update_p)
                        updated += 1
                        yield f"Updated: **{hostname}**"
                        yield "---"
                    except Exception as e:
                        failed += 1
                        yield f"Update Error **{hostname}**: {e}"
                        yield "---"

            else:
                # Create
                try:
                    if proxy_api_val != "0":
                        common_params["proxyid"]      = proxy_api_val
                        common_params["monitored_by"] = "1"
                    res = zapi.host.create(**common_params)
                    seen_ids.add(str(res["hostids"][0]))
                    successful += 1
                    yield f"Added: **{hostname}**"
                    yield "---"
                except Exception as e:
                    failed += 1
                    yield f"Create Error **{hostname}**: {e}"
                    yield "---"

        # ── Step 3: Remove stale hosts from the active group ─────────
        if active_gid:
            for h in all_hosts:
                h_groups = {str(g["groupid"]) for g in h.get("groups", [])}
                if active_gid in h_groups and str(h["hostid"]) not in seen_ids:
                    try:
                        zapi.host.delete(h["hostid"])
                        deleted += 1
                        yield f"Removed: **{h['host']}** (no longer in data)"
                        yield "---"
                    except Exception as e:
                        yield f"Delete Error **{h['host']}**: {e}"
                        yield "---"

        yield f"Added: {successful} | Updated: {updated} | Removed: {deleted}" + (
            f" | Errors: {failed}" if failed else ""
        )
        yield "*Import complete.*"

    # -------------------------------------------------------------------
    # Delete operations
    # -------------------------------------------------------------------
    def delete_hosts_in_groups(self, zapi, search_term: str) -> Generator[str, None, None]:
        """Delete all hosts that belong to groups whose name contains search_term."""
        search_pattern = f"{search_term}*"
        yield f"Searching host groups matching '{search_term}'..."
        try:
            groups = zapi.hostgroup.get(
                output=["groupid"],
                search={"name": search_pattern},
                searchWildcardsEnabled=True,
            )
            if not groups:
                yield f"No host groups found matching '{search_term}'."
                return

            gids   = [g["groupid"] for g in groups]
            hosts  = zapi.host.get(output=["hostid", "name"], groupids=gids)
            if not hosts:
                yield "No hosts found in matching groups."
                return

            host_ids = [h["hostid"] for h in hosts]
            yield f"Found {len(host_ids)} hosts to delete."

            response = zapi.do_request("host.delete", params=host_ids)
            if "hostids" in response["result"]:
                yield "Successfully deleted all hosts."
            else:
                yield f"Delete failed: {response}"
        except Exception as e:
            yield f"Error during host deletion: {e}"

    def delete_host_groups(self, zapi, search_term: str) -> Generator[str, None, None]:
        """Delete host groups whose name contains search_term (removes group conditions from actions first)."""
        yield f"Searching host groups matching '{search_term}'..."
        try:
            groups = zapi.hostgroup.get(
                output=["groupid", "name"],
                search={"name": f"{search_term}*"},
                searchWildcardsEnabled=True,
            )
            if not groups:
                yield f"No host groups found matching '{search_term}'."
                return

            for grp in groups:
                gid, gname = grp["groupid"], grp["name"]
                yield f"Processing cleanup for: {gname}..."
                try:
                    self._remove_group_from_actions(zapi, gid)
                except Exception as e:
                    yield f"  Warning — could not update actions for {gname}: {e}"

                response = zapi.do_request("hostgroup.delete", params=[gid])
                if "groupids" in response["result"]:
                    yield f"  Deleted host group: {gname}"
                else:
                    yield f"  Failed to delete {gname}: {response}"
        except Exception as e:
            yield f"Error: {e}"

    def _remove_group_from_actions(self, zapi, group_id: str) -> None:
        """Remove a specific host-group condition from any trigger actions that reference it."""
        actions = zapi.action.get(
            output=["actionid", "name"],
            selectFilter=["conditions", "evaltype"],
            filter={"eventsource": 0},
        )
        for action in actions:
            orig_conds = action["filter"]["conditions"]
            new_conds  = [
                {k: c[k] for k in ["conditiontype", "operator", "value"] if k in c}
                for c in orig_conds
                if not (c["conditiontype"] == "0" and c["value"] == str(group_id))
            ]
            if len(new_conds) < len(orig_conds):
                if not new_conds:
                    zapi.do_request("action.delete", params=[str(action["actionid"])])
                else:
                    zapi.action.update({
                        "actionid": action["actionid"],
                        "filter": {"evaltype": action["filter"]["evaltype"], "conditions": new_conds},
                    })

    def delete_trigger_actions(self, zapi, search_term: str) -> Generator[str, None, None]:
        """Delete trigger actions whose name contains search_term."""
        yield f"Searching trigger actions matching '{search_term}'..."
        try:
            actions = zapi.action.get(
                output=["actionid", "name"],
                search={"name": search_term},
                filter={"eventsource": 0},
            )
            if not actions:
                yield "No matching trigger actions found."
                return

            ids   = [a["actionid"] for a in actions]
            names = [a["name"]     for a in actions]
            for n in names:
                yield f"  - {n}"

            response = zapi.do_request("action.delete", params=ids)
            if "actionids" in response["result"]:
                yield "Successfully deleted trigger actions."
            else:
                yield f"Delete failed: {response}"
        except Exception as e:
            yield f"Error: {e}"

    def delete_media_types(self, zapi, search_term: str) -> Generator[str, None, None]:
        """Delete media types whose name contains search_term."""
        yield f"Searching media types matching '{search_term}'..."
        try:
            media_types = zapi.mediatype.get(
                output=["mediatypeid", "name"],
                search={"name": search_term},
            )
            if not media_types:
                yield "No matching media types found."
                return

            ids = [mt["mediatypeid"] for mt in media_types]
            for mt in media_types:
                yield f"  - {mt['name']}"

            response = zapi.do_request("mediatype.delete", params=ids)
            if "mediatypeids" in response["result"]:
                yield "Successfully deleted media types."
            else:
                yield f"Delete failed: {response}"
        except Exception as e:
            yield f"Error: {e}"

    def delete_media_from_user(self, zapi, username: str, show_name_short: str) -> bool:
        """Remove the Webex media entry for show_name_short from a user's profile."""
        search_term = f"Webex-{show_name_short}"
        try:
            media_types = zapi.mediatype.get(
                search={"name": search_term},
                output=["mediatypeid"],
            )
            if not media_types:
                return False
            mediatype_id = media_types[0]["mediatypeid"]

            user_info = zapi.user.get(
                filter={"alias": username},
                output=["userid"],
                selectMedias="extend",
            )
            if not user_info:
                return False

            user_id        = user_info[0]["userid"]
            current_medias = user_info[0].get("medias", [])
            updated_medias = [m for m in current_medias if m.get("mediatypeid") != mediatype_id]

            if len(updated_medias) == len(current_medias):
                return False  # Nothing removed

            zapi.user.update(userid=user_id, medias=updated_medias)
            return True
        except Exception as e:
            print(f"[ZabbixManager] delete_media_from_user error: {e}")
            return False

    # -------------------------------------------------------------------
    # Webex notification setup in Zabbix
    # -------------------------------------------------------------------
    def push_webex_notification(
        self,
        zapi,
        room_id:    str,
        show_name:  str,
    ) -> Generator[str, None, None]:
        """
        Set up (or update) Zabbix media type + trigger action for a Webex space.
        Searches for all host groups that contain show_name and wires them
        to a single trigger action.
        """
        if not zapi:
            yield "ERROR: No Zabbix session."
            return

        # Gather all host groups for this show
        try:
            groups = zapi.hostgroup.get(
                output=["groupid", "name"],
                search={"name": show_name},
                searchByAny=True,
                sortfield="name",
            )
            group_names = [g["name"] for g in groups]
        except Exception as e:
            yield f"ERROR fetching host groups: {e}"
            return

        yield from self._setup_webex_notification(zapi, room_id, group_names, show_name)

    def _setup_webex_notification(
        self,
        zapi,
        room_id:     str,
        group_names: list[str],
        show_name:   str,
    ) -> Generator[str, None, None]:
        yield f"Setting up Webex notification for: {show_name}"

        # 1. Create or retrieve media type
        media_type_name = f"Webex-{show_name}"
        try:
            mediatype_id = self._create_or_get_webex_mediatype(zapi, media_type_name, room_id)
            if not mediatype_id:
                yield "Failed to create or retrieve media type."
                return
            result = self._add_mediatype_to_user(zapi, "administrator", mediatype_id, room_id)
            yield result
        except Exception as e:
            yield f"Media type error: {e}"
            return

        # 2. Build group conditions
        new_conditions = []
        for gname in group_names:
            gid = self._get_or_create_group(zapi, gname)
            if gid:
                new_conditions.append({
                    "conditiontype": "0",
                    "operator":      "0",
                    "value":         str(gid),
                })
            else:
                yield f"Host group '{gname}' not found — skipping."

        if not new_conditions:
            yield "No valid host groups found. Notification setup aborted."
            return

        # 3. Create or update trigger action
        action_name = f"Webex Notification to {show_name}"
        try:
            existing = zapi.action.get(filter={"name": action_name}, output=["actionid"])
            if existing:
                action_id = existing[0]["actionid"]
                zapi.action.update({
                    "actionid": action_id,
                    "filter": {"evaltype": 2, "conditions": new_conditions},
                })
                yield f"Action '{action_name}' updated."
            else:
                params = {
                    "name":       action_name,
                    "eventsource": 0,
                    "status":     0,
                    "esc_period": "1h",
                    "filter": {"evaltype": 2, "conditions": new_conditions},
                    "operations": [{
                        "operationtype": 0,
                        "opmessage_grp": [{"usrgrpid": "7"}],
                        "opmessage": {"mediatypeid": str(mediatype_id), "default_msg": 1},
                    }],
                    "recovery_operations": [{
                        "operationtype": 0,
                        "opmessage": {"mediatypeid": str(mediatype_id), "default_msg": 1},
                        "opmessage_grp": [{"usrgrpid": "7"}],
                    }],
                }
                result = zapi.do_request("action.create", params=params)
                if "actionids" in result["result"]:
                    yield f"Action '{action_name}' created (ID: {result['result']['actionids'][0]})."
                else:
                    yield f"Failed to create action: {result}"
        except Exception as e:
            yield f"Action error: {e}"

    def _create_or_get_webex_mediatype(self, zapi, new_name: str, room_id: str) -> Optional[str]:
        """Clone the 'Webex-Bulk' media type with a new name and the target room_id."""
        try:
            existing = zapi.mediatype.get(filter={"name": new_name})
            if existing:
                return existing[0]["mediatypeid"]

            originals = zapi.mediatype.get(
                filter={"name": "Webex-Bulk"},
                output="extend",
                selectMessageTemplates="extend",
            )
            if not originals:
                print("[ZabbixManager] 'Webex-Bulk' media type not found.")
                return None

            template_mt = dict(originals[0])
            template_mt.pop("mediatypeid", None)
            template_mt.pop("content_type", None)
            template_mt["name"]   = new_name
            template_mt["status"] = 0

            for t in template_mt.get("message_templates", []):
                t.pop("message_templateid", None)

            for param in template_mt.get("parameters", []):
                if param["name"] == "room_id":
                    param["value"] = room_id

            result = zapi.mediatype.create(template_mt)
            return result["mediatypeids"][0]
        except Exception as e:
            print(f"[ZabbixManager] _create_or_get_webex_mediatype error: {e}")
            return None

    def _add_mediatype_to_user(
        self,
        zapi,
        username:     str,
        mediatype_id: str,
        room_id:      str,
    ) -> str:
        """Add a media entry for mediatype_id to username's profile (no-op if duplicate)."""
        try:
            user_info = zapi.user.get(
                filter={"alias": username},
                output=["userid"],
                selectMedias=["mediaid", "mediatypeid", "sendto", "active", "severity", "period"],
            )
            if not user_info:
                return f"User '{username}' not found."

            user_id      = user_info[0]["userid"]
            raw_medias   = user_info[0].get("medias", [])

            # Duplicate check
            for m in raw_medias:
                if str(m["mediatypeid"]) == str(mediatype_id) and str(m["sendto"]) == str(room_id):
                    return f"Media for mediatype {mediatype_id} already present for '{username}'."

            filtered = [
                {k: m[k] for k in ["mediaid", "mediatypeid", "sendto", "active", "severity", "period"]}
                for m in raw_medias
            ]
            filtered.append({
                "mediatypeid": mediatype_id,
                "sendto":      room_id,
                "active":      0,
                "severity":    63,
                "period":      "1-7,00:00-24:00",
            })
            zapi.user.update(userid=user_id, medias=filtered)
            return f"Successfully added media to user '{username}'."
        except Exception as e:
            return f"Error adding media to '{username}': {e}"


# ===========================================================================
# WEBEX MANAGER
# ===========================================================================
class WebexManager:
    """
    All Webex Bot API operations.
    Uses the bot token from Config (WEBEX_BOT_TOKEN env var).
    """

    def __init__(self, config: Config = None):
        self.cfg     = config or Config()
        self._base   = self.cfg.WEBEX_API_BASE
        self._token  = self.cfg.WEBEX_BOT_TOKEN

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type":  "application/json",
        }

    def _call(
        self,
        url:       str,
        method:    str,
        data:      Optional[dict] = None,
        params:    Optional[dict] = None,
    ) -> dict:
        """
        Unified HTTP call.  Returns a dict; never raises — errors come back
        as {"status": "error", "status_code": ..., "message": ...}.
        """
        try:
            if method == "GET":
                r = requests.get(url,  headers=self._headers(), params=params, timeout=10)
            elif method == "POST":
                r = requests.post(url, headers=self._headers(), json=data,   timeout=10)
            elif method == "DELETE":
                r = requests.delete(url, headers=self._headers(), timeout=10)
            else:
                return {"status": "error", "message": f"Unsupported method: {method}"}

            r.raise_for_status()

            if r.status_code in (201, 204):
                return {
                    "status": "success",
                    "status_code": r.status_code,
                    "message": "OK",
                    "data": r.json() if r.text else {},
                }
            return r.json()

        except requests.exceptions.RequestException as e:
            err_msg = str(e)
            if e.response is not None and e.response.text:
                try:
                    err_msg = e.response.json().get("message", err_msg)
                except Exception:
                    pass
            return {
                "status":      "error",
                "status_code": e.response.status_code if e.response else 500,
                "message":     err_msg,
            }

    # -------------------------------------------------------------------
    # Room / Space management
    # -------------------------------------------------------------------
    def get_or_create_room(self, space_name: str) -> dict:
        """
        Return the room dict for space_name, creating it if it doesn't exist.
        The returned dict includes the Webex room 'id' key plus
        'does_exist': True if the room was found rather than created.
        """
        rooms_url = f"{self._base}/rooms"
        existing  = self._call(rooms_url, "GET")

        if existing and "items" in existing:
            for room in existing["items"]:
                if room["title"] == space_name:
                    room["does_exist"] = True
                    return room

        new_room = self._call(rooms_url, "POST", data={"title": space_name})
        new_room["does_exist"] = False
        return new_room

    def get_room_id_by_name(self, space_name: str) -> Optional[str]:
        """Return the room ID for an exact title match, or None."""
        result = self._call(f"{self._base}/rooms", "GET", params={"title": space_name})
        if result and "items" in result:
            for room in result["items"]:
                if room["title"] == space_name:
                    return room["id"]
        return None

    def add_member(self, room_id: str, user_email: str) -> dict:
        """Add user_email to the room.  Returns the Webex API response dict."""
        return self._call(
            f"{self._base}/memberships",
            "POST",
            data={"roomId": room_id, "personEmail": user_email},
        )

    def delete_room(self, room_id: str) -> Generator[str, None, None]:
        """Delete a Webex room by ID."""
        yield f"Deleting Webex room {room_id}..."
        result = self._call(f"{self._base}/rooms/{room_id}", "DELETE")
        if result.get("status") == "success":
            yield "Room deleted."
        else:
            yield f"Delete result: {result}"

    def send_message(self, room_id: str, markdown_text: str) -> dict:
        """Send a markdown message to a room."""
        return self._call(
            f"{self._base}/messages",
            "POST",
            data={"roomId": room_id, "markdown": markdown_text},
        )

    def list_rooms(self) -> list[dict]:
        """Return all group rooms the bot is a member of."""
        result = self._call(f"{self._base}/rooms", "GET", params={"type": "group"})
        return result.get("items", [])

    def get_room_members(self, room_id: str) -> list[str]:
        """Return display names of members in room_id."""
        result = self._call(f"{self._base}/memberships", "GET", params={"roomId": room_id})
        return [m["personDisplayName"] for m in result.get("items", [])]


# ===========================================================================
# CONVENIENCE: Full workflow helpers
# ===========================================================================
def run_add_update(
    devices:    list[dict],
    show_name:  str,
    proxy_name: str,
    email_list: list[str],
    do_devices: bool = True,
    do_webex:   bool = True,
) -> Generator[str, None, None]:
    """
    High-level generator that handles a complete Add/Update workflow.

    Parameters
    ----------
    devices     : List of device dicts (see DataProcessor for schema)
    show_name   : Display name for the show / event
    proxy_name  : Zabbix proxy to assign hosts to
    email_list  : Emails to add to the Webex alerts space
    do_devices  : Whether to push devices to Zabbix
    do_webex    : Whether to create/update the Webex notification space

    Yields
    ------
    Plain-text progress strings (no framework-specific markup).
    """
    zm  = ZabbixManager()
    wm  = WebexManager()
    dp  = DataProcessor()

    zapi = zm.login()
    if not zapi:
        yield "ERROR: Could not connect to Zabbix."
        return

    if do_devices:
        csv_text = dp.build_csv(devices, show_name, proxy_name)
        if csv_text:
            yield "--- Importing Devices ---"
            yield from zm.push_devices(csv_text, zapi)
        else:
            yield "WARNING: No devices to import."

    if do_webex:
        space_name = f"{show_name} Alerts"
        yield f"--- Setting up Webex space: {space_name} ---"
        room_info = wm.get_or_create_room(space_name)
        room_id   = room_info.get("id")

        if room_id:
            existed = room_info.get("does_exist", False)
            yield f"Webex space {'found' if existed else 'created'}: {space_name}"

            for email in email_list:
                result = wm.add_member(room_id, email)
                if isinstance(result, dict) and result.get("status") == "error":
                    yield f"  Could not add {email}: {result.get('message')}"
                else:
                    yield f"  Added {email}"

            yield from zm.push_webex_notification(zapi, room_id, show_name)
        else:
            yield f"ERROR: Could not create Webex space '{space_name}'."

    zm.logout(zapi)
    yield "=== Workflow complete ==="


def run_remove(
    show_name:     str,
    remove_devices: bool = True,
    remove_webex:   bool = True,
    group_filter:   Optional[str] = None,  # None = remove all groups for show
) -> Generator[str, None, None]:
    """
    High-level generator that handles a complete Remove workflow.

    Parameters
    ----------
    show_name       : Name of the show to remove
    remove_devices  : Whether to delete Zabbix hosts and groups
    remove_webex    : Whether to delete the Webex space and Zabbix notifications
    group_filter    : If set, only remove hosts in groups matching this term;
                      if None, removes all groups containing show_name
    """
    zm = ZabbixManager()
    wm = WebexManager()

    zapi = zm.login()
    if not zapi:
        yield "ERROR: Could not connect to Zabbix."
        return

    target_term = group_filter if group_filter else f"{show_name} - "

    if remove_devices:
        yield "--- Removing Devices ---"
        yield from zm.delete_hosts_in_groups(zapi, target_term)
        yield from zm.delete_host_groups(zapi, target_term)

    if remove_webex:
        yield "--- Removing Webex Notifications ---"
        yield from zm.delete_trigger_actions(zapi, show_name)
        yield from zm.delete_media_types(zapi, show_name)
        zm.delete_media_from_user(zapi, "administrator", show_name)

        space_name = f"{show_name} Alerts"
        room_id    = wm.get_room_id_by_name(space_name)
        if room_id:
            yield from wm.delete_room(room_id)
        else:
            yield f"Webex space '{space_name}' not found."

    zm.logout(zapi)
    yield "=== Remove workflow complete ==="
