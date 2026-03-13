# HostPanel (Single Host, Admin-Only, LXC-Only)

A minimal management panel designed for direct installation on one Linux host.

## Fixed Scope
- Single host only
- Admin login only
- LXC only
- Default images only: `alpine/3.20`, `debian12`
- Default images are preloaded during install

## Quick Install (Linux host)
```bash
wget -qO install.sh https://raw.githubusercontent.com/w243420707/hostpanel-single-host/main/install.sh && sudo bash install.sh
```

During installation, you can input a web port. If you press Enter directly, it uses `2026`.

3. Open web panel: `http://<host-ip>:2026`
4. API health: `http://<host-ip>:9000/health`

## Default Admin
- Username: `admin`
- Password: `change-me-now`

Change credentials in `/opt/hostpanel/.env` after installation and restart services.

Note: `ADMIN_USERNAME` and `ADMIN_PASSWORD` are only used when the database is created for the first time.

## Services
- `hostpanel-api` on port 9000
- `hostpanel-worker`
- `hostpanel-web` on configurable port (default 2026)

## Notes
- No migration features
- No snapshot features
- No firewall management (open by default)
- No billing/coupon/features outside fixed scope
