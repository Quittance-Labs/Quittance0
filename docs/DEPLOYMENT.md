# Deployment Guide: Health Probes & Platform Readiness

Quittance exposes distinct **liveness** and **readiness** endpoints designed for hosted cloud platforms (Render, Fly.io, Railway, Kubernetes) and serverless environments.

---

## 1. Liveness vs. Readiness

| Check | Primary Path | Aliases | Purpose | Platform Action on Failure | External Calls |
|---|---|---|---|---|---|
| **Liveness** | `GET /api/health` | `/health`, `/healthz`, `/api/health/live` | Validates process is alive and HTTP listener responds | **Restart container/process** | None (in-process only) |
| **Readiness** | `GET /api/ready` | `/ready`, `/readyz`, `/api/health/ready` | Validates critical configuration and service readiness | **Stop routing traffic** (do not restart) | In-memory config; optional Horizon ping |

### Liveness Probe (`/api/health`)
- Returns `HTTP 200 OK` as soon as the HTTP listener begins accepting traffic.
- **Cold-Start Safe**: Does not touch external APIs (Stellar Horizon) or databases (PostgreSQL), preventing false-negative restart loops on slow cold starts.
- Response payload:
  ```json
  {
    "status": "ok",
    "service": "Quittance API",
    "version": "1.0.0",
    "storage": "in-memory",
    "network": "TESTNET",
    "simulationEnabled": false,
    "timestamp": "2026-09-14T12:00:00.000Z"
  }
  ```

### Readiness Probe (`/api/ready`)
- Gates deployment rollout and load balancer traffic routing.
- **Fails fast (`HTTP 503 Service Unavailable`)** when critical deployment configuration is missing or invalid:
  - `FRONTEND_URL` or `FRONTEND_URLS`: In production (`NODE_ENV=production`), at least one valid origin must be configured.
  - `STELLAR_NETWORK`: Must be `TESTNET` or `PUBLIC`.
  - `STELLAR_HORIZON_URL`: Must be a valid URL (requires HTTPS in production).
  - `ALLOW_SIMULATE`: Must not be `true` in production deploy environments.
- Returns structured JSON detailing check results and missing environment variables:
  ```json
  {
    "status": "not_ready",
    "ready": false,
    "service": "Quittance API",
    "storage": "in-memory",
    "checks": {
      "frontendOrigins": false,
      "simulationDisabled": true,
      "stellarNetwork": true,
      "horizonUrl": true,
      "storageReady": true
    },
    "reasons": [
      "FRONTEND_URL or FRONTEND_URLS is required"
    ],
    "missing": [
      "FRONTEND_URL"
    ],
    "timestamp": "2026-09-14T12:00:00.000Z"
  }
  ```
- When ready, returns `HTTP 200 OK` with `"status": "ready"` and `"ready": true`.

---

## 2. In-Memory MVP (Demo Deployment Without Postgres)

The MVP server (`backend/src/server-mvp.ts`) uses an in-memory storage adapter:
- **No PostgreSQL required**: The readiness probe checks `storageReady: true` automatically.
- Suitable for zero-dependency demo deploys on free tier (Render, Railway, Fly.io).
- Ephemeral lifecycle: process restarts clear in-memory invoices, which is expected for demo environments.

---

## 3. Optional Horizon Connectivity Probe

By default, external Horizon latency or rate limits do not block readiness.

If you want the readiness probe to actively verify connectivity to the Stellar Horizon network:
1. Set `HEALTH_HORIZON_PING=true` in your environment variables, or
2. Pass `?ping=true` when querying the readiness endpoint (e.g. `GET /api/ready?ping=true`).

### Reachability Guarantees:
- **Strict Timeout**: Pings abort after 2000 ms to prevent hung probe requests.
- **TTL Caching**: Ping responses are cached for 5 seconds to protect your server and Horizon against rate limiting from frequent load balancer health checks.
- If Horizon is unreachable or returns a 5xx status code, `/api/ready` returns `HTTP 503` with `checks.horizonPing: false`.

---

## 4. Platform Configuration Recipes

### Render (Recommended for MVP Demo)
- **Service Type**: Web Service
- **Root Directory**: `backend`
- **Build Command**: `npm ci && npm run build`
- **Start Command**: `npm run start:mvp:prod`
- **Health Check Path**: `/api/ready` (Render uses this to gate traffic and deploy transitions)
- Blueprint reference: `backend/render.yaml`

### Fly.io (`fly.toml`)
Configure separate liveness and readiness HTTP checks:
```toml
[http_service]
  internal_port = 3001
  force_https = true

# Liveness probe: restart if node process crashes
[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  method = "GET"
  timeout = "5s"
  path = "/api/health"

# Readiness probe: route traffic only when config is valid
[[http_service.checks]]
  grace_period = "5s"
  interval = "15s"
  method = "GET"
  timeout = "3s"
  path = "/api/ready"
```

### Railway
- **Healthcheck Path**: `/api/ready` (or `/api/health` if you want process-only monitoring)
- **Healthcheck Timeout**: `5` seconds

### Kubernetes (`deployment.yaml`)
```yaml
spec:
  containers:
    - name: quittance-api
      image: quittance-api:latest
      ports:
        - containerPort: 3001
      livenessProbe:
        httpGet:
          path: /healthz
          port: 3001
        initialDelaySeconds: 5
        periodSeconds: 15
        timeoutSeconds: 3
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /readyz
          port: 3001
        initialDelaySeconds: 2
        periodSeconds: 10
        timeoutSeconds: 3
        failureThreshold: 2
```

---

## 5. Summary of Environment Variables for Readiness

| Variable | Required in Prod | Valid Values | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `production` | Enables strict production readiness gating |
| `FRONTEND_URL` | Yes | Valid `https://` origin | Exact web client origin for CORS and redirection |
| `FRONTEND_URLS` | No | Comma-separated `https://` origins | Additional preview or custom domain origins |
| `STELLAR_NETWORK` | Yes | `TESTNET` or `PUBLIC` | Stellar network selection |
| `STELLAR_HORIZON_URL` | Yes | Valid `https://` URL | Horizon RPC URL (requires HTTPS in production) |
| `ALLOW_SIMULATE` | Yes | `false` | Must be `false` in production deploys |
| `HEALTH_HORIZON_PING`| No | `true` or `false` | Default `false`. Set `true` to enable Horizon ping in readiness |
