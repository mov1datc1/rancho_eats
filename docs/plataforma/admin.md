# Administración de PideYa
Web existente: https://www.pide-ya.app . El rol se valida mediante admin_profiles; ser dueño de un negocio no otorga administración global.

Operación: filtros por negocio, categoría, estado y periodo; métricas de tiempos sobre datos válidos; alertas de respuesta/demora; consulta y seguimiento de incidencias; conciliación de ciclos de efectivo.

Categorías: cerrado, piloto o público. Piloto requiere categoría + negocio + correo exacto del cliente. Ocultar también restringe descubrimiento y admisión en servidor. Mantener restaurantes públicos al inicio y liberar otras categorías con pruebas autorizadas. No conceder roles globales a cuentas de negocio.

Las métricas se agregan en el servidor con filtros por período, negocio, categoría y estado; incluyen aceptación, entrega, incidencias, ciclos sin liquidar y efectivo pendiente. El detalle visual carga hasta 5.000 pedidos y muestra aviso si se alcanza ese límite. No se ha validado capacidad de 50.000 usuarios; exige prueba de carga e infraestructura dimensionada.

Incidencia abierta/atendiendo/esperando devolución/resuelta. Registrar razón y siguiente acción: dirección, ausencia, acceso, avería, señal, rechazo, efectivo o devolución. Demora superior a dos horas genera incidencia, no cancelación de una entrega en camino.

Categorías nuevas quedan cerradas por defecto. El botón Abrir piloto permite pruebas restringidas; publicar para todos requiere elegir Pública en Operación.
