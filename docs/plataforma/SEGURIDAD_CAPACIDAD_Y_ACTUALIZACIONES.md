# Seguridad, capacidad y actualizaciones de PideYa

Revisión: 23 de octubre de 2026. Inspección de código, metadatos de la base de producción en transacción de solo lectura y documentación oficial. No es una certificación de seguridad ni una prueba de carga. No se ejecutaron ataques, campañas, pedidos ni cargas masivas sobre producción.

## Dictamen

La plataforma tiene controles útiles, pero **todavía no debe describirse como blindada ni como validada para 50.000 usuarios simultáneos**. La seguridad requiere permisos correctos, validación de negocio, límites de uso, monitoreo y recuperación. El pool resuelve reutilización de conexiones, no todos esos problemas.

### Evidencia observada

| Control | Resultado / alcance |
|---|---|
| RLS en tablas públicas | 35 de 35 habilitadas. Tener RLS no garantiza que todas las políticas sean correctas. |
| Pedidos | Políticas por cliente, negocio, administrador y repartidor asignado; inserción exige identidad y estado inicial. |
| Límites de creación | 8 pedidos por cuenta en 10 minutos y 4 pendientes vigentes; bloqueo transaccional por cuenta para evitar carreras. No es un límite de todas las peticiones HTTP. |
| Integridad y concurrencia | Precios calculados en servidor, transacciones, bloqueos de custodia y asignación; cola usa leases y SKIP LOCKED. Falta ensayo de concurrencia integral. |
| Consulta SQL | Clientes usan SDK/API y RPC con argumentos; no se halló SQL dinámico en funciones públicas desplegadas durante esta inspección. Esto reduce el riesgo de inyección SQL, pero no demuestra ausencia de otros fallos. |
| Límites de consulta | Roles anon: 3 segundos; authenticated: 8 segundos. Un timeout evita consultas interminables, no impide inundación de peticiones. |
| Base actual | max_connections=60, shared_buffers=224 MB, tamaño aproximado 61 MB; 10 conexiones cliente observadas, una activa durante la consulta. Foto puntual, no promedio ni prueba de capacidad. No se verificó el plan contratado/CPU/RAM desde el panel. |
| Índices | Ningún índice inválido en la consulta. No implica que todos los índices necesarios para carga elevada existan. |

## Corrección aplicada: migración 051

Se encontró que los privilegios predeterminados otorgaban EXECUTE directamente a anon/authenticated. Revocar solamente PUBLIC no retiraba esos permisos. Esto dejaba accesibles helpers internos de segmentación y el procesador de campañas; los helpers podían responder sobre una identidad suministrada sin comprobar que fuese el administrador.

`051_internal_function_privileges.sql`, **aplicada a producción el 23/10**, hace lo siguiente:

- Retira PUBLIC, anon y authenticated de helpers internos y procesadores de campañas.
- Conserva ejecución del procesador para service_role y la ejecución interna como propietario.
- Retira ejecución anónima de RPC con prefijo admin_; el rol authenticated sigue necesitando superar la autorización interna de cada función.
- Cambia permisos predeterminados de funciones creadas por postgres: las nuevas requieren grants explícitos. Otros propietarios requieren revisión independiente; no afirmar que la regla cubre cualquier creador de funciones.
- Conserva entry points de catálogo y acceso por token del repartidor para no romper las APK instaladas.

Validación: primero migración + comprobaciones dentro de transacción con ROLLBACK; después aplicación y comprobación de privilegios efectiva. Pasaron las 31 pruebas JavaScript existentes. `tests/security-privileges.sql` verifica los permisos sin ejecutar campañas ni modificar datos de clientes. El cambio de CI local agrega esas pruebas JavaScript al flujo de GitHub; **todavía no está publicado**. La prueba SQL no se ejecuta automáticamente en CI hasta disponer de una base de pruebas reproducible.

## Riesgos pendientes y orden de atención

### Antes de abrir al público

1. **Permisos de columnas, además de filas.** La política de actualización del propio `driver_profiles` permite la fila completa y solo se observó su trigger de fecha: revisar y restringir cambios de negocio, activación, token e identidad a operaciones autorizadas del negocio. En `client_profiles`, el cliente puede actualizar su fila y esta contiene bloqueo/reputación; esos campos deben ser exclusivos del servidor. Son riesgos derivados de políticas/código; no se intentó explotarlos con cuentas reales.
2. **Eliminación de cuenta.** La función desplegada `delete_user_account` busca pedidos pendientes por teléfono de metadata del usuario antes de eliminarlo. Sustituir esa asociación por `client_user_id=auth.uid()` y probar conservación de caja/incidencias y referencias. El teléfono editable no debe ser prueba de propiedad. No se ejecutó esta función durante la revisión.
3. **Alta de negocios.** Se conserva una política de INSERT pública sin condición. Los triggers fuerzan pendiente/cerrado y validan ubicación, pero no limitan por sí mismos el volumen de solicitudes. Requerir identidad propietaria validada, límites y protección contra automatización sin romper el alta existente.
4. **Abuso HTTP.** Añadir límites por cuenta/ruta y límites prudentes por IP en una entrada confiable; CAPTCHA para alta/autenticación sospechosa y backoff/429. La función antigua `check-spam` recibe la IP del cuerpo y no constituye un control confiable contra atacantes. No bloquear permanentemente una IP compartida por un pueblo, red móvil o negocio por una sola señal.
5. **Códigos del repartidor.** Migrar gradualmente el token reutilizable a invitación de un solo uso + sesión revocable; caducidad, rotación, protección de intentos y cierre remoto. Mantener transición compatible con APK anteriores.
6. **Entorno de pruebas y recuperación.** Verificar MFA de administradores, secretos fuera del repositorio, configuración Auth/Storage, respaldos/PITR disponibles y restauración ensayada. Esta revisión no confirmó esas configuraciones del proveedor ni constituye un análisis exhaustivo de secretos/dependencias.

El origen de Supabase es accesible directamente por las apps: **poner un WAF únicamente delante de la web de Vercel no protege la API directa**. Antes de introducir un gateway hay que diseñar cómo impedir la evasión del control y cubrir Auth, Storage, Realtime y Data API. El hook pre-request de PostgREST solo protege Data API; no sustituye controles en otros servicios.

Añadir pruebas negativas con dos clientes, dos negocios, un repartidor y admin: lectura cruzada, cambio de propietario, modificación de total/bloqueo/token, sesión revocada y llamadas anónimas. Usar fixtures sintéticos en staging. No basta con probar el recorrido autorizado.

## Pool de conexiones

Ruta actual:

`apps/web → HTTPS (supabase-js) → API/PostgREST → pool del servicio → PostgreSQL`

`worker Render → HTTPS RPC → API/PostgREST → PostgreSQL`

Por tanto, **50.000 teléfonos no significan 50.000 conexiones directas a PostgreSQL**. PostgREST tiene pool propio. La herramienta de mantenimiento utilizada accedió mediante una URL del pooler; eso tampoco acredita la configuración de capacidad del tráfico de las apps.

Supavisor transaction mode sirve para futuros procesos con conexión SQL directa y de corta duración; no hay que reemplazar la URL HTTPS de supabase-js por una URL postgres. Antes de ajustar pools, medir conexiones por servicio, espera de pool, CPU, memoria, I/O y duración de consultas. Auth, Realtime, Storage y mantenimiento comparten recursos. No subir max_connections arbitrariamente ni asignar todas las conexiones al pool: puede aumentar consumo de memoria y degradar el servicio.

**Pendiente:** verificar en el panel el tamaño de cómputo contratado, límites y configuración efectiva de PostgREST/Supavisor/Realtime, presupuesto y disponibilidad de métricas. Los 60 slots actuales no permiten calcular por sí solos un máximo de usuarios.

## Cuántos usuarios podríamos soportar

Hoy **no hay un máximo simultáneo demostrado**. Diferenciar población regional, usuarios registrados, usuarios conectados, navegando, pedidos por minuto y repartidores emitiendo GPS. Una población de 50.000 personas no equivale a 50.000 personas haciendo checkout en el mismo segundo.

Escenarios de dimensionamiento, no resultados de pruebas:

| Usuarios navegando | Supuesto: una llamada API cada 10 segundos | Peticiones por segundo |
|---:|---|---:|
| 500 | 0,1 por usuario/s | 50 |
| 5.000 | 0,1 por usuario/s | 500 |
| 50.000 | 0,1 por usuario/s | 5.000 |

Si el 1% de 50.000 usuarios crea un pedido por minuto: unos 8,3 pedidos/s. Si los 50.000 piden en cinco minutos: unos 167 pedidos/s. Cada pedido produce varias lecturas, escrituras, cambios y notificaciones; no dimensionar el sistema contando solo la inserción.

Plan de medición en staging con esquema, cómputo y distribución de datos representativos:

1. Escalones de 50, 100, 250, 500 y 1.000 usuarios virtuales; continuar solo cuando el anterior pasa. Luego 5.000, 10.000 y 50.000 si demanda/presupuesto lo justifican. No son cupos ya soportados.
2. Mezcla documentada de catálogo, checkout, aceptación, entregas, GPS, reportes y notificaciones; escenarios con mismo negocio y misma cuenta para comprobar carreras.
3. Datos sintéticos suficientes; campañas con proveedor simulado. Ensayo corto de picos y prolongado de al menos una hora en el nivel objetivo.
4. Medir p50/p95/p99, peticiones/s, errores inesperados, conexiones/esperas, bloqueos, consultas lentas, CPU/RAM/I/O, edad de cola, Realtime y costo. Separar rechazos de negocio/429 previstos de fallos del sistema.
5. Criterios propuestos: p95 catálogo <1 s, operaciones de pedido <2 s, errores inesperados <1%, ninguna pérdida/duplicación de pedidos o dinero, cola operativa p95 <10 s y recuperación tras caída de worker. Son objetivos a acordar, no valores actuales. La entrega push al teléfono se mide aparte.
6. Autorizar carga operativa con margen mínimo orientativo del 30% respecto de la carga sostenida validada, incluyendo reserva para picos, campañas y fallos. Detener al aparecer saturación; revisar con el proveedor antes de cargas grandes.

Escalar primero consultas/índices y caché de catálogo, paginación y suscripciones/polling; después cómputo PostgreSQL y workers según métricas. El catálogo es candidato a caché; precios, disponibilidad, permisos y cobro se revalidan al crear el pedido. Réplicas/analítica separada pueden servir para reportes posteriores, no para confirmar caja con datos retrasados. Realtime, Expo/FCM, Storage y mapas tienen sus propios límites/costos. Más workers no eliminan los límites globales de envío existentes.

## Actualizar sin interrumpir pedidos

Estado actual: existe CI de typecheck/build; se añadieron localmente pruebas web/worker. Producción tiene despliegues desde Git. **No se confirmó un staging aislado ni un bloqueo de promoción que espere todas las pruebas.** Una vista preview conectada a la base productiva no es staging.

Proceso objetivo:

1. Rama de trabajo y PR; revisión de cambios y compatibilidad. CI: tipos, compilación, pruebas web/worker, migraciones desde cero y desde la versión anterior, permisos entre roles, dependencias y secretos.
2. Staging separado: proyecto Supabase, web preview, worker y apps de prueba con credenciales propias y datos sintéticos. Notificaciones solo a dispositivos de prueba. No copiar datos personales de producción sin anonimización.
3. Ensayo integral del cambio, incluyendo APK anterior contra backend nuevo; migraciones con lock_timeout y revisión de índices/locks. Grandes índices se planifican con creación concurrente fuera de transacción; no añadirlos a ciegas.
4. Confirmar respaldo/restauración, versión de retorno, responsable y métricas. Promoción explícita del artefacto/commit aprobado. Exigir checks en rama y conectar el despliegue al éxito de CI: un workflow de pruebas aislado no garantiza que Vercel/Render esperen.
5. Base primero con cambios aditivos: tablas/columnas opcionales y funciones nuevas; después backend/worker y web. Mantener contratos viejos mientras circulen versiones anteriores de las apps. Backfills en lotes; eliminar campos solo en otra liberación tras comprobar que nadie los usa.
6. Móvil: APK interna para negocio/repartidor; AAB a pruebas internas de Play, después cerradas y publicación gradual donde esté disponible. Cambios nativos exigen nuevo binario. OTA solo si EAS Update está configurado y el runtime es compatible; **no se da por configurado en las APK actuales**.
7. Usar pilotos/banderas para habilitar gradualmente por negocio/localidad, observar errores/cola/caja y ampliar. No forzar reinicio durante un cobro; no cancelar pedidos activos al cambiar una categoría.
8. Si falla: desactivar la función nueva, volver web/worker al artefacto anterior compatible y pausar promoción móvil. La base suele corregirse hacia adelante; restaurar un respaldo puede perder pedidos posteriores y requiere un procedimiento específico, no un rollback rutinario.

No prometer cero interrupciones: buscar cambios compatibles y medibles, con rollback ensayado. Mantener en cada liberación commit, migraciones, versiones APK/AAB, pruebas, limitaciones y responsable en `despliegues.md`.

## Fuentes oficiales consultadas

- [Supabase: conexiones y límites](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits).
- [PostgREST: pool de conexiones](https://docs.postgrest.org/en/stable/references/connection_pool.html).
- [Supabase: seguridad de la API y alcance de pre-request](https://supabase.com/docs/guides/api/securing-your-api).
- [Supabase: preparación para producción](https://supabase.com/docs/guides/deployment/going-into-prod).
- [Supabase: entornos y migraciones](https://supabase.com/docs/guides/deployment/managing-environments).
- [Expo: runtime y compatibilidad de actualizaciones](https://docs.expo.dev/eas-update/runtime-versions/).
- [Expo: rollback de actualizaciones](https://docs.expo.dev/eas-update/rollbacks/).

## Actualización posterior del 23/10

El commit `88cafe4` ya publicó los cambios locales anteriores. Se creó staging Supabase y se conectaron previews/secrets aislados; consultar [el proceso actualizado](STAGING_VERSIONES_Y_MONITOREO.md). Esto no cierra por sí solo los riesgos de permisos, los ensayos de carga ni el circuito de entrega real.
