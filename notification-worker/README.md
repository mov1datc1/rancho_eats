# PIDEYA notification worker

Durable transactional notifications for client, restaurant, driver and web. Deployment and capacity review: [audit and rollout](../docs/NOTIFICACIONES_Y_CAPACIDAD_2026-10-21.md).

## Local checks

```sh
npm ci
npm test
```

The SQL fixtures and concurrency script target a **throwaway PostgreSQL instance only**, database `pideya_notification_qa`, local socket `/private/tmp`, port `55439`. `tests/schema.sql` is not a production migration. Apply fixtures, then platform migrations 031/032, then `tests/outbox.sql`. `tests/concurrency.mjs` inserts and deletes synthetic test data; never point it at production.

## Run

Use Node 20 or later. Inject the environment variables listed in `.env.example` through your service's secret manager. Run one deployment per app/provider; replicas share the database throttle.

```sh
npm start
```

For a local, untracked `.env` file, explicitly load it:

```sh
node --env-file=.env worker.mjs
```

The migrations default all routes to disabled. Merely starting the worker does not enable delivery. Coordinate activation with device registration and retiring legacy senders. The worker needs only server-side service credentials; never put the service-role, Firebase private key or VAPID private key in a mobile or browser build.

Provider acceptance is not proof of device delivery or human acknowledgement. Retries are at-least-once; use the event ID for deduplication. Alert on pending age, provider errors and missing worker progress using `notification_health`. `maintain_notifications` records unattended orders, but sending pages/SMS to operations requires separate configuration.

### Sonido PideYa Negocios 1.3.0

`PIDEYA_MERCHANT_SOUND_V3=true` activa `pideya_order.wav` y el canal Android `kds_new_order_alarm_v3` solo para negocios. Activar únicamente después de actualizar todos los APK de negocios a 1.3.0 o posterior; mantener deshabilitado durante la convivencia con versiones antiguas. Cliente y repartidor conservan sus canales. El sonido nativo requiere un APK nuevo.
