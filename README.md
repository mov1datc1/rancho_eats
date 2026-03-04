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
