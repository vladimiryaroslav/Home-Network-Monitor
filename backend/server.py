import json
import os
import platform
import socket
import subprocess
import threading
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from ipaddress import ip_address, ip_network
from pathlib import Path
from typing import Dict, Optional

# Scan configuration
SCAN_INTERVAL_SECONDS = 30
PING_TIMEOUT_MS = 800
DEFAULT_NETMASK = 24


class DeviceStore:
    """Thread-safe device registry."""

    def __init__(self) -> None:
        self._devices: Dict[str, Dict[str, str]] = {}
        self._lock = threading.Lock()

    def update_device(
        self, ip: str, mac: Optional[str], hostname: Optional[str], online: bool
    ) -> None:
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        with self._lock:
            existing = self._devices.get(ip, {})
            record = {
                "ip": ip,
                "mac": mac or existing.get("mac", "unknown"),
                "hostname": hostname or existing.get("hostname", "unknown"),
                "status": "online" if online else "offline",
                "last_seen": now if online else existing.get("last_seen", now),
            }
            self._devices[ip] = record

    def snapshot(self) -> Dict[str, Dict[str, str]]:
        with self._lock:
            return dict(self._devices)


devices = DeviceStore()


def get_local_ip() -> str:
    """Best-effort local IPv4 discovery."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        # Fallback to hostname resolution
        return socket.gethostbyname(socket.gethostname())


def build_subnet(cidr: int = DEFAULT_NETMASK):
    ip = get_local_ip()
    try:
        network = ip_network(f"{ip}/{cidr}", strict=False)
        return [str(host) for host in network.hosts()]
    except ValueError:
        return []


def ping_host(ip: str) -> bool:
    """Ping a host using platform-specific flags."""
    system = platform.system().lower()
    if system == "windows":
        cmd = ["ping", "-n", "1", "-w", str(PING_TIMEOUT_MS), ip]
    else:
        timeout_s = max(1, int(PING_TIMEOUT_MS / 1000))
        cmd = ["ping", "-c", "1", "-W", str(timeout_s), ip]

    try:
        result = subprocess.run(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False
        )
        return result.returncode == 0
    except FileNotFoundError:
        return False


def get_mac_address(ip: str) -> Optional[str]:
    """Query the ARP table for a given IP."""
    system = platform.system().lower()
    if system == "windows":
        cmd = ["arp", "-a", ip]
    else:
        cmd = ["arp", "-n", ip]

    try:
        output = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        return None
    except FileNotFoundError:
        return None

    for line in output.splitlines():
        if ip in line:
            parts = line.split()
            for token in parts:
                if _is_mac(token):
                    return token.replace("-", ":").lower()
    return None


def _is_mac(value: str) -> bool:
    chunks = value.replace("-", ":").split(":")
    if len(chunks) != 6:
        return False
    try:
        return all(0 <= int(part, 16) <= 255 for part in chunks)
    except ValueError:
        return False


def resolve_hostname(ip: str) -> Optional[str]:
    try:
        host, *_ = socket.gethostbyaddr(ip)
        return host
    except Exception:
        return None


def scan_network() -> None:
    """Scan the local /24 network and update the device store."""
    for ip in build_subnet():
        alive = ping_host(ip)
        mac = get_mac_address(ip) if alive else None
        hostname = resolve_hostname(ip) if alive else None
        devices.update_device(ip, mac, hostname, alive)


def scan_loop(stop_event: threading.Event) -> None:
    while not stop_event.is_set():
        scan_network()
        stop_event.wait(SCAN_INTERVAL_SECONDS)


class DeviceRequestHandler(SimpleHTTPRequestHandler):
    """Serve static frontend files and JSON device data."""

    def __init__(self, *args, **kwargs):
        self.frontend_dir = kwargs.pop("frontend_dir")
        super().__init__(*args, directory=str(self.frontend_dir), **kwargs)

    def do_GET(self):
        if self.path.rstrip("/") == "/devices":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            data = list(devices.snapshot().values())
            self.wfile.write(json.dumps(data).encode())
            return
        return super().do_GET()

    def log_message(self, format, *args):  # noqa: A003
        # Keep server output clean.
        return


def start_server(port: int = 8000):
    frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
    handler = lambda *args, **kwargs: DeviceRequestHandler(  # noqa: E731
        *args, frontend_dir=frontend_dir, **kwargs
    )
    server = HTTPServer(("0.0.0.0", port), handler)
    print(f"Serving on http://localhost:{port}")
    print("Frontend:", frontend_dir)
    stop_event = threading.Event()
    thread = threading.Thread(target=scan_loop, args=(stop_event,), daemon=True)
    thread.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        stop_event.set()
        thread.join(timeout=2)
        server.server_close()


def main():
    start_server()


if __name__ == "__main__":
    main()
