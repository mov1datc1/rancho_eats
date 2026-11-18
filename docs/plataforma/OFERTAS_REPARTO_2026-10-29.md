# Ofertas de reparto y recogida · implementación local

Implementado el 29 de octubre de 2026. Pendiente de despliegue coordinado y prueba en dispositivo. La migración 056 no se aplicó al proyecto alojado.

## Flujo

1. Negocio revisa ubicación y capacidad, y acepta el pedido del cliente.
2. Envía una oferta a un repartidor autorizado con turno vigente. La oferta reserva un cupo durante 90 segundos; el RPC admite 30–300 segundos.
3. El repartidor acepta o rechaza con motivo. Rechazo o liberación excluyen nuevas ofertas del mismo pedido a esa persona durante 10 minutos. No se desactiva su perfil ni se impone una sanción.
4. Aceptar confirma una reserva, no la recogida. Puede liberar la reserva con motivo mientras no haya custodia.
5. Después de marcar el pedido como listo, cuando le entrega físicamente el paquete, el negocio confirma la entrega. En ese momento se crea la custodia y quedan bloqueados cambio, liberación y cancelación ordinaria.
6. El repartidor confirma recepción e inicia la ruta. El servidor valida que el paquete le fue entregado y que la asignación siga vigente.
7. Entrega/cobra, regresa y liquida. Una diferencia de caja conserva la custodia. Resolver una incidencia no libera el efectivo.

No hay selección automática de conductor ni ofertas abiertas a desconocidos. El negocio elige dentro de su equipo; cada pedido tiene una oferta vigente. Una persona puede reservar hasta dos pedidos, con una sola custodia física por identidad global.

## Respuestas a fallos

- Oferta vencida: no puede aceptarse después de su plazo. El mantenimiento retira el cupo en el siguiente ciclo (cada minuto) y avisa al negocio. La app consulta ofertas aunque no llegue push.
- Reasignación: requiere motivo, estado anterior esperado y ausencia de custodia. Las carreras se serializan por negocio; identidad, perfil y turno se bloquean donde afectan a la capacidad.
- Pausa o vencimiento: libera reservas sin recogida; conserva todo paquete/efectivo bajo custodia, incluida una entrega física confirmada por negocio pero todavía no iniciada por el conductor.
- Sin alternativa de reparto: el negocio puede cancelar con motivo y aviso al cliente únicamente pedidos en efectivo sin custodia. No se cancela un cobro ni una mercancía en manos del conductor.
- Perfil revocado sin recogida: el mantenimiento retira sus ofertas y reservas sin tocar una custodia, y avisa al negocio.
- Perfil revocado con custodia: no recibe nuevas ofertas ni turnos. Los RPCs de responsabilidad permiten resolver su custodia, y el negocio puede registrar una devolución física supervisada y conciliarla. Al cerrarla, deja de tener acceso mediante el código revocado.
- Mercancía devuelta sin entrega: la conciliación actual cancela el pedido. No se reabre ni crea automáticamente una segunda salida del mismo pedido.
- Dirección diferente en ruta: no hay edición ni transferencia silenciosa; registrar incidencia y resolver con el negocio. No se implementó un nuevo flujo para autorizar otro domicilio.
- El cliente ve “Esperando confirmación del repartidor” mientras la oferta está pendiente. El número y nombre del candidato no se presentan como conductor confirmado. Reasignar limpia las coordenadas del conductor anterior.

## Superficies actualizadas

- PideYa Negocios: capacidad y cola desde RPC, oferta, motivo de cambio, estado de respuesta, entrega física, retirada de reserva, devolución supervisada y cancelación por falta de reparto sin custodia.
- PideYa Repartidor: bandeja de ofertas, aceptación/rechazo, liberación previa, espera de entrega física y confirmación de recogida.
- Cliente: distingue oferta pendiente de conductor confirmado.
- Portal web: usa los mismos RPCs para oferta, respuesta, entrega física y devolución supervisada. El RPC antiguo de consulta conserva su firma y delega a la lectura segura.
- Worker: descarta push de ofertas reasignadas o vencidas. El vencimiento de la notificación coincide con el de la oferta y se invalida al responder.

## Verificación

`tests/dispatch/run.mjs` fija explícitamente socket local, puerto 55449 y base `pideya_offers_qa`; no acepta URLs alojadas. Recrea únicamente sus esquemas desechables. Requiere PostgreSQL local y usa un fixture de contratos de las tablas involucradas, las funciones reales de migraciones 037/054/056 y los triggers de notificación pertinentes. No sustituye probar una restauración completa en staging.

Incluye aceptación idempotente entre dos dispositivos, dos operadores compitiendo, pausa contra oferta, entrega física contra reasignación, cupos de cola, rechazo/reoferta, vencimiento, permisos de negocio y conductor, acceso anónimo a helpers, custodia, diferencias de efectivo, revocación/recuperación y cancelación sin recogida.

Ejecutar desde la raíz del workspace:

```
node rancho_eats/tests/dispatch/run.mjs
npm --prefix pideya-restaurant test
npm --prefix pideya-restaurant run typecheck
npm --prefix rancho_eats run typecheck
```

Pruebas de Repartidor: `node --test tests/*.cjs` desde su repositorio. Pruebas del worker: `npm test` desde `rancho_eats/notification-worker`.

Resultados locales finales: 21 escenarios SQL (con transacciones solapadas para forzar competencia por reservas), 21 pruebas de Negocios, 20 de Repartidor, 37 de Cliente y 23 del worker. TypeScript aprobado en las tres apps y el portal. Revisión visual móvil con datos ficticios para oferta/rechazo y reserva/recogida. Sin envíos push reales ni prueba del ciclo en teléfono.

## Despliegue pendiente

La migración cambia el contrato de asignación. Las aplicaciones antiguas no podrán asignar directamente ni iniciar una salida sin confirmación física. No aplicar solamente la migración en operación activa.

- Verificar en staging una restauración completa y el conjunto de migraciones previas hasta 055.
- Revisar pedidos ON_THE_WAY sin ciclo, perfiles revocados con custodia y reservas existentes. No inventar recogidas ni cobros para corregir datos históricos.
- Compilar y distribuir las apps nuevas; ejecutar expo-doctor antes de EAS según las reglas del workspace. Coordinar migración, portal y worker en una ventana controlada.
- Las reservas previas sin recogida se conservan como ACCEPTED y requieren confirmación física. Se preservan los ciclos, importes y credenciales actuales.
- Verificar el cron, permisos, push con pantalla bloqueada y ciclo completo de efectivo en dispositivos de prueba antes de ampliar el piloto.

No afirmar despliegue ni entrega de notificaciones solo por pasar las pruebas locales.
