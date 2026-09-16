# API Deployment and Health Probes Guide

This guide defines the health probe contract, runtime requirements, and deployment configurations for the Quittance API across container platforms.

## Liveness vs Readiness Contract

Cloud platforms (Render, Fly.io, Railway, Kubernetes) require distinct health endpoints to differentiate between container process crashes and traffic readiness.

| Probe Attribute | Liveness Probe | Readiness Probe |
| :--- | :--- | :--- |
| **Primary Route** | `/api/health` | `/api/ready` |
| **Path Aliases** | `/health`, `/healthz`, `/api/health/live` | `/ready`, `/readyz`, `/api/health/ready` |
| **Verification Scope** | Node.js runtime is active and accepting HTTP connections | Critical environment variables, CORS origins, and optional network dependencies |
| **External Calls** | None. Purely in-memory, cold-start safe. | None by default. Optional Horizon reachability ping behind configuration flag. |
| **Database Requirement** | None | None for in-memory MVP mode (`storageReady: true`). |
| **Platform Action on Failure** | Restarts or kills the container | Removes container from load balancer ingress pool; does not kill process |
| **Success Status** | HTTP 200 OK | HTTP 200 OK |
| **Failure Status** | Connection refused or HTTP 500 | HTTP 503 Service Unavailable with JSON error breakdown |

### Liveness Probe (`/api/health`)

Use `/api/health` (or aliases `/health`, `/healthz`, `/api/health/live`) for container orchestrator liveness checks.

- Returns HTTP 200 with process metadata.
- Executes synchronously without contacting external services (Horizon, PostgreSQL, Redis).
- Immune to network timeouts and cold-start latency.

Example response:
```json
{
  "status": "ok",
  "service": "Quittance API",
  "version": "1.0.0",
  "storage": "memory",
  "network": "TESTNET",
  "simulationEnabled": false,
  "timestamp": "2026-09-16T08:00:00.000Z"
}
```

### Readiness Probe (`/api/ready`)

Use `/api/ready` (or aliases `/ready`, `/readyz`, `/api/health/ready`) for ingress and traffic routing checks.

- Validates runtime prerequisites before routing live user traffic.
- Fails fast with HTTP 503 if critical configuration is missing or malformed.
- In-memory MVP mode does not require PostgreSQL to report ready (`storageReady: true`).

Example HTTP 200 (Ready):
```json
{
  "status": "ready",
  "service": "Quittance API",
  "storage": "memory",
  "ready": true,
  "checks": {
    "frontendOrigins": true,
    "simulationDisabled": true,
    "stellarNetwork": true,
    "horizonUrl": true,
    "storageReady": true
  },
  "reasons": [],
  "missing": [],
  "timestamp": "2026-09-16T08:00:00.000Z"
}
```

Example HTTP 503 (Not Ready):
```json
{
  "status": "not_ready",
  "service": "Quittance API",
  "storage": "memory",
  "ready": false,
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
  "timestamp": "2026-09-16T08:00:00.000Z"
}
```

---

## Environment Variables Validated by Readiness

| Variable | Required in Production | Valid Values | Description |
| :--- | :--- | :--- | :--- |
| `STELLAR_NETWORK` | Yes | `TESTNET` or `PUBLIC` | Target Stellar network. |
| `STELLAR_HORIZON_URL` | Yes | HTTPS URL in production (HTTP localhost allowed in development) | Horizon RPC endpoint. |
| `FRONTEND_URL` | Yes (or `FRONTEND_URLS`) | Valid URL origin without trailing slash (e.g. `https://app.quittance.org`) | Permitted CORS frontend origin. |
| `FRONTEND_URLS` | Optional | Comma-separated URL origins | Additional permitted CORS origins. |
| `ALLOW_SIMULATE` | Yes | `false` | Must not be `true` in production deployments. |
| `HEALTH_HORIZON_PING` | Optional | `true` or `false` (default `false`) | Enables Horizon RPC connectivity check during readiness probe. |

---

## Horizon RPC Reachability Check

By default, the readiness probe does not execute network requests to Stellar Horizon, ensuring third-party RPC blips do not disrupt demo or MVP deployments.

To enforce Horizon RPC connectivity during readiness verification:

1. **Environment Flag:** Set `HEALTH_HORIZON_PING=true` in environment variables.
2. **Dynamic Query Parameter:** Append `?ping=true` to any readiness check request (e.g. `GET /api/ready?ping=true`).

Operational characteristics:
- **Timeout:** 2000 ms timeout per probe via `AbortController`.
- **Cache TTL:** Results are cached in memory for 5000 ms to prevent rate limiting upstream Horizon nodes.

---

## Platform Deployment Recipes

### Render

Configure a Web Service or use `backend/render.yaml`:

```yaml
services:
  - type: web
    name: quittance-api
    runtime: node
    rootDir: backend
    plan: free
    buildCommand: npm ci && npm run build
    startCommand: npm run start:mvp:prod
    healthCheckPath: /api/ready
    envVars:
      - key: NODE_ENV
        value: production
      - key: NODE_VERSION
        value: "20"
      - key: STELLAR_NETWORK
        value: TESTNET
      - key: STELLAR_HORIZON_URL
        value: https://horizon-testnet.stellar.org
      - key: ALLOW_SIMULATE
        value: "false"
      - key: HEALTH_HORIZON_PING
        value: "false"
      - key: FRONTEND_URL
        value: https://your-frontend.vercel.app
```

### Fly.io

Configure separate liveness and readiness checks in `fly.toml`:

```toml
[http_service]
  internal_port = 3001
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "5s"
    interval = "15s"
    method = "GET"
    timeout = "2s"
    path = "/healthz"

  [[http_service.checks]]
    grace_period = "10s"
    interval = "15s"
    method = "GET"
    timeout = "3s"
    path = "/readyz"
```

### Railway

Set the healthcheck path in Service Settings:
- **Healthcheck Path:** `/api/ready`
- **Healthcheck Timeout:** 5 seconds

### Kubernetes

Define separate `livenessProbe` and `readinessProbe` specifications:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: quittance-api
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: api
          image: quittance-api:latest
          ports:
            - containerPort: 3001
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3001
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /readyz
              port: 3001
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 2
```
