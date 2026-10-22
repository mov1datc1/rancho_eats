# PideYa — Web Dashboard (Super Admin) — Changelog

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
