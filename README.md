# ArandaEats

Frontend + Supabase para flujo completo de registro de restaurantes, aprobación por admin y pedidos.

## Configuración rápida

1. Copia `.env.example` a `.env` y agrega tus credenciales reales.
2. Ejecuta migraciones en Supabase (`001_initial_schema.sql`, `002_admin_restaurant_policies.sql`, `003_admin_requests_rpc.sql`, `004_admin_dashboard_rpc.sql`, `005_admin_sections_rpc.sql` y `006_fix_pending_requests_query.sql`).
3. Crea al menos un super admin en `admin_profiles` con el `id` del usuario autenticado en `auth.users`.
4. Ejecuta la app con `npm install` y `npm run dev`.

## Notas del panel admin

- El tab **Admin** ahora requiere iniciar sesión con una cuenta que exista en `admin_profiles`.
- Solo esas cuentas pueden ver restaurantes `PENDING` y aprobar/rechazar solicitudes.


- Si en Admin no ves pendientes aun teniendo registros `PENDING`, confirma que la migración `003_admin_requests_rpc.sql` esté aplicada.

- El dashboard de super admin (métricas, actividad, anti-spam y ranking) usa RPCs en `004_admin_dashboard_rpc.sql`; aplícalas para ver datos.

- Las secciones Admin de Pedidos, Mapa en vivo y bloqueo manual usan RPCs de `005_admin_sections_rpc.sql`.

- Si no aparece `Pizzeria JK` en pendientes, usa el botón **Actualizar** en Admin y valida que `VITE_SUPABASE_URL` apunte al mismo proyecto donde ves ese registro.

- Si en `/pruebas` solo aparecen restaurantes `ACTIVE`, eso normalmente **no** es error de Supabase Auth por confirmación de correo: es RLS. La policy pública de `restaurants` solo deja leer `ACTIVE` para sesiones anónimas/no-admin.


- Checklist rápido cuando eres admin pero no ves `PENDING`:
  1. `select id, status, owner_id from restaurants order by created_at desc;`
  2. `select policyname from pg_policies where tablename='restaurants';` (debe incluir `restaurants_select_admin`)
  3. Si falta, aplica `002_admin_restaurant_policies.sql` en el **mismo proyecto** de `VITE_SUPABASE_URL`.

- Si recibes `404` en endpoints `/rpc/admin_*`, el frontend ahora usa fallback automático con consultas directas para que el panel no quede vacío mientras aplicas migraciones.

- Si tu proyecto aún no tiene RPCs y tampoco permite leer `PENDING` por RLS, despliega la Edge Function `admin-restaurants` (`supabase/functions/admin-restaurants`) para listar/aprobar pendientes vía service role como respaldo.

- Si usas `admin-restaurants`, verifica que esté desplegada la versión con respuesta `OPTIONS` y headers CORS (`Access-Control-Allow-Origin`, etc.) para evitar bloqueos del navegador.


## Deploy en Vercel y prueba PWA

1. Sube la rama a GitHub.
2. En Vercel: **Add New Project** → importa el repo.
3. En **Environment Variables** agrega:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_MAPBOX_TOKEN`
4. Deploy de producción.
5. En Supabase Auth configura **Site URL** y **Redirect URLs** con tu dominio Vercel (`https://tu-app.vercel.app`).
6. Verifica que `public/manifest.json` y `public/sw.js` estén siendo servidos en producción.

### Probar PWA en celular

1. Abre la app en Chrome/Android.
2. Debe mostrarse el banner de instalación en la app.
3. Instala la app (Add to Home Screen).
4. Abre la PWA instalada y valida:
   - Home con restaurantes
   - Flujo de pedido
   - Mapa con zoom y GPS
   - Seguimiento de pedido por número

### Notificaciones

- Cliente: cuando cambia el estatus del pedido en seguimiento se dispara notificación web (si el navegador concede permiso).
- Restaurante: cuando llega un pedido `PENDING`, se dispara notificación y alerta de sonido en panel.
- Para experiencia completa en iOS/Android, asegúrate de permitir notificaciones del navegador/PWA en el sistema operativo.
