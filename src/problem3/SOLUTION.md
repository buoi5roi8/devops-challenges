# Problem 4 – Solution Report



## 1. Problems found

### 1.1 Nginx proxy routing and port mismatch (critical)

- **Symptom**: API sometimes inaccessible; 502 Bad Gateway or connection refused from nginx.
- **Cause**: The API listens on port **3000** (`app.listen(3000)` in `api/src/index.js`), but nginx was proxying to **port 3001** (`proxy_pass http://api:3001` in `nginx/conf.d/default.conf`). Every request to `/api/` was sent to the wrong port, so the API never received traffic. There were also no explicit upstream rules for `/status` and `/health`, so those endpoints weren’t consistently routed to the API.
- **Fix**: Updated `proxy_pass` to `http://api:3000` in `nginx/conf.d/default.conf` and added `location /status` and `location /health` blocks that also `proxy_pass http://api:3000`, ensuring all API- and health-related paths consistently hit the API container.

### 1.2 Startup race (dependency ordering)

- **Symptom**: Intermittent failures, especially on first start or after `docker compose up --build`.
- **Cause**: `depends_on` only waits for containers to **start**, not for Postgres and Redis to be **ready**. The API could start before the database or Redis accepted connections, so the first requests (or module load) could fail or hang.
- **Fix**:
  - Added **healthchecks** for `postgres` and `redis` (`pg_isready`, `redis-cli ping`).
  - Added a **healthcheck** for the API that hits a new `/health` endpoint (checks DB + Redis).
  - Changed `depends_on` to use `condition: service_healthy` so nginx waits for a healthy API, and the API waits for healthy Postgres and Redis.
  - Added **startup wait** in the API: it retries connecting to Postgres and Redis (up to 30 attempts, 1s apart) before calling `app.listen()`, so the process only listens when dependencies are reachable.

### 1.3 Database connection leak on errors

- **Symptom**: Under load or repeated errors, the API could exhaust the Postgres connection pool (`max_connections` is 20 in `postgres/init.sql`), leading to timeouts or 500s.
- **Cause**: In `/api/users`, if `db.query()` or a later step threw, `db.release()` was never called, so the client was not returned to the pool.
- **Fix**: Used a `finally` block to always call `db?.release()` whether the handler succeeds or throws.

### 1.4 No resilience to crashes or restarts

- **Symptom**: If the API (or nginx) crashed, it stayed down until manually restarted.
- **Cause**: No `restart` policy was set.
- **Fix**: Added `restart: unless-stopped` for the `api` and `nginx` services.

### 1.5 Postgres init script not applied

- **Symptom**: `postgres/init.sql` (e.g. `max_connections = 20`) was never run because it wasn’t mounted.
- **Cause**: No volume mounting `init.sql` into `/docker-entrypoint-initdb.d/`.
- **Fix**: Mounted `./postgres/init.sql` into `/docker-entrypoint-initdb.d/init.sql` in `docker-compose.yml` so the script runs on first DB initialization.
- **Best practice**: Keep `max_connections` modest (often in the 50–200 range for typical apps), size it to available CPU/RAM, and rely on a connection pool (or PgBouncer in front of Postgres) rather than setting extremely high values (e.g. 1000) which can waste memory and hurt performance.

---

## 2. How they were diagnosed

- **Port mismatch**: Compared `app.listen(3000)` in `api/src/index.js` with `proxy_pass http://api:3001` in nginx config.
- **Startup race**: Noted plain `depends_on` (no health conditions) and no wait logic in the API; confirmed that Compose only waits for container start, not service readiness.
- **Connection leak**: Traced `/api/users` control flow and saw that on exception, execution never reached `db.release()`.
- **Init script**: Checked `docker-compose.yml` for postgres volumes and found no mount for `postgres/init.sql`.

---

## 3. Fixes applied (summary)


| Area           | Change                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nginx          | `proxy_pass` port 3001 → 3000.                                                                                                                            |
| API            | Startup wait for Postgres + Redis; `/health` endpoint; connection release in `finally`; optional `curl` in image for healthcheck.                         |
| docker-compose | Healthchecks for postgres, redis, api; `depends_on` with `condition: service_healthy`; `restart: unless-stopped` for api and nginx; postgres init volume; secrets/env vars passed via `.env` instead of hard-coded in `docker-compose.yml`. |


---

## 4. Monitoring and alerts to add

- **Health endpoint**: Use `/health` (or `/api/health` behind nginx) for load balancer and orchestrator health checks and for a simple uptime monitor.
- **Metrics**: Expose or scrape request rate, latency, and error rate for `/api/users` (e.g. Prometheus + Grafana, or app-level metrics).
- **Alerts**:
  - API or dependency (Postgres/Redis) down or repeatedly unhealthy.
  - Error rate or latency above thresholds.
  - Postgres connection pool near exhaustion (e.g. active connections > 80% of `max_connections`).
- **Logging**: Structured logs (e.g. JSON) with request id, status, duration, and error messages; ship to a central log store and alert on error spikes or repeated “connection refused” / “pool exhausted” messages.

---

## 5. How to prevent this in production

- **Config review**: Checklist or automated check that proxy/ingress ports match application listen ports and that init scripts are mounted where intended.
- **Readiness vs. startup**: Use healthchecks and “ready” semantics (e.g. `condition: service_healthy`) so nothing routes traffic until dependencies are ready; keep startup wait/retry in the API as a safety net.
- **Resource hygiene**: Always release DB (and similar) resources in `finally` or use patterns that guarantee release (e.g. try-with-resources style).
- **Restart policies**: Use `restart: unless-stopped` (or orchestrator equivalents) for services that should recover from crashes.
- **Production hardening**: Put the app behind a proper reverse proxy/ingress with timeouts and retries; use connection pooling and limits; run healthchecks and act on them (e.g. stop sending traffic to unhealthy instances). Prefer managed Postgres/Redis where possible and enforce backup and failover procedures.

