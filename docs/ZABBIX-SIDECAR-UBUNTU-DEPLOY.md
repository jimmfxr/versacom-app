# Sidecar deployment on a personal Ubuntu server

Step-by-step for running [services/zabbix-sync/](../services/zabbix-sync/) on
your own Ubuntu box and updating it via `git pull`. Every shell block
in this doc is copy-pasteable.

If you're the Claude reading this from the manager's environment:
run sections top to bottom. Stop and report back if any single command
returns a non-zero exit code that isn't explicitly expected.

---

## What you'll end up with

- A long-lived `zabbix-sync.service` systemd unit running uvicorn on
  `127.0.0.1:8080`.
- Nginx terminating TLS on `443` and reverse-proxying to that uvicorn.
- A Let's Encrypt cert auto-renewed by certbot.
- A `deploy` user that owns the repo + venv; updates are `git pull`
  followed by `sudo systemctl restart zabbix-sync`.

Versacom (Nodal side) calls the resulting public HTTPS URL with a
bearer token. No inbound traffic except 80/443.

---

## 0. Prerequisites

You need:

- SSH root (or sudo) access to a fresh-ish **Ubuntu 22.04+** server.
- A **public hostname** that resolves to the server's WAN IP. If you
  already use `atk-zabbix.ddns.net` for the Zabbix UI, you can use the
  same DDNS account to mint a subdomain like
  `nodal-sync.atk-zabbix.ddns.net` (or any DNS provider you already
  have). The host must resolve from the public internet so Let's
  Encrypt's HTTP-01 challenge can hit port 80.
- **Ports 80 and 443 open** at your router/firewall and forwarded to
  this server.
- The values that Jimmy sent in chat: `ZABBIX_URL`, `ZABBIX_USER`,
  `ZABBIX_PASSWORD`, `WEBEX_BOT_TOKEN`, `BOLERO_HUB_URL`, and a
  freshly-generated `SIDECAR_SECRET`. Have them ready in your password
  manager — you'll paste them into a root-only file in step 5.

Pick a hostname and DECIDE IT NOW — every following step references it.
Examples below use `nodal-sync.example.com`; substitute your real one.

```bash
export HOSTNAME=nodal-sync.example.com   # <-- change me
```

(You don't need to keep this env var alive across steps; it's just to
keep the snippets readable.)

---

## 1. System packages

```bash
sudo apt update
sudo apt install -y \
  git python3 python3-venv python3-pip \
  nginx certbot python3-certbot-nginx \
  ufw
```

Open the firewall to web + SSH only:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status
```

You should see `OpenSSH` and `Nginx Full` allowed.

---

## 2. Deploy user + repo clone

Create a non-root user that owns the deployment. The systemd service
runs as this user — never as root.

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo -u deploy bash <<'EOF'
cd ~
git clone https://github.com/jimmfxr/versacom-app.git
EOF
```

The repo is public-read, so no SSH key setup is required for `git pull`.

---

## 3. Python virtualenv + dependencies

```bash
sudo -u deploy bash <<'EOF'
cd ~/versacom-app/services/zabbix-sync
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
EOF
```

Verify uvicorn imports without crashing (you'll get a `SIDECAR_SECRET
must be set` error and exit immediately — that's correct, env not set
yet):

```bash
sudo -u deploy bash -lc '
  cd ~/versacom-app/services/zabbix-sync
  source .venv/bin/activate
  python -c "import main" 2>&1 | head
'
```

You should see the `RuntimeError: SIDECAR_SECRET env var must be set` —
the import surfaced the guard before anything else, which is what we
want.

---

## 4. Generate the shared secret

This one value is what Nodal will use to authenticate to the sidecar.
Generate it on the server (don't reuse anything pasted in chat):

```bash
openssl rand -hex 32
```

Copy the output. You'll paste it in step 5 AND send it back to Jimmy
in step 11.

---

## 5. Env file (root-owned, mode 600)

```bash
sudo install -m 600 -o root -g root /dev/null /etc/zabbix-sync.env
sudo nano /etc/zabbix-sync.env
```

Paste this template, then fill in every value. **Do not commit this
file anywhere.**

```
SIDECAR_SECRET=PASTE_FROM_STEP_4
ZABBIX_URL=https://atk-zabbix.ddns.net/zabbix/
ZABBIX_USER=Administrator
ZABBIX_PASSWORD=PASTE_FROM_CHAT
WEBEX_BOT_TOKEN=PASTE_FROM_CHAT
BOLERO_HUB_URL=http://atk-zabbix.ddns.net:5005/inventory/antenna/{kit_number}
```

Save (Ctrl-O, Enter, Ctrl-X). Confirm permissions:

```bash
ls -l /etc/zabbix-sync.env
# expect: -rw------- 1 root root  ...
```

---

## 6. Systemd unit

```bash
sudo tee /etc/systemd/system/zabbix-sync.service > /dev/null <<'EOF'
[Unit]
Description=Nodal Zabbix Sync sidecar (FastAPI)
After=network.target

[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/home/deploy/versacom-app/services/zabbix-sync
EnvironmentFile=/etc/zabbix-sync.env
ExecStart=/home/deploy/versacom-app/services/zabbix-sync/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8080
Restart=on-failure
RestartSec=5

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ProtectKernelTunables=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now zabbix-sync
sleep 2
sudo systemctl status zabbix-sync --no-pager
```

You should see `active (running)`. If not, check logs:

```bash
sudo journalctl -u zabbix-sync -n 50 --no-pager
```

Sanity ping from the server itself (no TLS yet, no auth-required):

```bash
curl -s http://127.0.0.1:8080/healthz
# expect: {"ok":true}
```

---

## 7. Nginx reverse proxy (HTTP first — TLS in step 8)

```bash
sudo tee /etc/nginx/sites-available/zabbix-sync > /dev/null <<EOF
server {
    listen 80;
    server_name $HOSTNAME;

    # Larger client_max_body_size than default: device lists for
    # bigger shows can comfortably exceed 1 MB.
    client_max_body_size 4m;

    # NDJSON streaming friendliness.
    proxy_buffering off;
    proxy_http_version 1.1;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/zabbix-sync /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

External smoke test (from your laptop, NOT the server):

```bash
curl http://$HOSTNAME/healthz
# expect: {"ok":true}
```

If that fails: DNS isn't resolving yet, port 80 isn't forwarded, or
nginx isn't running. Fix before continuing to TLS.

---

## 8. Let's Encrypt TLS

```bash
sudo certbot --nginx -d $HOSTNAME --non-interactive --agree-tos -m admin@$HOSTNAME --redirect
```

(Use a real email if you want renewal-failure notices. Replace
`admin@...` with whatever you prefer.)

This rewrites the nginx config to listen on 443, adds the cert, and
sets up a redirect from `http://` → `https://`. Certbot installs its
own renewal cron — no further action needed.

Verify:

```bash
curl https://$HOSTNAME/healthz
# expect: {"ok":true}

curl -s -H "Authorization: Bearer WRONG_SECRET" https://$HOSTNAME/proxies
# expect: {"detail":"Invalid token"}  (401)
```

---

## 9. End-to-end smoke test

Now test the real Zabbix path. Replace `<SECRET>` with the value from
step 4.

```bash
curl -s -H "Authorization: Bearer <SECRET>" https://$HOSTNAME/proxies | head -c 400
```

You should get a JSON object listing your Zabbix proxies, e.g.:

```
{"proxies":["ATK-Kit-1","ATK-Kit-2", ...]}
```

If this fails: your `ZABBIX_USER` / `ZABBIX_PASSWORD` are wrong, or
the server can't reach `ZABBIX_URL`. Check `journalctl -u zabbix-sync`.

---

## 10. Updates from now on

Whenever Versacom pushes new code (sidecar or anything else in the
repo), you re-deploy with:

```bash
sudo -u deploy bash <<'EOF'
cd ~/versacom-app
git fetch --all
git pull --ff-only
source services/zabbix-sync/.venv/bin/activate
pip install -r services/zabbix-sync/requirements.txt
EOF

sudo systemctl restart zabbix-sync
sudo systemctl status zabbix-sync --no-pager | head
```

If `git pull` reports merge conflicts, that means somebody edited files
on the server — don't fix it in place, bring the diff back to Jimmy.

You can wrap the above in a `~deploy/redeploy.sh` script if you'll be
doing it often.

---

## 11. Send these to Jimmy

When everything in §9 passes:

1. **Public URL** (e.g. `https://nodal-sync.example.com`).
2. **`SIDECAR_SECRET` value** from step 4. Send via your normal
   credential-sharing channel — NOT in this repo.
3. **The `/proxies` smoke-test output** (or just the first line) so we
   know Zabbix login is working end-to-end.

Jimmy wires Nodal's env vars (`NODAL_ZABBIX_URL`, `NODAL_ZABBIX_SECRET`)
to these and ships the **Sync to Zabbix** UI.

---

## Operational notes

- **Logs**: `sudo journalctl -u zabbix-sync -f` tails the service. The
  service logs every NDJSON line + any tracebacks.
- **Rotating the secret**: edit `/etc/zabbix-sync.env`, change
  `SIDECAR_SECRET`, `sudo systemctl restart zabbix-sync`. Tell Jimmy so
  he can update Nodal's env in lockstep.
- **Rotating Zabbix / Webex creds**: same — edit the env file, restart.
- **Disk usage**: zero growth beyond logs. `journalctl --vacuum-time=30d`
  monthly is plenty.
- **Tearing it all down**: `sudo systemctl disable --now zabbix-sync`,
  remove `/etc/systemd/system/zabbix-sync.service`,
  `/etc/zabbix-sync.env`, `/etc/nginx/sites-enabled/zabbix-sync`, and
  `sudo userdel -r deploy`.

---

## Alternatives (don't pick these unless §0–§10 won't work)

- **Cloudflare Tunnel** instead of port-forward + Let's Encrypt: skip
  nginx/certbot entirely, install `cloudflared` and bind it to
  `http://127.0.0.1:8080`. Use this if you can't open ports 80/443 at
  the router. Requires a Cloudflare account.
- **Tailscale + Vercel cron only**: not viable here because Nodal runs
  on Vercel which doesn't have a Tailscale ACL. Skip.
- **Docker**: works fine but adds a runtime to maintain — only useful
  if you already containerize everything else on this host.
