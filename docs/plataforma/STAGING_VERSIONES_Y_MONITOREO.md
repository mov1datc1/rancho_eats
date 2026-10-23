# Staging, versiones y monitoreo

Actualizado: 23 de octubre de 2026. Este documento distingue infraestructura creada de integraciones todavía pendientes. No equivale a certificar carga ni seguridad completa.

## Entornos y ramas

| Componente | Producción | Staging |
|---|---|---|
| Supabase | `apnxrbuqwgnfuelqjjfy` (nombre histórico `mov1datc1's Project`) | `rganzksyljjerfuowodi`, rama persistente `pideya-staging`, creada sin datos |
| Web/admin | `rancho_eats/main`, Vercel producción | `rancho_eats/staging`, Vercel Preview con credenciales aisladas |
| Cliente | Trabajo vigente en `pideya-app/develop`; no se cambió su rama por defecto ni se inició EAS | `pideya-app/staging`, creada desde develop |
| Negocio | `pideya-restaurant/main` | `pideya-restaurant/staging` |
| Repartidor | `pideya-driver/main` | `pideya-driver/staging` |
| Worker | Render `pideya-notifications`, main | Pendiente instancia separada y credenciales de push exclusivas de pruebas |

La rama de Supabase tiene 35 tablas y pasó `security-privileges.sql`; se aplicó también 052. No se copió el contenido de producción. Una rama persistente consume recursos facturables y no se pausa por inactividad: revisar costo en Billing y pausarla deliberadamente si deja de usarse. No fusionar automáticamente ramas de Supabase hacia producción; las migraciones se revisan y aplican explícitamente.

Las previews de Vercel se configuraron con URL/clave pública de staging. GitHub tiene el entorno `staging`, restringido a esa rama, con variables de proyecto y secretos cifrados para clave pública/conexión SQL de staging. La autorización del propietario para esos destinos quedó confirmada el 23/10. Ninguna credencial está en estos documentos ni en Git. El entorno de staging no debe alojar datos reales: su conexión CI tiene privilegios de administración para las pruebas de esquema y requiere proteger cambios en esa rama.

`build-guard.mjs` rechaza previews sin identificación explícita del entorno y proyecto, rechaza staging apuntando a producción y JWT con rol distinto de anon o ref incorrecta. Una clave publishable moderna no lleva ref legible: su asociación se debe comprobar además con una llamada real. La web de pruebas lleva `[PRUEBAS]` en el título del navegador. Las APK actuales siguen conectadas a producción; **crear una rama Git no cambia su backend**.

## Ciclo normal

1. Crear `feature/<tema>` desde staging. Cambios pequeños con evidencia de pruebas; nada de editar directamente producción.
2. PR hacia staging. CI ejecuta tests web/worker, typecheck y build. Para cambios SQL, probar migración en staging y verificar roles/concurrencia con fixtures sintéticos.
3. Ejecutar `Verify staging isolation` manualmente seleccionando rama staging. Valida entorno/clave/conexión, compila un artefacto y verifica ACL en la base aislada. No ejecuta migraciones automáticamente ni publica a producción.
4. Probar en la preview y dispositivos de QA. Registrar fecha, commit, versiones nativas, migraciones, responsable y resultado. No aprobar una prueba con catálogo vacío.
5. Abrir PR `staging → main` en la web, con la plantilla de publicación. Mantener staging actualizado con main para que los checks se ejecuten contra la base correcta. Las apps mantienen su rama vigente de producción hasta una migración explícita de su flujo EAS.
6. Aplicar primero migraciones aditivas revisadas, después backend/web compatibles; publicar binarios a pruebas internas y promover gradualmente. Registrar una etiqueta de versión y un manifiesto de los cuatro commits para cada liberación coordinada.
7. Mantener APIs/campos antiguos hasta que las versiones instaladas ya no los necesiten. Mínimo probar la versión nativa vigente y la anterior. No forzar reinicios durante pedidos o cobros.
8. Observar errores, caja y cola después de publicar. Desactivar funciones nuevas mediante piloto/bandera si es necesario; revertir aplicación solo si sigue siendo compatible con la base. Restaurar base no es un rollback rutinario porque puede perder pedidos posteriores.

Urgencias: `hotfix/<tema>` nace de la rama de producción, pasa CI/prueba reducida explícita y PR; luego integrar el arreglo a staging. No usar force push. No habilitar fusiones automáticas de esquemas ni `db reset` contra producción.

## Gates y lo que falta automatizar

- CI ya incluye las pruebas web/worker, corre en main/staging y en PR.
- Se prepara protección de ramas mediante checks y PR; verificar su configuración real en GitHub. Un check llamado `build` es requerido solo en rancho_eats, donde existe. No exigir ese nombre en repos sin ese workflow.
- El entorno de GitHub controla los jobs que lo usan; **no controla por sí solo los despliegues automáticos de Vercel o Render**.
- Render estaba configurado `On Commit`. Cambiar a `After CI Checks Pass` desde Settings; no se dispone de operación de modificación de ese ajuste en el conector actual. La protección de main reduce el riesgo antes del merge, pero no sustituye la configuración del proveedor.
- Falta CI de migraciones desde base vacía y actualización desde versión anterior. La historia actual incluye cambios de esquema fuera de las migraciones iniciales; la rama Supabase se inicializó desde el historial actual, no por replay certificado de los archivos 001–052. No activar `supabase db push` automático hasta reconciliar baseline e historial.
- Faltan APK de staging con identificadores/nombres distintos, credenciales Expo/FCM de QA y worker separado. No conectar el worker de producción a staging ni reutilizar dispositivos/endpoints productivos.
- Faltan usuarios/negocios sintéticos, configuración Auth de QA y una prueba completa. La creación de infraestructura no prueba un pedido completo.

## Monitoreo: combinar tres fuentes

| Fuente | Qué mide | Acción |
|---|---|---|
| Supabase Studio y Metrics API | PostgreSQL: CPU, I/O, conexiones, locks, WAL, consultas; Auth/Realtime según reportes disponibles | Identificar consultas caras, espera de pool y saturación antes de subir cómputo |
| Render Metrics/logs | CPU/RAM, reinicios, despliegues, salud del supervisor | Distinguir trabajador caído de base saturada o proveedor de push fallando |
| Métricas propias | Edad/volumen de cola, fallos definitivos, leases vencidos, conexiones/max | Detectar un worker encendido pero atrasado y activar alertas operativas |

Medición puntual de Render 23/10: instancia previa al deploy con 0,028–0,044 CPU sobre límite 0,5; aproximadamente 194–202 MB sobre 537 MB. Es carga baja y no acredita capacidad máxima. La latencia HTTP de `/healthz` no representa latencia de checkout: los pedidos van a Supabase.

### Implementación propia

`052_platform_health_metrics.sql`: `platform_health_snapshot()` devuelve solo agregados, exclusivamente para service_role. Aplicada primero en staging y después producción. No expone tokens, direcciones ni clientes. La consulta de cola se debe revisar con EXPLAIN cuando crezca; el monitoreo también consume recursos.

El supervisor incorpora `/metrics` compatible con Prometheus:

- Sin `METRICS_TOKEN`, permanece deshabilitado (404).
- Con token de al menos 32 caracteres, exige `Authorization: Bearer ...` y GET; respuestas sin caché.
- Consulta agregados cada 60 segundos, no por cada visitante del endpoint; si la muestra está vieja responde 503.
- La salud del proceso continúa en `/healthz`; no se reinicia el envío porque Grafana esté caído.

`ops/prometheus.example.yml` y `ops/alerts.yml` preparan la conexión y alarmas. **No hay Grafana ni receptor de alertas configurados todavía.** El exporter queda deshabilitado hasta guardar un token fuerte en Render y en el recolector. No publicar la clave service_role en la web/admin ni usarla como token de `/metrics`.

Para activarlo:

1. Crear espacio de Grafana Cloud o servicio equivalente y elegir responsable/receptor de alertas.
2. Conectar Supabase por su integración oficial Metrics API. Guardar su clave en el gestor del recolector; nunca en React ni GitHub artifacts.
3. Generar token aleatorio exclusivo para `/metrics`, guardarlo como `METRICS_TOKEN` en Render y en Grafana/Prometheus. Desplegar y comprobar 401 sin token, 200 con token, muestra reciente y series numéricas.
4. Importar las reglas incluidas, asignar entorno, probar una alerta controlada y su recuperación. Los archivos por sí solos no envían avisos.
5. Incorporar crash/ANR y errores de checkout móvil mediante una herramienta de errores con eliminación de datos personales. Sentry es una opción; no se configuró en esta entrega.

Alertas iniciales ajustables: conexiones >70% durante 5 min; cola operativa >30 s durante 2 min; fallos definitivos >0 en última hora; métricas inaccesibles durante 3 min. CPU/memoria desde proveedor: 70%/80% sostenidos como aviso, revisar antes de escalar. Son umbrales operativos propuestos, no límites universales. Para p95 de checkout se necesita telemetría de la API/cliente, no derivarlo del tiempo medio SQL.

## Caché: sí, donde no cambie el resultado de un pedido

- Imágenes/versiones estáticas: CDN y URLs versionadas; ya se sirve web estática por Vercel.
- Menús/categorías públicos: empezar con caché corta (orientativamente 30–60 s) y revalidación/invalidation al editar; medir aciertos antes de introducir Redis.
- Separar clave por negocio, localidad/visibilidad y versión. Categorías piloto o respuestas por usuario no deben compartirse como catálogo público.
- Revalidar precio, cobertura, stock/estado y permisos en servidor al pedir. Nunca confiar en el menú cacheado para cobrar.
- No cachear caja, permisos, tokens ni confirmaciones como verdad operativa. Redis/Valkey compartido se justifica cuando varias instancias necesiten caché/límites distribuidos; no se ha provisionado porque aún no hay evidencia de ese cuello de botella.

## Rate limiting: necesario antes de abrir al público

Los límites actuales de pedidos protegen reglas de negocio, no todo el tráfico. Separar:

1. Auth/alta: límites del proveedor y CAPTCHA ante abuso; intento de código/login con espera creciente y sesión revocable.
2. API: cuota por cuenta y por operación, ráfagas toleradas y 429/Retry-After; medir primero en modo observación cuando sea posible. No castigar la IP compartida de un rancho o red móvil por una sola señal.
3. Gateway/WAF: útil solo si no se evade llamando directo a Supabase. Migrar rutas sensibles gradualmente; mantener protección de base para apps anteriores.
4. Operaciones monetarias: idempotencia y transacción antes que reintentos ciegos. Reintentar una confirmación no debe duplicar pedidos/cobros ni consumir una cuota como si fuera una compra nueva.
5. Fallos del limitador: definir explícitamente qué lecturas pueden continuar y qué escrituras requieren la protección; no bloquear una liquidación de efectivo sin una vía de recuperación.

No se ha desplegado un límite HTTP global ni Redis en esta entrega. No sería seguro añadir un bloqueo general sin conocer el patrón del cliente, GPS, pantallas de cocina y recuperación offline. Prioridad siguiente: cerrar riesgos de permisos del informe de seguridad, instrumentar por ruta y probar el limitador en staging antes de activarlo.

## Carga progresiva

`ops/load/catalog.js` es un escenario k6 de solo catálogo, limitado al ref exacto de staging. Se niega a correr contra otra URL o con catálogo vacío. Predeterminado: 10 usuarios virtuales, un minuto, una llamada cada 10 s; límite explícito hasta 1.000 usuarios por ejecución para evitar arranques accidentales enormes. No se ejecutó carga masiva.

Preparar datos sintéticos representativos y presupuesto; correr 10 → 50 → 100 → 250 → 500 → 1.000, detener ante errores o saturación. Después ampliar escenario a checkout/aceptación/GPS con proveedor push simulado y datos sintéticos. Un test de catálogo no acredita pedidos simultáneos ni capacidad de 50.000 usuarios. Guardar resultados, tamaño de cómputo, versión, p95/p99 y errores antes de dimensionar producción.

## Referencias

- [Supabase: ramas aisladas y persistentes](https://supabase.com/docs/guides/deployment/branching).
- [Supabase: Metrics API](https://supabase.com/docs/guides/observability/metrics).
- [Supabase: conexión Prometheus/Grafana](https://supabase.com/docs/guides/observability/metrics/grafana-self-hosted).
- [Render: despliegue después de CI](https://render.com/docs/deploys).
- [GitHub: entornos y protección](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
