# Troubleshooting: VM at 99% Storage (NGINX Load Balancer)

## 1. Immediate Response Phase (The "Stop the Bleeding" Steps)

Before deep-diving into why it happened, I perform "triage" to prevent a total service crash.

- **Check for "Ghost" Files:** Often, deleted logs are still held open by NGINX.
  - *Action:* `sudo lsof +L1` (Finds deleted files with active handles).
  - *Fix:* Reload NGINX (`systemctl reload nginx`) to release handles without dropping connections.
- **Emergency Truncation:** If active logs are the culprit, **truncate** rather than **delete**.
  - *Action:* `sudo truncate -s 0 /var/log/nginx/access.log`.
- **Quick Cleans:**  `sudo apt-get clean` (Clear package cache).
  - `sudo journalctl --vacuum-size=500M` (Cap system logs).

---

## 2. Technical Deep Dive: Root Cause Analysis

Once the system has breathing room (e.g., 85% usage), I use the following methodology to identify the source.

### Diagnostic Commands

```bash
# Overall disk usage
df -h

# Largest directories (start from /)
sudo du -hx --max-depth=1 / 2>/dev/null | sort -hr | head -20

# Heavy writers (if iotop available)
sudo iotop -o -b -n 3 (it will take 3 snapshots of your I/O activity and then stop)
if not installed yet: `sudo apt install iotop`

# Top 20 largest files
sudo find / -xdev -type f -printf '%s %p\n' 2>/dev/null | sort -rn | head -20

# Journal (systemd)
journalctl --disk-usage
```

### Potential Scenarios & Recovery

#### Scenario A: Log Rotation Failure

- **The Cause:** `logrotate` failed, or NGINX is logging at `debug` level during a high-traffic event.
- **Impact:** Performance degradation due to I/O wait; eventual service failure.
- **Recovery:** Fix `/etc/logrotate.d/nginx`. Implement **size-based** rotation instead of just time-based.

#### Scenario B: Unbounded Proxy Cache

- **The Cause:** NGINX `proxy_cache` is configured without a `max_size` parameter.
- **Impact:** Cache grows until the disk is consumed, potentially breaking the application's ability to serve static assets.
- **Recovery:** Update `nginx.conf`:
- `proxy_cache_path /data/nginx/cache keys_zone=my_cache:10m max_size=10g;`

#### Scenario C: The "Deleted File" Inode Leak

- **The Cause:** A large log (or other file) was deleted while NGINX (or another process) still had it open. The inode is released but space is not freed until the process closes the file
- **Impact:** `du` shows space available, but `df` shows 100% full.
- **Recovery:** Restart or Reload the NGINX master process to release the file descriptor.

---

## 3. Preventive Strategy

To ensure this doesn't happen again, I recommend a **"Defense in Depth"** storage strategy:

### Strategic Improvements

1. **Isolation:** Move `/var/log` and NGINX cache to **separate logical volumes (LVM)**. This ensures a log spike cannot crash the Root OS.
2. **Monitoring & Alerting:** Set a **Warning** alert at 70% and a **Critical** alert at 85%.

- Monitor the *rate of change* (e.g., alert if 10GB is consumed in <1 hour).

1. **Externalized Logging:** Ship logs to a centralized stack (ELK/Loki) and minimize local retention to 24-48 hours.
2. **Automation:** Use Ansible/Puppet to ensure `journald.conf` and `logrotate` configurations are consistent across the fleet.

