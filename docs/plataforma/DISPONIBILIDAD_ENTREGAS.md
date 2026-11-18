# Entrega a domicilio y recogida

25 de octubre de 2026. Implementación local pendiente de despliegue. No incluida en Negocios 1.4.1 (11) ni Cliente 1.3.3 (34).

## Operación

- `restaurants.delivery_enabled` es independiente de `is_open`, y vale true por defecto. Cerrado no admite pedidos; abierto con domicilio pausado permite recogida.
- El dueño puede pausar manualmente en Ajustes → Horario y cobertura de la app o en la cabecera del portal web del negocio. No se deduce de turnos: el negocio conoce su capacidad real.
- Pausar no modifica pedidos existentes; el negocio debe resolver los ya recibidos.
- Al entrar al negocio, el cliente ve «Actualmente no tenemos entrega a domicilio, solo para recoger» y una leyenda persistente. La vista con foco revisa cada 30 segundos y al volver a entrar. Al reactivar desaparece el aviso en la siguiente actualización.
- Checkout deshabilita domicilio y muestra la restricción. No cambia la modalidad silenciosamente: el cliente selecciona recogida. Reconsulta antes de enviar; el servidor es la autoridad final ante cambios simultáneos.
- La cobertura existente sigue aplicándose a domicilio; recogida no exige estar dentro del radio.
- El detalle móvil de entrega muestra indicaciones y «Ver punto de entrega en Google Maps» antes de aceptar. No aparece para recogida. Sin coordenadas válidas indica contactar al cliente, sin inventar ubicación.
- El radio no garantiza acceso vial. Se añadieron motivos rápidos de rechazo por distancia/acceso y por falta de repartidor. El cliente recibe el motivo. Se conserva el plazo de diez minutos.

## Despliegue y compatibilidad

Migración 055: columna aditiva y trigger independiente de admisión que conserva los controles actuales de identidad, estado, horario, cobertura y precios. Bloquea solo INSERT de domicilio, incluido NULL legado. Un bloqueo compartido de la fila del negocio serializa admisión con pausa concurrente. La función no puede invocarse directamente por clientes.

Aplicar y validar primero la migración en staging, después producción y distribuir apps/web. Las apps antiguas pueden no mostrar el aviso anticipado, aunque el servidor rechace las entregas pausadas. Probar su mensaje de error antes de activar operativamente esta opción. No se han cambiado negocios ni desplegado código en producción durante esta tarea.

## Validación

TypeScript aprobado en negocio, cliente y web. Negocio: 8 pruebas. Cliente: 31, incluida pausa, recogida, reactivación y cobertura. PostgreSQL 14 local desechable: migración, pausa, recogida, NULL legado, reactivación, preservación de pedido existente y permisos de función. Dos conexiones simultáneas: admisión espera la pausa y rechaza después de su commit. Sin datos reales.

Pendientes: validación visual/física con futuras compilaciones y regresión integral con el esquema completo en staging. La prueba SQL mínima está en `tests/delivery-availability.sql`; ejecutar solo en una base desechable vacía.

## Atención de demoras — revisión 25 octubre

Consulta de solo lectura: #59 READY asignado y #60 READY sin asignar; ambos conservan incidencia DELAY OPEN desde los pedidos de prueba del 24. No se alteraron fechas, estados ni asignaciones. Pueden continuar como pruebas de pedidos aceptados, previa disponibilidad y asignación del conductor. No se pueden volver a aceptar como PENDING.

Se encontró una condición de interfaz: botones de atención dependían de una nota global de cinco caracteres, sin explicación. Ajuste local en negocio móvil y portal web: nota independiente por incidencia, Atender/Tomar en atención puede registrar el inicio de revisión sin texto previo; esperar retorno o resolver valida una explicación de al menos cinco caracteres y muestra el requisito si falta. Se conserva trazabilidad mediante manage_order_incident. Resolver no entrega/cancela el pedido ni concilia efectivo. El estado actual no vuelve a ejecutarse mientras se muestra como tal.

La regla existente genera demora para pedidos abiertos no pendientes con más de dos horas desde su creación; no cancela automáticamente los aceptados. Una incidencia resuelta puede volver a generarse mientras el pedido siga sin completarse y conserve la demora. No cerrar solo para ocultar la alerta: registrar seguimiento y resolver cuando se atienda la causa. Pendientes sin aceptar conservan vencimiento de diez minutos.

TypeScript aprobado en negocio y web, diez pruebas del negocio aprobadas. Sin nueva compilación ni despliegue durante esta revisión.
