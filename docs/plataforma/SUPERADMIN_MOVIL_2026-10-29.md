# Superadmin móvil — 29 de octubre de 2026

El panel `/administrador` ahora adapta navegación, registros y formularios al tamaño de pantalla.

- Menú lateral con botones accesibles en escritorio. En tablet y móvil, selector fijo de las 13 secciones, agrupadas por actividad. Cambiar de sección vuelve al inicio.
- Color morado de PideYa, cabecera compacta, sesión adaptable y áreas táctiles de al menos 44 px en móvil.
- Pedidos, comisiones y cobros, campañas, reportes, restricciones, incidencias técnicas y operación de entregas comparten `ConsoleTable`. Conserva una sola tabla semántica; en móvil cada fila se presenta como tarjeta con los encabezados como etiquetas de campo. Se conservan estados, acciones, filtros, exportación y paginación.
- Formularios móviles en una columna; campos de 16 px para evitar el zoom automático de iOS, fechas contenidas, textos largos que pueden partirse y margen al enfocar campos bajo la navegación fija.
- Tarifas, zonas especiales, tarjetas de negocio, métricas, editor de comisiones, categorías y mapa adaptados al ancho disponible. No se alteran cotización, permisos ni reglas de liquidación.

## Verificación

- `npm run build`: TypeScript, guard de duplicados y Vite correctos.
- `node --test tests/*.test.cjs`: 15 pruebas correctas, incluidas tres nuevas sobre etiquetas de tabla, celdas condicionales y colspan.
- Revisión visual local con componentes reales y datos ficticios, sin escrituras ni conexión a datos de producción: 320 y 390 px (móvil), 768 px (tablet), 1440 px (escritorio). Sin desbordamiento de página; campos móviles 16 px; tabla y menú lateral conservados en escritorio.
- Evidencia: `release-artifacts/2026-10-29/admin-mobile-tariffs.png` y `admin-mobile-orders.png`. Son capturas de revisión con datos de ejemplo, no información de clientes.
- No sustituye una prueba en Safari/iOS y Chrome/Android físicos.

## Publicación

Vercel: `dpl_c6WbVGK16uAg3howPHU8886Qta85`, producción READY, alias `www.pide-ya.app`. Ruta pública habitual: https://pide-ya.app/administrador. Solo cambió la web; los APK entregados continúan vigentes.

Verificación autenticada del despliegue: HTML entrega el bundle nuevo `index-DlbqO5w-.js`; JavaScript contiene selector móvil, etiquetas de registros y backend de producción. CSS publicado coincide exactamente con el build local. Recibo: `release-artifacts/2026-10-29/admin-mobile-production-check.json`. No se modificó Deployment Protection.
