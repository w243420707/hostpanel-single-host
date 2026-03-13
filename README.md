# HostPanel (Single Host, Admin-Only, LXC-Only)

A minimal management panel designed for direct installation on one Linux host.

## Fixed Scope
- Single host only
- Admin login only
- LXC only
- Default images only: `alpine/3.20`, `debian12`
- Default images are preloaded during install

## Quick Install (Linux host)
1. Copy this repository to host.
2. Run as root:

```bash
chmod +x ./install-hostpanel.sh ./preload-default-images.sh
./install-hostpanel.sh
```

During installation, you can input a web port. If you press Enter directly, it uses `2026`.

3. Open web panel: `http://<host-ip>:2026`
4. API health: `http://<host-ip>:9000/health`

## Default Admin
- Username: `admin`
- Password: `admin123`

Change credentials in `/opt/hostpanel/.env` after installation and restart services.

## Services
- `hostpanel-api` on port 9000
- `hostpanel-worker`
- `hostpanel-web` on configurable port (default 2026)

## Notes
- No migration features
- No snapshot features
- No firewall management (open by default)
- No billing/coupon/features outside fixed scope
