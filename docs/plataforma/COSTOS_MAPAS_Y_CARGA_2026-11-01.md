# Costos de mapas, GPS y pruebas de carga — 1 noviembre 2026

Este documento audita el código disponible y simula consumo. No es una lectura de facturación de Google Cloud ni acredita capacidad de producción. La calculadora funciona localmente, sin llamadas externas, en `release-artifacts/2026-11-01-maps-load/simulador-costos.html` de la raíz del workspace.

## Qué consume PideYa

| Acción | Implementación revisada | Impacto |
| --- | --- | --- |
| Mostrar negocios dentro de cobertura | `HomeScreen.tsx`, `deliveryCoverage.ts`: filtro Haversine local con el radio de cada negocio | Cero llamadas de Google; hay descarga de catálogo desde Supabase |
| Listar negocios | `services/restaurants.ts`: RPC `customer_businesses`, sin parámetros de distancia ni paginación | Carga de PostgreSQL y egreso de datos |
| Mapa móvil | `react-native-maps`, Google en Android | SKU Maps SDK sin cargo en la lista consultada; no incluye rutas ni otros SKU |
| Posición del repartidor | `expo-location` → RPC `driver_update_location` | Escrituras/CPU/egreso y mensajes Realtime en Supabase; no equivale a Google Geolocation API |
| Seguimiento del cliente | `OrderTrackingMap.tsx` → `directions.ts` | Directions Legacy inicial y cada 30 s; referencia negocio–cliente adicional al salir |
| Elegir dirección | `Location.geocodeAsync` / `reverseGeocodeAsync` | Servicios de geocodificación del sistema; no se presupone facturación directa como Google Geocoding API |
| Algunas vistas web de pedido | `MapViewer.tsx`, `googleMaps.ts` | Static Maps si hay clave; cambios de coordenadas pueden cambiar URL y generar más solicitudes |
| Mapa administrativo | `InteractiveMap.tsx` | Leaflet con teselas OSM por defecto o proveedor configurable; no carga Google Maps JavaScript |
| Abrir Ruta en la app externa | URL Google Maps/Waze | No es una petición al endpoint Directions de PideYa |

GPS y Haversine no proporcionan kilómetros por carretera ni ETA. En rancherías, una distancia corta en línea recta puede implicar un trayecto largo. Mantener explícita esa diferencia al definir cobertura y tarifas. No se necesita Google Places para buscar negocios que ya pertenecen al catálogo propio.

## Escenarios mensuales

Supuestos: 30 días, todos los pedidos a domicilio, un espectador con seguimiento abierto durante 20 minutos **en camino**, sin espera previa; 42 llamadas Directions por pedido (inicial, referencia y 40 de temporizador); 2 solicitudes Static Maps por pedido; Google Geocoding separado en cero. La propuesta usa 6 rutas por pedido. Esta reducción **no está implementada**.

| Pedidos/día | Pedidos/mes | Rutas actuales | Google actual USD | Google propuesto USD |
| --- | --- | --- | --- | --- |
| 100 | 3,000 | 126,000 | 554 | 40 |
| 500 | 15,000 | 630,000 | 2,610 | 440 |
| 1,000 | 30,000 | 1,260,000 | 5,190 | 870 |

Tarifas globales pay-as-you-go consultadas: Directions Legacy, 10,000 eventos mensuales gratuitos, USD 5/1,000 hasta 100,000 y USD 4/1,000 siguientes. Static Maps: 10,000 gratuitos y USD 2/1,000 en el primer tramo pagado. Se calculan tramos progresivos por SKU. La franquicia se comparte con el uso de la cuenta de facturación, no se multiplica por app/proyecto. [Lista oficial](https://developers.google.com/maps/billing-and-pricing/pricing).

Los totales incluyen solo rutas y el supuesto de Static Maps. No incluyen IVA, otros productos, uso de otros proyectos, planes o descuentos. Espera antes de salir, reaperturas, segundo espectador y reintentos pueden elevarlos; clientes que nunca abren seguimiento los reducen. A USD 20 MXN **hipotéticos**, USD 554 serían MXN 11,080. La calculadora permite cambiar el tipo de cambio: no usa una cotización en vivo.

La API usada está en estado Legacy; cualquier migración debe comprobar disponibilidad y precios de Routes API, sin cambiarla a ciegas. [Documentación Directions](https://developers.google.com/maps/documentation/directions/usage-and-billing).

## GPS y Supabase

Con un solo emisor cada 10 s durante esos 20 minutos, incluyendo el envío inicial:

| Pedidos/día | Escrituras GPS/mes aproximadas | Entregas Realtime a 2 receptores |
| --- | --- | --- |
| 100 | 363,000 | 726,000 |
| 500 | 1,815,000 | 3,630,000 |
| 1,000 | 3,630,000 | 7,260,000 |

No son todos los mensajes de la plataforma. El código inicia un watch de foreground y un task de background, sin deduplicador común en `updateDriverLocation`. Los intervalos del SO no son un límite estricto de peticiones y el radio por sí solo no garantiza una reducción porcentual. El fan-out real depende de canales, suscriptores y escrituras. Medirlo antes de convertirlo en factura.

Como referencia, Supabase publica 5 millones de mensajes incluidos en Pro y USD 2.50 por millón adicional; 500 conexiones pico incluidas. Aun así, no se puede deducir la factura completa de contar GPS: faltan plan real, CPU, egreso, almacenamiento y otros servicios. [Realtime precios](https://supabase.com/docs/guides/realtime/pricing), [límites de conexiones y throughput](https://supabase.com/docs/guides/realtime/limits).

## Prioridad de optimización

1. Rutas: detener temporizador fuera de pantalla/segundo plano y al terminar pedido; no recalcular repetidamente negocio–cliente inmóvil antes de salir. Evitar llamadas duplicadas en vuelo. Usar desplazamiento relevante (p. ej. 150–250 m), desvío y tiempo mínimo; como punto de partida, objetivo de 6 rutas por 20 min, validando que el ETA siga siendo útil. No persistir contenido de Google en una caché genérica sin revisar sus condiciones.
2. GPS: un único control de envío común a foreground/background, orden de timestamps y una sola solicitud en vuelo. Movimiento: empezar evaluando 10–15 s y 30–50 m; detenido: heartbeat 60 s. Conservar margen respecto a la presentación de señal antigua (2 min), pantalla de navegación y requisitos de custodia. Medir precisión, batería y cobertura en dispositivos reales.
3. Catálogo: RPC paginada con coordenadas y filtro de cobertura en servidor. A escala, bounding box y `ST_DWithin` sobre `geography`, índice GiST, conservando radio propio de negocio y permisos de categoría. Comprobar `EXPLAIN (ANALYZE, BUFFERS)` y latencia antes de elegir índices; no hacer una consulta Google por negocio. Caché de catálogo por área y versión con invalidación de disponibilidad; precios/cobertura finales siempre validados por servidor.
4. Static Maps: no regenerar una imagen con cada punto GPS. Usar el mapa persistente donde corresponda. Las teselas OSM públicas no son una CDN comercial ilimitada; elegir proveedor con términos/cuota acordes al crecimiento, conservar atribución y no incluirlo en las pruebas de carga. [Política oficial de teselas](https://operations.osmfoundation.org/policies/tiles/).
5. Control: separar claves por Android/iOS/web/servidor y restringir APIs, paquete/certificado o dominio según corresponda. No abrir una clave móvil para usarla como clave de servidor sin restricciones. Proxy de rutas autenticado con cuota por usuario/pedido, presupuesto y fallback de estado/GPS cuando no haya ETA.

## Visibilidad real de gastos

Falta acceso a la facturación de Google Cloud para confirmar: cuenta/proyectos, SKU habilitados, consumo últimos 30 días, descuentos, restricciones de claves y cuotas. No se cambiaron presupuestos ni claves durante esta auditoría.

Configurar avisos al 50/80/100% de un presupuesto acordado y límites diarios por API. Los presupuestos de **solo alertas** no detienen el gasto. Las cuotas pueden cortar el servicio, por lo que deben conservar un fallback que permita entregar sin una ruta/ETA nueva. [Control de costos de Maps](https://developers.google.com/maps/billing-and-pricing/manage-costs).

Exportar Cloud Billing a BigQuery y agrupar por fecha/proyecto/SKU para un tablero posterior. Complementar con contadores propios de intentos/éxitos/fallos de rutas, tiempo visible, envíos GPS aceptados y bytes de catálogo. No registrar claves ni coordenadas o domicilios completos en telemetría. Un contador local no sustituye los eventos facturados por Google.

## Prueba de carga

Se usa k6 local (sin servicio de pruebas de pago). Escenario `ops/load/browse.js`: catálogo y menú públicos de staging, 2 peticiones por recorrido y 10 s de pausas; progresión 5 usuarios en smoke, y 10/25/50/100 en ramp. 100 usuarios virtuales aquí no son 100 pedidos por segundo ni 100 conexiones Realtime. Máximo teórico sostenido cercano a 20 peticiones/s, menor con latencia.

El destino está fijado a staging; no se permite producción ni claves privilegiadas en las peticiones de carga. Corte si falla más del 1% o se recibe más del 1% de respuestas inválidas. SLO p95 HTTP <1.5 s. Preflight exige catálogo y menús no vacíos; las fallas del preflight no acreditan un límite de capacidad.

Datos sintéticos: 100 negocios, 30 productos por negocio. Se aprueban tras insertarlos: los triggers de alta los dejan pendientes incluso con servicio. No se crean pedidos, incidencias, cobros, mensajes push ni correos. Credencial de servicio solo en el proceso de fixtures; las peticiones de k6 usan una clave pública de staging. Los resultados guardan agregados sin cabeceras ni contenidos personales.

Ejecución, con k6 instalado y variables obtenidas de forma privada:

```sh
export STAGING_URL=https://rganzksyljjerfuowodi.supabase.co
export FIXTURE_PATH=/ruta/privada/fixtures.json
node ops/load/fixtures.mjs seed
# STAGING_ANON_KEY se suministra mediante entorno; no pegarla en logs o Git.
LOAD_PROFILE=smoke SUMMARY_PATH=smoke.json k6 run --no-usage-report ops/load/browse.js
LOAD_PROFILE=ramp SUMMARY_PATH=ramp.json k6 run --no-usage-report ops/load/browse.js
# Retirar únicamente las fixtures del recibo de esta ejecución.
node ops/load/fixtures.mjs cleanup
```

Consultar resultados en `release-artifacts/2026-11-01-maps-load/`. Los intentos iniciales sin datos públicos disponibles no son un ensayo de capacidad aprobado. El informe de resultados separa preparación, fallas de transporte y carga completada.

Resultado de la ejecución válida: pico observado de 100 VUs, 1,761 solicitudes, 861 recorridos completos, p95 HTTP global de 794.6 ms, cero errores HTTP y cero respuestas inválidas. Pasaron todos los umbrales. La carga duró aproximadamente 3.5 minutos, con 30 segundos sostenidos en 100 VUs; no es una prueba prolongada. El generador recibió unos 93.8 MB. Se confirmó la limpieza de los 100 negocios, 3,000 productos, categoría QA y cuenta sintética.

Esta prueba no valida checkout/custodia concurrentes, WebSockets, push, Sentry, rendimiento de Android, batería ni mapas. Esas fases necesitan usuarios/pedidos sintéticos y proveedor de notificación simulado; no bombardear Google Maps para medir la capacidad propia. La prueba de capacidad final debe salir de un generador estable y cercano a Supabase, con métricas de CPU, conexiones, consultas lentas, egreso y errores de aplicación correlacionadas. [Guía de k6](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/ramping-vus/).
