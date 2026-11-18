# Pedidos y menús simultáneos — 1 noviembre 2026

Se ejecutaron dos pruebas HTTP reales contra **staging**, con sesiones de compradores creadas por Supabase Auth. El tráfico de pedidos usó los JWT de esos compradores, nunca la clave de servicio. No se modificó producción.

## Resultado observado

| Indicador | Ensayo inicial | Ensayo mixto |
| --- | --- | --- |
| Lectores de catálogo/menú | 10 | 100 |
| Compradores enviando un pedido cada uno | 5 | 50 |
| Pico de usuarios virtuales observado | 15 | 150 |
| Solicitudes HTTP | 350 | 3,367 |
| Pedidos creados / cancelados | 5 / 5 | 50 / 50 |
| p95 de creación de pedido | 287 ms | 1,082 ms |
| p95 de menú | 570 ms | 850 ms |
| Timeouts HTTP | 0 | 2 (0.0594%) |
| Umbrales definidos | Aprobados | Aprobados |

Cada escenario duró aproximadamente 90 segundos. La carga de lectura subió durante 15 s y se sostuvo 60 s. Los compradores comenzaron juntos a los 25 s: cotizaron envío, insertaron el pedido contra el **mismo negocio**, leyeron su pedido, comprobaron aislamiento y lo cancelaron por el RPC del cliente. 150 VUs no equivale a 150 pedidos por segundo. El generador promedió aproximadamente 36.8 solicitudes HTTP/s en el ensayo mixto.

El catálogo sintético contenía 100 negocios y 3,000 productos. El menú concurrente pertenecía al negocio del checkout (30 productos). Los 50 compradores eran identidades separadas; 5 de ellas participaron también en el ensayo inicial.

La verificación de servidor encontró 55 pedidos, 55 IDs y 55 folios diferentes, todos cancelados y con subtotal + comisión + envío igual al total. Cada creación comprobó cliente, importe de envío y versión del snapshot frente a su cotización. Un segundo comprador no pudo leer cada pedido probado. Esto comprueba aislamiento de lectura; no constituye una auditoría completa de permisos.

No hubo errores de creación/cancelación en los 55 pedidos. **Sí hubo dos timeouts** en solicitudes de la fase de lectura y una lectura de menú alcanzó 6.61 s. El umbral de errores era <1%, por lo que el ensayo pasó; no se oculta esa cola de latencia ni se considera demostrada su causa. La salida original solo registró `request timeout`, sin respuesta HTTP. El generador ya registra operación, estado, código de transporte y duración en futuras fallas, sin cuerpos ni tokens.

## Monitoreo contrastado

El Grafana existente se abrió con la sesión del propietario y mostró el tablero **PideYa · Notificaciones y base de datos** de producción: worker accesible=1, muestra de unos 49 s, cola/fallos/leases=0 y 7 conexiones PostgreSQL (11.7%). [Tablero existente](https://lankynuthatch225.grafana.net/d/pideya-worker-production). No se crearon integraciones duplicadas ni se compartió una credencial nueva con Grafana.

Ese tablero observa producción, mientras la prueba cargó staging. Para correlacionar el entorno correcto, el runner capturó directamente `platform_health_snapshot()` y la API Prometheus de Supabase durante el ensayo:

- 27 muestras; 25 consultas de salud válidas y dos muestras con fallo de transporte.
- Máximo observado de 24/60 conexiones (40%).
- CPU no ociosa aproximada máxima entre muestras: 19.0%, derivada de deltas de `node_cpu_seconds_total`.
- Uso de memoria aproximado máximo: 55.8%, calculado con MemAvailable/MemTotal.
- Carga de un minuto máxima: 0.6.
- Cola pendiente máxima: 0; el RPC no registró incidentes de checkout durante la ventana.

Son máximos **muestreados**, no capturas de todos los picos instantáneos. No se observó saturación en las muestras válidas, pero dos muestras también fallaron. Los timeouts coinciden con problemas de transporte del generador y del monitor; eso es evidencia para investigar conectividad, no prueba suficiente para descartar una demora del servidor.

**Sentry** está integrado en las apps para errores de ejecución. Un generador que llama REST directamente no ejecuta `createOrder()` del cliente, su reporte de incidentes ni su SDK Sentry. Por eso, cero incidentes en ese contador no demuestra cero fallos HTTP. k6 registró ambos timeouts. Para validar captura en Sentry y experiencia de usuario se necesita un ensayo E2E que ejecute la app o navegador y confirme entrega de los eventos de prueba en el proyecto/entorno correcto.

## Seguridad y limpieza

Las cuentas usaron correos `.invalid` y contraseñas aleatorias privadas. Sus sesiones se guardaron temporalmente con modo 0600 fuera del repositorio; se borraron al terminar. La clave de servicio permaneció en el proceso de preparación/monitoreo y no se pasó a k6.

No se registraron endpoints de dispositivos para las cuentas sintéticas. La verificación confirmó cero entregas hacia proveedores de notificación. Los pedidos nunca llegaron a entregado, por lo que no se ejercitó el envío de resúmenes por correo. No se llamó Google Maps ni se realizaron pagos, liquidaciones o cobros.

Se retiraron los 55 pedidos con sus dependencias, los 100 negocios, 3,000 productos, la categoría QA y las 51 identidades sintéticas (50 compradores y propietario). Un timeout interrumpió inicialmente la eliminación de compradores; se reanudó con comprobación de identidad, reintentos y seguimiento por usuario. La limpieza final quedó confirmada en ambos recibos. Las secuencias de folios de staging avanzaron normalmente; no se reiniciaron.

El primer intento se detuvo antes de crear pedidos porque el generador confundía las claims de claves API con las de sesiones Auth. Se corrigió para validar el emisor exacto de staging y la identidad del comprador, se añadieron pruebas del guard y se limpiaron sus fixtures. Ese intento se conserva separado como `2026-11-01-checkout-load-preflight`; no es un fallo del checkout de la app.

## Qué falta para una conclusión de lanzamiento

1. Repetir el escenario desde un generador estable y cercano a Supabase; aumentar la duración a 15–30 minutos y capturar p99 y códigos de cada fallo. Determinar la causa de los timeouts y de las lecturas lentas antes de asumir que basta con escalar la base.
2. Ensayo con la app real: buscar negocio, extras, notas, confirmar, desconexión/reintento, cancelación y capturas en Sentry. Comprobar doble toque y repetición tras timeout; este ensayo no acredita idempotencia de reenvíos.
3. Añadir repartidor/negocio conectados por Realtime: recepción, aceptación, asignación, rechazo/reasignación, salida, GPS, retorno y liquidación, con invariantes de custodia y efectivo. No se probaron escrituras financieras bajo carga en esta ejecución.
4. Probar la cola con un proveedor simulado y sin enviar push o correos reales. Cola cero aquí se debe a que las cuentas no tenían dispositivos: no demuestra rendimiento del worker con fan-out real.
5. Contrastar las capacidades de staging y producción; no extrapolar resultados entre máquinas/planes distintos sin comparación.

## Reproducibilidad y evidencias

Scripts: `ops/load/checkout.js`, `checkout-runner.mjs`, `staging-credentials.mjs`, `cleanup-buyers.mjs` y `summarize-checkout.mjs`. Guardas para destino fijo, JWT del usuario, máximo 50 compradores y 100 lectores; corte por >1% de errores o respuestas inválidas. SLO de creación p95 <2 s y menú p95 <1.5 s. Se exige el número exacto de pedidos y cancelaciones esperado.

Resultados originales y resumen en `release-artifacts/2026-11-01-checkout-load/` de la raíz del workspace: `smoke.json`, `mixed.json`, `verification.json`, `monitoring.json`, `monitoring-summary.json` y `RESULTADO.json`. No contienen cabeceras, contraseñas ni sesiones.

El runner rechaza sobrescribir recibos de una ejecución previa. No borrar esos recibos para saltar una limpieza incompleta: revisar primero sus IDs y estado. La ruta de k6 corresponde al binario oficial 2.3.0 instalado temporalmente para este ensayo.
