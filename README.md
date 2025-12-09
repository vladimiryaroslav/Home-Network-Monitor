# Home Network Monitor

Lightweight Python tool that discovers devices on your local network and serves a zero-dependency web dashboard.

## Run it

```bash
python server.py
```

Then open your browser at http://localhost:8000.

## How it works

- Python-only backend (no external services) performs a best-effort /24 ping sweep, resolves hostnames, and reads the ARP table for MAC addresses.
- Background scan runs every 30 seconds to keep the device list fresh.
- `/devices` returns JSON with `ip`, `mac`, `hostname`, `status`, and `last_seen`.
- Static frontend files are served from the `frontend` folder; there are no build steps or package installs required.

## Project structure

- `backend/server.py` — HTTP server + network scanner
- `server.py` — convenience entrypoint
- `frontend/index.html` — SPA shell
- `frontend/styles.css` — minimal styling (Tailwind-inspired)
- `frontend/bundle.js` — prebundled React SPA (no CDN)

## Notes

- Scanning assumes a `/24` network anchored to your current IPv4. Adjust `DEFAULT_NETMASK` or `SCAN_INTERVAL_SECONDS` in `backend/server.py` if desired.
- ARP lookups and ping flags are platform-aware for Windows/macOS/Linux; results may vary by firewall settings.

