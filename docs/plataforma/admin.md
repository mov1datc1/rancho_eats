# Administración de PideYa
Web existente: https://www.pide-ya.app . El rol se valida mediante admin_profiles; ser dueño de un negocio no otorga administración global.

Operación: filtros por negocio, categoría, estado y periodo; métricas de tiempos sobre datos válidos; alertas de respuesta/demora; consulta y seguimiento de incidencias; conciliación de ciclos de efectivo.

Categorías: cerrado, piloto o público. Piloto requiere categoría + negocio + correo exacto del cliente. Ocultar también restringe descubrimiento y admisión en servidor. Mantener restaurantes públicos al inicio y liberar otras categorías con pruebas autorizadas. No conceder roles globales a cuentas de negocio.

Las métricas se agregan en el servidor con filtros por período, negocio, categoría y estado; incluyen aceptación, entrega, incidencias, ciclos sin liquidar y efectivo pendiente. El detalle visual carga hasta 5.000 pedidos y muestra aviso si se alcanza ese límite. No se ha validado capacidad de 50.000 usuarios; exige prueba de carga e infraestructura dimensionada.

Incidencia abierta/atendiendo/esperando devolución/resuelta. Registrar razón y siguiente acción: dirección, ausencia, acceso, avería, señal, rechazo, efectivo o devolución. Demora superior a dos horas genera incidencia, no cancelación de una entrega en camino.

Categorías nuevas quedan cerradas por defecto. El botón Abrir piloto permite pruebas restringidas; publicar para todos requiere elegir Pública en Categorías u Operación.

## Pedidos y finanzas · actualización 22 de octubre

Pedidos consulta en servidor por negocio, estado y fechas CDMX. Atajos: día, quincena (1–15 o 16–fin de mes), mes, trimestre y año; fecha de referencia permite años anteriores. Rango personalizado inclusive por día, límite superior exclusivo al siguiente día. Paginación de 50 con conteo exacto y CSV de la página visible. Se muestran productos, envío y comisión por separado.

Comisiones tiene su propio corte de consulta, independiente de las tarifas. Resume todos los pedidos entregados del periodo (fecha de creación), sin el límite de 1.000 filas del cliente. El cobro confirmado requiere referencia y se liga a cada pedido mediante `commission_allocations`; serializa por negocio y rechaza un saldo cambiado o un corte superpuesto ya cobrado. No ejecuta transferencias ni registra automáticamente dinero recibido. Solo se permite registrar el saldo completo del corte; pagos parciales y reversos requieren un flujo futuro de conciliación.

Los pagos antiguos carecen de detalle por pedido. Sus periodos se excluyen de nuevos cobros y aparecen como «Históricas por revisar»: no se asume que cada importe haya sido conciliado. Revisar los comprobantes antes de corregir estos registros. Los recibos nuevos son inmutables desde el navegador. El historial muestra hasta 200 cobros que intersectan el corte. CSV de comisiones exporta todos los balances del reporte.

## Campañas

Nuevo estudio separado de las promociones históricas. Audiencias: sin pedido en 30 días, sin primer pedido, compradores del patrocinador o todos los clientes con dispositivo activo. Programación CDMX de 09:00 a 19:59; hasta cuatro envíos separados por al menos siete días. Por cuenta y entre todas las campañas: una reserva cada 72 horas, máximo dos en siete días, un solo dispositivo por envío. Los usuarios excluidos no reciben una ráfaga después. La publicidad utiliza prioridad baja en la cola durable, recibos de proveedor y caducidad de dos horas o las 20:00, lo que ocurra antes.

La cancelación detiene trabajos pendientes; no puede retirar mensajes aceptados por el proveedor o que ya estaban enviándose. «Procesada» significa que se evaluó la audiencia; «Aceptadas» son recibos del proveedor, no lectura del usuario. Los antiguos broadcasts quedan deshabilitados y sus registros se conservan sin reenviarlos. No se creó ninguna campaña real durante la implementación.

Compatibilidad del cliente 1.3.0: tocar publicidad abre la app, sin navegación a pedidos ni enlace directo al patrocinador. Las preferencias `marketing_preferences` permiten excluir cuentas y el usuario autenticado puede administrar su propio registro; la pantalla móvil para gestionarlas sigue pendiente. Los permisos del sistema operativo también controlan la recepción. La migración 050 añadió segmentación por cobertura y asociación temporal de compras posteriores. No representa atribución causal, aperturas ni clics; ver la sección de campañas por comportamiento.

## Catálogo, reportes, territorio y protección — 22/10/2026

Categorías usa ocho iconos SVG originales de PideYa con una paleta verde uniforme. El editor acepta SVG, PNG, WebP y JPEG de hasta 2 MB; los SVG se validan con una lista limitada de elementos y atributos, y todo archivo subido se convierte a PNG de 512 × 512. El bucket público permite escritura solo al administrador. Las categorías nuevas comienzan cerradas; el editor distingue cerrado, piloto y público. Cerrar conserva pedidos existentes. No se permite renombrar categorías usadas ni cambiar el flujo con pedidos activos. La APK actual del cliente conserva sus imágenes locales: esta entrega cambia el panel y publica los recursos, no actualiza esa APK.

Reportes calcula en servidor el periodo completo (máximo tres años), con filtros de negocio y categoría: pedidos, ventas entregadas, comisiones generadas, ticket promedio, entregas, cancelaciones, clientes recurrentes, incidencias y efectivo pendiente. Incluye tendencia diaria, motivos de cancelación, ranking por negocio y exportación CSV. Las duraciones solo usan timestamps válidos; ausencia de datos no equivale a cero minutos. Las comisiones generadas no son pagos recibidos: la conciliación corresponde a Comisiones.

Mapa en vivo usa Leaflet con zoom y desplazamiento sobre México. Distingue negocios activos, pendientes y suspendidos, y tiene una pestaña para pedidos activos. Consulta cada 15 segundos mientras está visible; muestra hasta 2.000 negocios y 1.000 pedidos activos. No inventa coordenadas ausentes. La ubicación del repartidor es la última disponible: una señal sin hora o de más de dos minutos se considera antigua. La línea origen-destino no es una ruta vial. Perder señal no cancela pedidos.

El alta web requiere dirección escrita, selección del pin y confirmación explícita del acceso. Un negocio nuevo queda pendiente y cerrado. El administrador verifica dirección, pin e instrucciones desde el mapa antes de activarlo. Los negocios ya activos se conservan; sus ubicaciones pueden revisarse gradualmente. No se cambia el punto de recogida con pedidos activos. La app nativa no ofrece todavía una solicitud autónoma de cambio de domicilio.

Anti-spam limita por cuenta autenticada: ocho pedidos en diez minutos y cuatro pendientes vigentes. Señales de volumen y cancelaciones se revisan, no producen sanciones automáticas. El administrador puede reportar un pedido, registrar su resolución y aplicar restricciones temporales de 1 hora a 30 días, con motivo, auditoría y revocación. No se bloquea a todos los usuarios de una IP compartida ni se confía en una IP declarada por el cliente. El filtrado de ataques por IP debe hacerse en infraestructura que conozca la IP real; no se implementó un WAF en esta entrega.

### Referencias y operación del mapa

- [Uber: dirección, pin e instrucciones de recogida](https://help.uber.com/merchants-and-restaurants/article/updating-your-pin-location-service-hours-address-and-phone-number?nodeId=441508ba-1ac4-45a2-8fe4-088893dcf492).
- [DoorDash: negocios y sucursales](https://developer.doordash.com/en-US/docs/drive_classic/reference/businesses_and_stores/).
- [Leaflet 1.9.4](https://leafletjs.com/reference.html).
- [Política de tiles de OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/): atribución visible, sin descarga masiva; el servicio público no ofrece SLA. `VITE_MAP_TILE_URL` permite cambiar de proveedor; adaptar también la atribución al proveedor contratado antes de hacerlo.
- [Nominatim](https://operations.osmfoundation.org/policies/nominatim/): no se añadió autocompletado contra su servicio público. El alta nueva usa dirección, pin y GPS solicitado por el usuario.

## Campañas por comportamiento — migración 050

Desde Reportes se puede abrir Promociones conservando el negocio seleccionado. El alcance es ese negocio, o toda PideYa si no hay patrocinador. La segmentación utiliza exclusivamente pedidos DELIVERED asociados a `client_user_id`; no identifica clientes por nombre o teléfono. Una entrega histórica sin usuario no cuenta como historial identificable, y el panel muestra esa limitación.

- Primera compra: cero entregas en el alcance.
- Recuperación: al menos una entrega histórica y ninguna desde el umbral elegido (15, 30, 60, 90, 180 o 365 días).
- Ocasionales: entre una compra y el umbral de frecuentes menos uno, dentro de la ventana.
- Frecuentes: al menos el número configurado de entregas en la ventana.
- Mayor gasto: subtotal de productos entregados por encima del mínimo, sin envío ni comisión.

Calcular audiencia muestra cuentas con push, coincidencias y elegibles, junto con exclusiones. Las campañas patrocinadas requieren negocio activo, acceso público/piloto autorizado y dirección predeterminada guardada o última ubicación de entrega dentro del radio del negocio. Sin ubicación, se excluye; no es GPS actual ni garantía de acceso vial. También se excluyen cuentas restringidas, publicidad desactivada, pedidos/incidencias abiertos y límites de frecuencia. Las preferencias, cobertura y pertenencia al segmento vuelven a comprobarse al preparar y despachar cada envío. Los recibos de proveedor se siguen procesando aunque la persona ya haya comprado.

Los límites siguen siendo una promoción cada 72 horas, dos en siete días, un dispositivo y horario CDMX 09–20. La vista previa es una estimación, no una reserva ni garantía de recepción; solo permite programar si existe audiencia elegible en ese momento. Las campañas antiguas también pasan por estas exclusiones. La audiencia `inactive30` ahora significa comprador que no ha vuelto, no incluye personas sin primera compra.

El precio del patrocinio es referencia del acuerdo comercial, no cargo, factura ni pago recibido. Pedidos posteriores: pedidos entregados creados dentro de siete días de una notificación aceptada por el proveedor; cada pedido se asigna solo al contacto aceptado más reciente compatible con su negocio. Es asociación temporal, no prueba causal ni apertura/clic. No se implementaron descuentos automáticos, cupones ni una suscripción de cobro al negocio. La campaña mantiene texto y condiciones que el administrador debe acordar con el patrocinador.

La investigación y el backlog priorizado están en [INVESTIGACION_DELIVERY_2023_2026.md](INVESTIGACION_DELIVERY_2023_2026.md).
