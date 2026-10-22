# Administración de PideYa
Web existente: https://www.pide-ya.app . El rol se valida mediante admin_profiles; ser dueño de un negocio no otorga administración global.

Operación: filtros por negocio, categoría, estado y periodo; métricas de tiempos sobre datos válidos; alertas de respuesta/demora; consulta y seguimiento de incidencias; conciliación de ciclos de efectivo.

Categorías: cerrado, piloto o público. Piloto requiere categoría + negocio + correo exacto del cliente. Ocultar también restringe descubrimiento y admisión en servidor. Mantener restaurantes públicos al inicio y liberar otras categorías con pruebas autorizadas. No conceder roles globales a cuentas de negocio.

Las métricas actuales cargan hasta 5.000 pedidos y muestran aviso cuando la muestra es parcial. No son un almacén analítico ni validan capacidad de 50.000 usuarios. Para ese volumen se requiere agregación en servidor y prueba de carga con infraestructura dimensionada.

Incidencia abierta/atendiendo/esperando devolución/resuelta. Registrar razón y siguiente acción: dirección, ausencia, acceso, avería, señal, rechazo, efectivo o devolución. Demora superior a dos horas genera incidencia, no cancelación de una entrega en camino.
