# Conexiones y notificaciones
Cliente, negocio, repartidor y panel comparten Supabase. El servidor controla transiciones, cobertura, precios, categorías, turnos, custodia y caja. Los clientes no deciden solos la validez de una operación.

Pedido → transacción PostgreSQL → evento persistente → entregas por dispositivo → trabajador → Expo Push o Web Push → ticket y comprobante del proveedor. Rutas separadas por aplicación; lotes, límites, reintentos con espera, leases recuperables, caducidad y desactivación de tokens inválidos. Un comprobante de proveedor no prueba que la persona vio el mensaje. La entrega es al menos una vez; el cliente deduplica por evento.

El trabajador supervisor ejecuta rutas independientes y expone /healthz. Service role y VAPID privado solo en servidor. VAPID público puede incluirse en web. No se necesitan webhooks públicos para cada transición del pedido: la cola transaccional evita perder eventos entre guardar y notificar.

No apagar los disparadores antiguos hasta verificar trabajador vivo y rutas activas. Nunca dejar ambos enviando el mismo evento. Cambio de sesión desregistra dispositivos. Recordatorios de pendientes y alertas no deben notificar un pedido ya atendido.

Migraciones 030a–039 aplicadas el 22 de octubre de 2026. Pruebas de SQL en réplica local del esquema real. Aún se requiere prueba física con Android bloqueado, permisos, optimización de batería y señal rural. No se ha acreditado capacidad de 50.000 usuarios simultáneos mediante carga real.
