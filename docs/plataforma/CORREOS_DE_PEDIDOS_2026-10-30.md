# Correo de pedidos entregados — conexión y activación

El módulo nuevo **Configuración → Usuarios** también necesitará correo para invitaciones y recuperación de acceso. Ese flujo usa **SMTP de Supabase Auth**, que se conecta por separado del worker de resúmenes de pedidos. Está preparado y desactivado hasta validar el proveedor. Ver [guía de usuarios, roles y activación del correo de acceso](USUARIOS_ROLES_Y_ACCESOS_2026-10-30.md).

## Qué quedó preparado y qué falta

**Preparado en código, desactivado y sin despliegue:** plantilla con identidad PideYa (HTML adaptable y texto), captura del pedido entregado, cola privada, worker de Resend, reintentos, protección contra duplicados, indicadores de salud y pruebas locales. Ningún correo real se envió en esta implementación. La migración 060 todavía no se aplicó a staging ni a producción.

**Falta conectar:** cuenta de Resend, dominio remitente verificado por DNS, clave de envío guardada en el servidor, dirección real para recibir respuestas y alojamiento del worker. Después corresponde validar staging, aplicar la migración desactivada a producción y activar el canal. No hace falta esperar ni generar un APK/AAB para este cambio de servidor.

Validación realizada el 30 de octubre: **8 pruebas de código y 20 comprobaciones SQL aprobadas**, en un clúster PostgreSQL local desechable. Vista HTML revisada a 320 y 390 px sin desbordamiento horizontal; captura en `email-worker/preview-mobile.png`. No se probó recepción en Gmail/Outlook ni conexión real con Resend: esos pasos requieren la cuenta y el dominio verificado.

## Qué recibirá el cliente

Un resumen al pasar el pedido a `DELIVERED`, dirigido exclusivamente al correo confirmado de la cuenta vinculada mediante `client_user_id`. No se toma el correo escrito por el negocio ni un destinatario enviado por la app. No se envían correos de pedidos antiguos al instalar la migración. Sin cuenta o sin correo confirmado, el historial sigue disponible en la app.

Asunto: **Tu pedido PY-XXXXXX fue entregado · PideYa**.

Contenido: negocio, folio, fecha en horario de México, productos, cantidades, importe de cada producto con sus extras, envío, servicio PideYa, total final y forma de pago. Si hubo surtido, se usan las cantidades, sustituciones e importes finales; se omiten los productos no disponibles. No incluye teléfono, dirección, ubicación, notas de salud, instrucciones ni contactos del repartidor. Si un registro antiguo no tiene un desglose coherente, pasa a revisión sin inventar importes.

La plantilla indica que el historial está en la app. El botón **Ir a PideYa** abre el sitio oficial. No se añade un enlace público con datos del pedido ni se inventa un enlace directo al historial: ese enlace requeriría implementar navegación autenticada en el cliente.

Vista previa: `rancho_eats/email-worker/preview.html` y `preview.txt` (datos ficticios). Regenerar con `npm run preview` desde `email-worker`.

## 1. Cuenta y dominio (usuario + configuración asistida)

1. Crear/iniciar sesión en [Resend](https://resend.com/). No contratar un plan automáticamente; comprobar la cuota disponible frente al volumen previsto.
2. En **Domains**, añadir `notificaciones.pide-ya.app`, subdominio propuesto para estos mensajes.
3. Copiar exactamente los registros DNS que muestre Resend al proveedor que administra `pide-ya.app`. No sustituir los registros MX del correo principal ni inventar valores SPF/DKIM. Si ya existe SPF para el nombre concreto, integrar su configuración en lugar de crear otro SPF contradictorio. Verificar el dominio en Resend.
4. Revisar DMARC y la alineación del remitente con la configuración existente. Mantener desactivado el seguimiento de aperturas/clics para estos resúmenes de pedidos.
5. Remitente propuesto: `PideYa <pedidos@notificaciones.pide-ya.app>`. La dirección de respuesta debe ser **un buzón real atendido**; el envío mediante Resend no crea por sí solo ese buzón. Confirmar qué correo usará soporte.
6. Crear una clave con permiso de envío, restringida al dominio cuando esté disponible. Guardarla directamente en el gestor de secretos del alojamiento como `RESEND_API_KEY`; nunca en chat, Git, frontend o variables públicas.

Resend exige verificar un dominio propio para enviar desde él. Su documentación recomienda subdominios para separar la reputación de los correos transaccionales. [Dominios verificados](https://resend.com/docs/dashboard/domains/introduction).

## 2. Conexión del servidor

Preparar un servicio de proceso continuo con Node 20 o posterior, directorio `rancho_eats/email-worker` y comando `npm start`. El import del cliente RPC usa `../notification-worker`, por lo que el checkout debe conservar ambos directorios. No se instala una librería nueva ni se cambia el worker de push.

Mantener una sola réplica. El worker reclama lotes de cinco y separa los envíos al menos 600 ms; esto limita una instancia a menos de dos solicitudes por segundo. No aumentar las réplicas sin añadir un limitador global acorde a la cuota contratada.

| Variable privada del servidor | Valor |
| --- | --- |
| `SUPABASE_URL` | URL del proyecto correspondiente: staging para pruebas, producción al activar |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servidor del mismo proyecto, desde su gestor de secretos |
| `ORDER_EMAIL_ENABLED` | `false` hasta completar la conexión; `true` para arrancar las pruebas controladas |
| `RESEND_API_KEY` | Clave privada de envío de Resend |
| `ORDER_EMAIL_FROM` | `PideYa <pedidos@notificaciones.pide-ya.app>` una vez verificado |
| `ORDER_EMAIL_REPLY_TO` | Buzón de soporte real y atendido |

Archivo de referencia: `email-worker/.env.example`. **No usar prefijos `EXPO_PUBLIC_` o `VITE_`** para estos secretos. El SMTP de Supabase Auth corresponde al inicio de sesión; configurarlo no sustituye este envío de pedidos.

## 3. Validación antes de activar

1. Ejecutar `npm test` y `node tests/run-sql.mjs` en `email-worker`. El segundo crea un clúster local desechable y lo elimina al terminar.
2. Aplicar `supabase/migrations/060_order_receipt_email.sql` a **staging** después de 059, usando el flujo habitual de migraciones. Sus interruptores quedan apagados.
3. Usar una cuenta de prueba con correo confirmado y un pedido sintético de staging dirigido a un buzón propio. Activar captura en staging antes de terminar ese pedido:

   ```sql
   UPDATE public.order_email_channel SET capture_enabled=true WHERE id;
   ```

4. Completar el pedido por el flujo normal. Verificar que exista una sola fila `pending` y que `snapshot` corresponda al total final. Probar también surtido, pedido sin correo confirmado y repetición del mismo evento. No modificar estados de pedidos reales para probar correo.
5. Inyectar las variables de staging en el worker, arrancarlo con `ORDER_EMAIL_ENABLED=true` y habilitar envío en staging:

   ```sql
   UPDATE public.order_email_channel SET send_enabled=true WHERE id;
   ```

6. Revisar el mensaje recibido y el texto alternativo en Gmail/Outlook y móvil; comprobar remitente, respuesta, cantidades, cargos tal como ya los calcula PideYa, total y enlaces. El resumen no calcula cargos nuevos. Confirmar también en el panel de Resend que el evento fue entregado.
7. Con un proveedor simulado, probar timeout, 429/5xx y fallo de confirmación de base de datos. Nunca simular fallos enviando repetidamente a clientes reales.

Las pruebas automáticas incluidas no usan Resend ni direcciones reales. Una prueba visual en navegador no sustituye la recepción real en un cliente de correo.

## 4. Activación en producción

Solo después de aprobar staging y de contar con el proveedor conectado:

1. Aplicar la migración 060 con ambos interruptores apagados y verificar los permisos privados.
2. Desplegar una instancia del worker con secretos de producción y `ORDER_EMAIL_ENABLED=true`. No reutilizar una clave de Supabase staging contra producción.
3. Validar primero con una cuenta propia y un pedido de prueba autorizado. Activar captura y envío de forma coordinada:

   ```sql
   UPDATE public.order_email_channel SET capture_enabled=true,send_enabled=true WHERE id;
   ```

4. Supervisar la cola y el proveedor durante los primeros pedidos. No hacer backfill de pedidos antiguos ni reabrir filas `accepted`.

Para pausar nuevos envíos:

```sql
UPDATE public.order_email_channel SET send_enabled=false WHERE id;
```

Detener el worker para interrumpir la operación tras el lote en curso. Apagar el interruptor no retira un correo ya enviado ni cancela un lote que ya se reclamó. Para pausar también la captura, poner `capture_enabled=false`. No eliminar tablas/triggers para pausar.

## 5. Reintentos, duplicados y seguimiento

- Una fila única por pedido; cambios repetidos de estado no crean más resúmenes.
- El destinatario y el resumen se capturan al entregar. El worker vuelve a comprobar que la cuenta siga confirmada, con el mismo correo y vinculada al pedido. Si cambió, el mensaje se omite; no se redirige a otra dirección.
- Antes de enviar, se persiste la petición exacta (remitente, destinatario, asunto, HTML y texto). Un despliegue o cambio de plantilla no altera el contenido de un reintento.
- Se usa la misma clave `Idempotency-Key` en cada intento. Resend conserva esas claves durante 24 horas; por eso el sistema deja de reintentar a las 23 horas desde el primer intento y no envía colas de más de 24 horas de antigüedad. [Idempotencia de Resend](https://resend.com/docs/dashboard/emails/idempotency-keys).
- Máximo ocho intentos, con espera creciente para fallos de red, 429 y errores 5xx. Errores permanentes y resúmenes incoherentes quedan `dead` para revisión. Las reservas caducadas se recuperan.
- `accepted` significa aceptado por la API, **no entregado en la bandeja**. Durante el piloto, revisar los eventos de entrega, rebote y queja en el panel de Resend. Los webhooks de entrega/rebote no están implementados en esta versión; no hay una pantalla de superadmin de correos todavía.
- Un fallo de correo no bloquea la entrega ni la liquidación. Un fallo al crear la cola incrementa `capture_errors` y requiere revisión.

Consultas operativas privadas, mediante conexión de servidor/administración:

```sql
SELECT * FROM public.order_email_health;
SELECT capture_enabled,send_enabled,capture_errors,last_capture_error_at
FROM public.order_email_channel;
SELECT error_code,count(*) FROM public.order_receipt_emails
WHERE state='dead' GROUP BY error_code;
```

Alertar ante aumento de `capture_errors`, trabajos `dead`, pendientes de más de diez minutos o ausencia del worker. Revisar credenciales/dominio ante 401/403 y cuota ante 429. No volcar snapshots, destinatarios ni claves en logs o Sentry. Tras un timeout fuera de la ventana de idempotencia, comprobar el proveedor antes de autorizar un reenvío manual: nunca resetear automáticamente esas filas.

La cola conserva información privada para diagnóstico. Antes de ampliar el piloto, definir y automatizar su retención: conservar el identificador único del pedido como marca de deduplicación y eliminar el contenido/destinatario de los trabajos finalizados al cumplir el plazo acordado. No borrar la marca de deduplicación para limpiar datos. La eliminación de una cuenta/pedido elimina su fila mediante las claves foráneas.

## Responsabilidades del siguiente paso

**Usuario:** iniciar sesión/crear la cuenta de Resend y confirmar el buzón que recibirá respuestas. Debe disponer de acceso al DNS del dominio.

**Implementación asistida:** verificar dominio y registros, guardar secretos en el alojamiento, desplegar y probar staging, aplicar la migración a producción apagada y activar tras la prueba de recepción. Estas conexiones externas quedan pendientes; el código y la plantilla ya están preparados para ellas.
