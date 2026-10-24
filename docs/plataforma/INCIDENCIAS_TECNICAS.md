# Incidencias técnicas y monitoreo

Actualizado: 24 de octubre de 2026.

## Flujo

Cuando falla la inserción de un pedido, la app cliente envía un reporte independiente mediante `report_technical_incident`. El rechazo de la transacción del pedido no revierte este reporte. El envío es asíncrono, tiene un máximo de cuatro segundos y no reintenta ni crea otro pedido.

Se registra fecha/hora de recepción del servidor, usuario autenticado, negocio, app, operación, código normalizado de error, versión y build. Nunca se envía el carrito, dirección, token, contraseña ni mensaje SQL original. La identidad no se acepta del dispositivo: se obtiene de la sesión autenticada.

## Portal del dueño

Administración → Incidencias técnicas. Filtros por fechas (CDMX), negocio, usuario UUID y estado. Paginación de 50, exportación de la página actual y totales del filtro. Estados: abierta, en atención y resuelta; también se puede reabrir. Cada cambio requiere una nota y genera auditoría con actor y fecha.

Solo usuarios de `admin_profiles` pueden consultar y gestionar. El reporte exige sesión, deduplica el UUID y admite como máximo 20 reportes por usuario por hora, incluso con solicitudes concurrentes. Este límite protege la escritura de reportes; no sustituye un limitador HTTP global.

## Grafana

El snapshot privado del worker incorpora cuatro gauges sin identificadores personales:

- `pideya_technical_errors_last_hour`: reportes recibidos en una hora.
- `pideya_technical_affected_users_last_hour`: usuarios distintos en una hora.
- `pideya_technical_incidents_open`: total pendiente de resolución.
- `pideya_checkout_errors_last_15m`: intentos reportados de crear pedido en 15 minutos.

El dashboard exportable es `ops/grafana-worker-dashboard.json`. La expresión propuesta en `ops/grafana-checkout-alert.promql` detecta al menos cinco reportes en 15 minutos; configurar evaluación cada minuto y persistencia de dos minutos. Destino acordado: agenciamovidatci@gmail.com. No activar una regla sin verificar la fuente y su ruta de notificación.

## Cobertura y límites

La instrumentación inicial es del fallo de inserción de pedidos en cliente. No cubre automáticamente todos los fallos del negocio, repartidor, web, arranque ni validaciones anteriores a la inserción. Una app sin conexión puede no reportar; no hay cola offline de telemetría. Las versiones ya instaladas no incorporan código nuevo por cambiar la base de datos: requieren una nueva publicación de la app. No se reconstruyen reportes históricos a partir de capturas ni se inventa el usuario afectado.

Cero reportes no demuestra cero fallos. Los rechazos de cobertura/precio/disponibilidad también se clasifican y deben distinguirse de una caída del servicio. Los gauges son conteos recibidos, no porcentajes de fallos ni usuarios simultáneos. Un usuario puede causar varios reportes; no se generan incidencias ficticias para llenar el panel.

## Publicación y pruebas

Orden: aplicar migración 053 antes de publicar el worker (su snapshot valida todos los campos); publicar portal; publicar cliente cuando se prepare su siguiente AAB. La migración conserva las métricas previas. Rollback de aplicación: volver a versión anterior de web/worker dejando tabla y RPC, para no perder reportes.

Pruebas verificadas: compilación y tipos web/cliente; clasificación de errores; permisos por rol, aislamiento de lectura, idempotencia, límite horario, cambios con auditoría y métricas en una transacción SQL revertida, sin crear pedidos ni enviar notificaciones.
