# Repartidores temporales de confianza

25 octubre 2026. Diseño de siguiente versión y ajustes locales. No desplegado ni compilado; continuar pruebas de repartidores propios en las versiones instaladas.

## Decisión de producto

El negocio aprueba a la persona; la persona decide cuándo está disponible. Un horario habitual de un repartidor propio no prueba que haya llegado ni que tenga batería: tanto propios como temporales confirman turno. No se activa a nadie solo por crearle un código.

Ejemplo: Samuel está aprobado por Forno 21, tiene cuatro horas libres y se activa hasta las 18:00. El negocio ve «Temporal · Disponible · hasta 18:00». Puede reservar pedidos dentro del tiempo restante, pero Samuel lleva uno físico, regresa y liquida antes de otra salida. Si termina antes, pulsa Dejar de recibir: libera reservas sin recoger, conserva entrega/efectivo pendientes y aparece terminando. El cierre efectivo se produce al resolver y liquidar, no al apagar un botón. Puede volver a activarse o definir una nueva hora final; la selección de horas es desde ahora, no suma silenciosamente al turno anterior.

## Lo existente y lo cambiado

Migración 037 ya proporciona OWN/TEMPORARY, identidad por teléfono normalizado, turno único por identidad, hasta 12 horas, dos reservas, una custodia activa, estimación de tiempo de cola/regreso, cobro y liquidación por negocio. El alta de confianza ya permite marcar temporal.

Ajuste local de esta revisión:
- App negocio consulta perfiles, turnos abiertos y ciclos del negocio bajo RLS; muestra libres, recibiendo asignaciones, propio/temporal, fin de turno, en entrega y pendiente de liquidación. Actualiza cada 15 segundos en primer plano y al regresar; muestra error y vacía disponibilidad si no se puede verificar. No pretende presencia GPS o conexión en tiempo real.
- Asignador deshabilita perfiles sin turno que acepte y no haya vencido. La validación de servidor de cola/tiempo sigue siendo definitiva.
- App repartidor ofrece 1/2/4/6 horas y entrada personalizada (5 minutos a 12 horas), distingue turno vencido de disponible y confirma qué sucede al apagar nuevas asignaciones. No elimina custodia ni efectivo.

## Solicitud de incorporación: arquitectura pendiente de implementar

El código actual no sirve para solicitar alta: presupone aprobación. Conservarlo para repartidores existentes. Para nuevos aspirantes, entrada separada «Quiero colaborar con un negocio» y cuenta con teléfono verificado; nunca exponer lista de códigos ni generar credencial a un solicitante anónimo.

Formulario breve: negocio elegido, nombre, teléfono verificado, vehículo, localidad y mensaje/disponibilidad orientativa opcional. No pedir horario fijo obligatorio ni documentos sensibles por un formulario público. La disponibilidad declarada no abre un turno.

Estados de solicitud: PENDING → UNDER_REVIEW → APPROVED / REJECTED; aspirante puede WITHDRAWN. Una solicitud abierta por persona/negocio, límites de frecuencia y sin duplicados. El dueño ve solo solicitudes de su negocio; el aspirante solo las propias. Auditar decisión, fecha, actor y motivo. Revisar confianza con el negocio antes de aprobar manejo de efectivo. No convertir aprobación en una garantía de identidad que el sistema no verificó.

Aprobación transaccional: verificar permiso del dueño, bloquear solicitud, verificar estado, vincular identidad global, crear/reutilizar afiliación TEMPORARY y marcar aprobación de forma idempotente. Solo entonces entregar acceso individual al repartidor aprobado. Revocación suspende nuevas asignaciones y mantiene un camino supervisado para resolver custodia y liquidación; no borrar historial.

Estructura prevista: courier_applications (solicitudes), courier_memberships (vínculo aprobado/suspendido), courier_identities ligada a auth.uid y teléfono verificado; driver_profiles se mantiene como compatibilidad del código legado. Turnos y ciclos reutilizan sus tablas actuales, evitando dos sistemas de caja.

Pendiente crítico: hoy la identidad global se deriva de los últimos diez dígitos de teléfono aportados por el negocio. No equivale a identidad verificada ni impide registros con teléfonos diferentes. Antes de abrir autosolicitud, migrar y verificar identidades, resolver duplicados y probar exclusión de turnos concurrentes. No activar captación pública hasta completar esto.

## Disponibilidad y capacidad de domicilio

Mantener entrega habilitada como decisión explícita del negocio (migración 055 preparada). No reactivar automáticamente por un temporal conectado: podría llevar efectivo, tener cola o no alcanzar a regresar. Mostrar capacidad y sugerir pausar cuando no hay libres; el dueño puede esperar un retorno o usar capacidad que conoce. No apagar pedidos ya aceptados por pérdida de señal ni fin de turno.

Estados visibles: sin turno; disponible; ocupado aceptando reservas; no recibe nuevas; regresando/liquidando; turno vencido. Hora final es compromiso de disponibilidad, no promesa exacta de entrega. Si no alcanza cola + recorrido + regreso, impedir reserva; recalcular con el servidor. Para el piloto mantener una salida física por entrega. Optimizar rutas múltiples posteriormente con trazabilidad de caja separada por pedido.

Siguientes controles de servidor a probar antes del piloto temporal completo: carrera asignar/apagar, liberar reservas al vencer aunque nadie abra la app, idempotencia de reintentos y conciliación con diferencias. Las restricciones actuales son una base, no prueba de que esas carreras estén resueltas. Se requiere regresión con dos conexiones y esquema íntegro antes de habilitar el flujo público.

## Señal y alertas

El estado de turno proviene del servidor, no de tener la app abierta. Si el repartidor pierde red, mostrar último estado confirmado y no presentar una desconexión no guardada como exitosa. Señal antigua es «sin conexión reciente», no abandono. Avisar al negocio de inicio/extensión/fin y efectivo pendiente usando outbox existente, con deduplicación; el panel es autoridad, el push es aviso. Esta integración adicional de eventos no está implementada en este ajuste.

Métricas previstas: propios/temporales disponibles por negocio, minutos ofrecidos y trabajados, reservas rechazadas por tiempo, pedidos esperando repartidor, efectivo esperado/recibido/diferencias, tiempo hasta liquidar, rechazos por falta de capacidad y solicitudes pendientes. No sumar saldo de negocio a ingresos del repartidor.

## Pruebas de aceptación siguientes

Solicitante no aprobado no accede; dueño ajeno no aprueba; doble aprobación no duplica; dos negocios no abren turnos simultáneos; apagar sin custodia libera reservas; apagar con custodia conserva responsabilidad; extender no cambia otro negocio; vencimiento deja de admitir; falta de señal no pierde entrega; liquidación con diferencia no permite otra salida; domicilio pausado mantiene recogida; propios siguen funcionando con sus códigos.

## Referencias consultadas

[Uber: detener nuevas solicitudes durante una entrega](https://help.uber.com/am/driving-and-delivering/article/need-a-break?nodeId=986cadef-2cc9-4587-b85e-53661eddaa4a) separa desconexión de nuevas solicitudes y finalización de la entrega actual.

[Uber: liquidación de efectivo mediante depósitos](https://help.uber.com/driving-and-delivering/article/how-to-settle-your-balance-through-cash-drops?nodeId=c501bdd5-efe0-4624-8dc6-e017b5ae5200) muestra la necesidad de un circuito de conciliación. PideYa usa por ahora retorno al negocio y confirmación de caja, adaptado a su operación rural; no copia los saldos o reglas de Uber.
