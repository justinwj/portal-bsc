# portal-bsc

portal for bsc

## Deployment and runtime packaging

This repository includes deployment packaging assets for running `portal-bsc` in containers.

### Files added for deployment

- `/home/runner/work/portal-bsc/portal-bsc/Dockerfile` - production-oriented multi-stage image build
- `/home/runner/work/portal-bsc/portal-bsc/.dockerignore` - optimized Docker build context
- `/home/runner/work/portal-bsc/portal-bsc/deploy/docker-compose.app-service.yml` - app service snippet for Compose
- `/home/runner/work/portal-bsc/portal-bsc/deploy/nginx.portal-bsc.conf` - Nginx reverse proxy example

## Build and run with Docker

```bash
docker build -t portal-bsc:latest .
docker run --rm -p 3000:3000 --env-file .env portal-bsc:latest
```

The container listens on `PORT` (default `3000`) and serves traffic from `0.0.0.0`.

## Synology Container Manager notes

1. Build and push your image from CI (or build locally) and publish it to a registry accessible by Synology.
2. In Synology **Container Manager**:
   - Open **Project** (Compose-based deployment) or **Container** (single container deployment).
   - Pull the image tag you want to deploy.
   - Set environment variables from the table below.
   - Map host port (for example `3000`) to container port `3000`.
   - Add a restart policy (`always` recommended).
3. If using reverse proxy, configure Synology's reverse proxy to forward HTTPS traffic to your container port, or run an external Nginx using the provided example.
4. For updates, pull the new image tag and redeploy/restart the service.

## Environment variables

These are runtime variables expected by the container entrypoint and common Node.js production deployments.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `production` | Runtime mode for the Node process. |
| `PORT` | No | `3000` | Port the app binds to inside the container. |
| `HOST` | No | `0.0.0.0` | Bind address for inbound traffic in containers. |
| `TZ` | No | _(unset)_ | Optional timezone for log timestamps and process locale behavior. |

If your application uses additional app-specific variables, define them in your deployment environment (`.env`, Synology project variables, or secret manager) and keep secrets out of source control.
