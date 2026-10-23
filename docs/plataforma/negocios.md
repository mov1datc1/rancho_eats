# Negocios · 1.4.0
Interfaz adaptable a móvil y tablet, incorporación guiada, identidad PideYa y sonido de pedido. La pantalla de pedidos ordena por antigüedad; cocina recibe tamaño, extras y notas.

Revisar ubicación antes de aceptar o rechazar. Pedidos pendientes: 10 minutos; se puede proponer otra ventana de entrega para aceptación del cliente. Estimar ciclo completo de reparto: ida, entrega, regreso y caja. Esa estimación limita las reservas según el turno del repartidor.

Ajustes permite dar de alta repartidores propios o temporales con nombre, teléfono y código individual. El negocio valida personalmente identidad/confianza; la app no sustituye esa verificación. El repartidor activa su disponibilidad. Una salida física a la vez, hasta dos reservas y liquidación antes de otra salida.

Caja registra dinero realmente recibido y comprobación. Diferencias generan incidencia y no liberan la custodia. Mercancía no entregada requiere confirmar devolución. Una incidencia necesita nota al cambiar de estado; resolver una incidencia no liquida automáticamente efectivo.

Surtido: retirar faltantes; no inventar sustituciones. Cantidad parcial solo si fue permitida; total se recalcula a la baja. Pedidos completamente sin existencias se cancelan sin cobro.

En esta primera versión, custodia única y caja se aplican tanto a propios como temporales. Las rutas con varias entregas simultáneas no están habilitadas; evitan repartir efectivo entre pedidos sin conciliación.

## Ubicación al solicitar el alta — 22/10/2026

El registro web pide dirección, instrucciones para encontrar la entrada y un pin seleccionado en el mapa (o GPS), con confirmación explícita. El registro comienza pendiente y cerrado; PideYa verifica la ubicación antes de activar. El dueño no puede autoaprobarse ni mover unilateralmente el punto de recogida. No se permiten cambios de ubicación con pedidos activos. Los negocios activos anteriores no se desactivan por esta actualización. La configuración nativa existente de horarios y radio continúa funcionando; la revisión del domicilio se gestiona con PideYa. El radio de cobertura sigue siendo distancia geográfica, no distancia de carretera ni garantía de acceso rural.
