# Local Development

## Requirements

- Node.js 22 or newer
- pnpm 10
- Docker with Docker Compose
- WeChat DevTools

## Start MongoDB

```bash
docker compose -f deploy/docker-compose.local.yml up -d
```

MongoDB is exposed on `localhost:27018` because `27017` is commonly used by
other local projects. The API example configuration already uses this port.

## Install and run the API

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm dev:api
```

The development command loads the operating system CA bundle from
`/etc/ssl/cert.pem` by default so Node.js can call the WeChat login API on macOS.
Set `NODE_EXTRA_CA_CERTS` before starting the API to use a different CA bundle.

API endpoints:

- `GET http://localhost:3210/health/live`
- `GET http://localhost:3210/health/ready`
- `GET http://localhost:3210/docs`

The mini program uses `PUT` for profile updates because native `wx.request`
does not support the HTTP `PATCH` method.

Import `apps/miniprogram` into WeChat DevTools to open the mini program skeleton.
The checked-in development API address is `http://127.0.0.1:3210`; replace
`apiBaseUrl` in `apps/miniprogram/app.ts` with the registered HTTPS API domain
before previewing on a physical device or releasing the mini program.

The mini program selects its API automatically by WeChat environment:

- development: `http://127.0.0.1:3210`
- trial and release: `https://egg.zzlulu.cloud`

`BILLING_START_DATE` controls the first date included in weekly billing. The
production value is `2026-10-09`; an admin-visible bill draft is generated every
Friday after 17:00 Asia/Shanghai time for Monday through Friday reservations.
Personal bills and notifications are published from the adjusted draft after
18:00, and missed stages are recovered when the API starts again. Administrators
can also generate the current-week draft and publish it manually. A manually
published run is idempotently skipped by the 18:00 scheduler.

## Production deployment

Production uses `deploy/docker-compose.production.yml`. Copy
`deploy/.env.production.example` to `deploy/.env.production`, replace the two
secrets, then run:

```bash
docker compose -f deploy/docker-compose.production.yml up -d --build
```

The API is exposed only at `127.0.0.1:8090`; the public HTTPS endpoint must be
provided by the host Nginx. MongoDB is reachable only on the internal Compose
network. Uploaded avatars are persisted in `deploy/data/avatars`, while MongoDB
uses the named volume `egg-booking_mongodb-data`.

## Run the MongoDB integration test

```bash
MONGO_TEST_URI='mongodb://localhost:27018/?replicaSet=rs0&directConnection=true' \
  pnpm --filter @egg-booking/api test:integration
```

Uploaded development avatars are stored in `apps/api/data/avatars` by default.
Set `AVATAR_UPLOAD_DIR` to use another persistent directory.

## Initialize the first administrator

After the first user logs in and submits their profile, copy their user ID and run:

```bash
cd apps/api
pnpm admin:promote --user-id <user-id>
```

This command is intentionally limited to the first active administrator. Later administrator
appointments must use the authenticated admin API.
