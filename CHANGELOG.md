# PideYa — Web Dashboard (Super Admin) — Changelog

## En desarrollo — 2026-10-21: outbox y notificaciones operativas
- Migraciones 031/032: eventos transaccionales, dispositivos privados, reservas, reintentos, confirmación por lotes, incidencias y monitorización.
- Trabajador con adaptadores Expo, FCM Android y Web Push; suscripciones Web Push del panel.
- Retirada de duplicados y broadcasts de campañas desde navegador; campañas quedan guardadas, no enviadas por este flujo.
- VITE_NOTIFICATION_V2=true requiere despliegue coordinado. Rutas desactivadas por defecto. Auditoría: docs/NOTIFICACIONES_Y_CAPACIDAD_2026-10-21.md.

> URL: pide-ya.app | Vite 5 + React 18 + Tailwind 3.4 | Vercel

---

## Current Production
- Login admin con Supabase Auth
- Panel Admin con secciones: Dashboard, Restaurantes, Comisiones, Pedidos, AntiSpam, Mapa, Reportes, Promociones, Config, Categorías
- Gestión de restaurantes (CRUD, status PENDING/ACTIVE/SUSPENDED)
- Sistema de comisiones (tiers JSONB + commission_payments)
- Categorías dinámicas: crear, eliminar, toggle `is_active` (Restaurantes, Farmacia, Carnicería, Frutería, Pescadería, Cremería, Tiendas, Otros)
- Mapa en vivo de admin (ubicaciones de restaurantes)
- Anti-spam: blocked_entities
- GPS config: `gps_distance_interval_m`, `gps_time_interval_ms`

### Pendientes / Tech Debt
- [ ] **App.tsx monolítico** (~257KB, 5000+ líneas) — necesita refactoring urgente
- [ ] 60+ branches muertos en el repo
- [ ] No hay CI/CD
- [ ] Categorías no tienen configuración de flujo por tipo (peso, unidades, picking)
- [ ] No hay módulo de inventario para los negocios
- [ ] No hay analytics/reportes de rendimiento por categoría
- [ ] No hay sistema de notificaciones push desde admin
- [ ] No hay gestión de promociones funcional

---

## Historial de Deploys
| Fecha | Notas |
|-------|-------|
| Jul 2026 | Versión actual en Vercel |


### Revisión de catálogo — 21 de octubre de 2026 (local)

Catálogo QA: cinco negocios, doce productos, veintitrés opciones y siete fotos preparados, pendientes de autorización de carga. Admin: precio base/tipo de opción, imágenes JPEG en Storage, normalización de líneas móviles y ticket; build deja de reescribir código. Ver docs/CATALOGO_Y_ADMIN_2026-10-21.md.

## 2026-10-22

Catálogo QA remoto cargado (5 negocios/12 productos/23 opciones). Admin sin recorte de 8 negocios, pedidos paginados de 50 y gráfico sin división por cero. Migración 035 de autorización GPS preparada y probada localmente; no aplicada a Supabase.

### Operación rural y revisión de surtido

Vista operativa local para admin global y negocio: filtros, métricas de estados/duración y alertas de revisión (respuesta ≥10 min, recorrido ≥2 h, ubicación ausente/antigua), sin cancelaciones automáticas. Propuesta ampliada de incidencias, apertura gradual de categorías y faltantes preautorizados. Backend de estos flujos aún pendiente. Build y 8 pruebas correctos.
