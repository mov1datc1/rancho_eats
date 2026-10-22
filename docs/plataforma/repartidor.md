# Repartidor · 1.1.0
Acceso mediante código individual emitido por el negocio. Teléfono validado por negocio vincula identidad operativa para impedir turnos simultáneos con distintos negocios.

Activar disponibilidad por horas (hasta 12), extender o dejar de recibir pedidos. Al detenerse se liberan reservas sin custodia. Un turno vencido sin custodia puede cerrarse al volver a activar. La custodia pendiente impide cambiar de negocio.

Una entrega física activa, hasta dos pedidos reservados. No se inicia otra salida hasta regresar y liquidar. Cobro exacto del total vigente; tarjeta implica cero efectivo de mercancía. Confirmación cobrada queda pendiente de caja. Pedido no entregado: informar regreso con motivo; negocio confirma mercancía.

La confirmación de entrega se persiste localmente antes del envío y se reintenta desde la pantalla del turno. No borrar datos ni reinstalar mientras exista confirmación pendiente. Una regla rechazada por servidor se muestra y requiere revisión; nunca se marca éxito ficticio. Fotografías y reportes de incidencia aún necesitan conexión para enviarse. GPS se envía solo con entrega asignada en camino; señal perdida no equivale a abandono.

Pendiente de evolución: invitaciones de un solo uso, fondos para cambio, liquidación con pérdida autorizada y evidencia fotográfica offline. No forman parte de la liberación actual.
