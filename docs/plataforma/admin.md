# Administración de PideYa
Web existente: https://www.pide-ya.app . El rol se valida mediante admin_profiles; ser dueño de un negocio no otorga administración global.

Operación: filtros por negocio, categoría, estado y periodo; métricas de tiempos sobre datos válidos; alertas de respuesta/demora; consulta y seguimiento de incidencias; conciliación de ciclos de efectivo.

Categorías: cerrado, piloto o público. Piloto requiere categoría + negocio + correo exacto del cliente. Ocultar también restringe descubrimiento y admisión en servidor. Mantener restaurantes públicos al inicio y liberar otras categorías con pruebas autorizadas. No conceder roles globales a cuentas de negocio.

Las métricas se agregan en el servidor con filtros por período, negocio, categoría y estado; incluyen aceptación, entrega, incidencias, ciclos sin liquidar y efectivo pendiente. El detalle visual carga hasta 5.000 pedidos y muestra aviso si se alcanza ese límite. No se ha validado capacidad de 50.000 usuarios; exige prueba de carga e infraestructura dimensionada.

Incidencia abierta/atendiendo/esperando devolución/resuelta. Registrar razón y siguiente acción: dirección, ausencia, acceso, avería, señal, rechazo, efectivo o devolución. Demora superior a dos horas genera incidencia, no cancelación de una entrega en camino.

Categorías nuevas quedan cerradas por defecto. El botón Abrir piloto permite pruebas restringidas; publicar para todos requiere elegir Pública en Operación.

## Pedidos y finanzas · actualización 22 de octubre

Pedidos consulta en servidor por negocio, estado y fechas CDMX. Atajos: día, quincena (1–15 o 16–fin de mes), mes, trimestre y año; fecha de referencia permite años anteriores. Rango personalizado inclusive por día, límite superior exclusivo al siguiente día. Paginación de 50 con conteo exacto y CSV de la página visible. Se muestran productos, envío y comisión por separado.

Comisiones tiene su propio corte de consulta, independiente de las tarifas. Resume todos los pedidos entregados del periodo (fecha de creación), sin el límite de 1.000 filas del cliente. El cobro confirmado requiere referencia y se liga a cada pedido mediante `commission_allocations`; serializa por negocio y rechaza un saldo cambiado o un corte superpuesto ya cobrado. No ejecuta transferencias ni registra automáticamente dinero recibido. Solo se permite registrar el saldo completo del corte; pagos parciales y reversos requieren un flujo futuro de conciliación.

Los pagos antiguos carecen de detalle por pedido. Sus periodos se excluyen de nuevos cobros y aparecen como «Históricas por revisar»: no se asume que cada importe haya sido conciliado. Revisar los comprobantes antes de corregir estos registros. Los recibos nuevos son inmutables desde el navegador. El historial muestra hasta 200 cobros que intersectan el corte. CSV de comisiones exporta todos los balances del reporte.

## Campañas

Nuevo estudio separado de las promociones históricas. Audiencias: sin pedido en 30 días, sin primer pedido, compradores del patrocinador o todos los clientes con dispositivo activo. Programación CDMX de 09:00 a 19:59; hasta cuatro envíos separados por al menos siete días. Por cuenta y entre todas las campañas: una reserva cada 72 horas, máximo dos en siete días, un solo dispositivo por envío. Los usuarios excluidos no reciben una ráfaga después. La publicidad utiliza prioridad baja en la cola durable, recibos de proveedor y caducidad de dos horas o las 20:00, lo que ocurra antes.

La cancelación detiene trabajos pendientes; no puede retirar mensajes aceptados por el proveedor o que ya estaban enviándose. «Procesada» significa que se evaluó la audiencia; «Aceptadas» son recibos del proveedor, no lectura del usuario. Los antiguos broadcasts quedan deshabilitados y sus registros se conservan sin reenviarlos. No se creó ninguna campaña real durante la implementación.

Compatibilidad del cliente 1.3.0: tocar publicidad abre la app, sin navegación a pedidos ni enlace directo al patrocinador. Las preferencias `marketing_preferences` permiten excluir cuentas y el usuario autenticado puede administrar su propio registro; la pantalla móvil para gestionarlas sigue pendiente. Los permisos del sistema operativo también controlan la recepción. La segmentación por cobertura geográfica y atribución de compras a campañas requieren una fase posterior.
