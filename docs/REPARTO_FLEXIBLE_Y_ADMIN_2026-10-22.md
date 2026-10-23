> Estado actualizado: implementación y limitaciones en [manual vivo](plataforma/README.md). Este documento conserva el planteamiento original.

# PideYa: administración general y reparto flexible

Estado histórico de la propuesta: 22 de octubre de 2026. Las frases «pendiente», «local» y «sin desplegar» del cuerpo describen aquella revisión, no el estado actual. Al 23/10 hay implementaciones y despliegues posteriores; consultar el [estado vigente y prioridades](plataforma/ESTADO_Y_PRIORIDADES.md) y el [registro de despliegues](plataforma/despliegues.md).

## Qué existe y qué se corrigió

El panel global `/admin` pertenece al dueño de PideYa. Sus RPC administrativas comprueban `admin_profiles`; la app del negocio pertenece al propietario indicado en `restaurants.owner_id`. Son permisos distintos. Crear negocios de prueba con la credencial administrativa no convierte al propietario de La Guera en superadministrador.

El panel permite revisar solicitudes, aprobar y suspender negocios, consultar pedidos, actividad, comisiones, categorías, promociones y configuración. La sección de comisiones registra cobros/saldos: no constituye un sistema de transferencias bancarias a negocios. Un registro de pago y una transferencia real deben distinguirse explícitamente.

Problemas corregidos localmente:

- La lista administrativa usaba un RPC con `LIMIT 8`, y el fallback también recortaba a ocho. Ahora consulta todo el directorio en bloques de 100, incluyendo el recuento de pedidos de hoy. La consulta se comprobó contra Supabase. A mayor número de comercios conviene paginar también la presentación y buscar en servidor.
- Pedidos solo mostraba los últimos 60 sin acceso a anteriores. Ahora tiene páginas de 50, orden estable por fecha e identificador, una fila adicional para detectar la siguiente página y protección contra respuestas de solicitudes anteriores. Incluye `commission_amount`, ausente del RPC heredado. La paginación por desplazamiento puede moverse si entran pedidos mientras se navega; para auditoría/exportación histórica, implementar cursor con corte temporal fijo.
- El gráfico podía dividir por cero si no había pedidos. Usa un máximo mínimo de uno.
- La aplicación del repartidor verificaba el código al entrar, pero leía el detalle únicamente por ID. Ahora revalida el código antes de las lecturas y restringe pedidos a repartidor y negocio; rechaza perfiles locales que no coincidan. La lista activa va de más antiguo a más reciente.
- El seguimiento iniciaba GPS al abrir una ruta incluso antes de cargar/validar el pedido. Ahora espera un pedido asignado en `ON_THE_WAY` y cancela el inicio pendiente al salir.
- La migración **035**, todavía pendiente de aplicar a Supabase, impide escribir ubicación en pedidos ajenos, de otro negocio o finalizados; valida coordenadas y elimina el cambio implícito de `ACCEPTED` a `ON_THE_WAY` al recibir GPS. Iniciar entrega sigue siendo una acción explícita.

La base de datos debe imponer la autorización: los filtros en una app no sustituyen RLS. La migración histórica 001 contiene `orders_select_by_id_public USING (true)`. Antes de abrir una red externa hay que sustituir ese acceso por consultas autenticadas/RPC acotadas, conservando una vía segura para el seguimiento web del cliente. También revisar las políticas efectivas remotas: las migraciones locales no prueban por sí solas qué políticas están instaladas. No se ha certificado un cierre integral de seguridad.

## Flujo actual del repartidor propio

El negocio crea un `driver_profile` asociado a su `restaurant_id`, comparte un código/enlace y asigna pedidos. La app canjea ese código mediante `driver_get_session`. `driver_take_order` comprueba la asignación. La app contiene una pantalla OTP, pero eso no equivale a un alta externa completa: falta verificar la vinculación de identidad en servidor y no existen afiliaciones múltiples ni turnos con vencimiento en el modelo actual. El código funciona como credencial; no debe compartirse entre personas.

## Propuesta revisada: reparto temporal de confianza para Los Altos

Esta revisión incorpora el contexto operativo del dueño: una zona inicial de aproximadamente veinte pueblos de Los Altos de Jalisco, rancherías y caminos rurales, referencias de domicilio a veces imprecisas y predominio del efectivo. No propone abrir ahora una bolsa pública de repartidores desconocidos. El negocio da de alta a una persona a la que conoce y autoriza para llevar mercancía y cobrar.

**Unidad de trabajo: recoger → entregar → cobrar → regresar → liquidar.** Entregar al cliente termina la entrega, pero no termina la responsabilidad del repartidor con el negocio. El retorno y la conciliación son parte de la capacidad que debe reservarse.

### 1. Alta por el negocio y exclusividad

1. La persona se presenta o acuerda directamente con el negocio su incorporación. El negocio verifica su identidad y confianza según su procedimiento; un teléfono verificado por sí solo no acredita confiabilidad.
2. El negocio la registra como **Propio** o **Temporal**, guarda quién autorizó el alta y genera una invitación individual. Para la evolución del sistema, la invitación debe ser de un solo uso y tener vencimiento; no debe quedar como contraseña permanente compartida.
3. La persona vincula la invitación a su cuenta personal y entra a la app. El negocio puede suspender nuevas asignaciones o revocar el acceso, preservando historial y cualquier liquidación pendiente.
4. En el piloto, el temporal tiene **un negocio habilitado para operar**. Un cambio de negocio necesita liberación del anterior y aceptación del nuevo, sin entrega, mercancía, reserva de cola ni efectivo pendientes. Una identidad global evita eludir el bloqueo usando otro código o dispositivo.

Esto reemplaza la propuesta inicial de solicitudes abiertas y múltiples afiliaciones operativas. El sistema puede conservar relaciones históricas con varios negocios, pero no habilitar trabajo simultáneo. No puede controlar trabajo realizado fuera de PideYa; sí impedir asignaciones incompatibles dentro de la plataforma.

### 2. Turno que controla el repartidor

El temporal pulsa **Activarme hasta…**, con accesos rápidos de 1, 2 o 4 horas y selector de hora. Ve el negocio y confirma su disponibilidad. El panel del negocio muestra hora de término, estado, última conexión, pedido actual y cola reservada.

Puede **extender la hora** desde el turno actual, sin cerrar sesión ni repetir el alta. El servidor registra el cambio y actualiza al negocio. Extender disponibilidad no garantiza pedidos ni implica una remuneración por hora.

Puede pedir **Dejar de recibir pedidos** antes de tiempo. Si tiene pendientes, pasa a **Terminando turno**: completa o entrega formalmente al negocio sus compromisos y liquida. Al llegar la hora prevista se detienen nuevas reservas, pero no se borra una entrega ni una deuda. Si está libre y sin pendientes, queda desconectado.

La hora de término es la hora a la que espera estar de vuelta y liquidado, no la última hora a la que se le puede mandar lejos. Avisar antes del fin —propuesta inicial: 15 minutos— permite extender o redistribuir pendientes. Una extensión requiere acción expresa del repartidor.

### 3. Un pedido en ruta y una cola pequeña

Propuesta para el piloto: **un pedido en proceso de reparto y hasta dos reservados en cola**, configurable por negocio dentro de límites de plataforma. No es una capacidad ilimitada ni autoriza recoger tres pedidos para repartirlos juntos.

- El negocio ve la cola y el repartidor confirma la reserva. Un pedido reservado permanece en el negocio; no entrega al conductor mercancía de varias órdenes.
- La cola se prioriza por compromiso de entrega, preparación y antigüedad. Los cambios manuales quedan registrados y no deben ocultar retrasos al cliente.
- La reserva se admite solo si la estimación de los ciclos pendientes cabe en el tiempo disponible: espera/preparación restante, ida, entrega/cobro, vuelta y liquidación, con margen por incertidumbre rural. Si no hay una estimación fiable, pedir revisión manual en lugar de mostrar una garantía falsa.
- Si el recorrido actual se retrasa, el negocio redistribuye los pedidos todavía en cola. Cambiar la reserva no equivale a cancelar el pedido del cliente.
- Solo hay una salida activa global por persona. Dos dispositivos o dos administradores no pueden iniciar dos salidas a la vez: la restricción se aplica en una transacción del servidor.
- No se autoriza la siguiente salida hasta que el negocio confirme el regreso y la liquidación del ciclo anterior. El cierre del turno exige además vaciar o reasignar la cola.

### 4. Efectivo: entrega y liquidación separadas

| Momento | Lo que registra el sistema | Quién confirma |
| --- | --- | --- |
| Salida | Pedido, mercancía, total a cobrar y fondo de cambio entregado, si existe | Negocio y repartidor |
| Entrega | Entregado al cliente, importe recibido y cambio devuelto | Repartidor; comprobación de entrega según el método acordado |
| Retorno | Regreso al negocio y efectivo o mercancía por devolver | Repartidor informa; negocio verifica |
| Liquidación | Esperado, recibido realmente, diferencia y responsable de recepción | Negocio; repartidor puede consultar o señalar desacuerdo |
| Liberación | Ciclo conciliado, sin custodia pendiente | Servidor, después de las confirmaciones necesarias |

Ejemplo: total del pedido y envío **$220**, fondo de cambio del negocio **$100**; el cliente da **$250** y recibe **$30**. El repartidor regresa con **$320**: $220 cobrados y $100 del fondo. El sistema no debe contar los $250 entregados por el cliente como ingreso neto del pedido.

La propina y la remuneración del repartidor se registran por separado. Para el piloto recomiendo devolver íntegramente lo cobrado y el fondo; cualquier pago al repartidor se registra como otro movimiento. Si posteriormente se permite descontarlo al liquidar, necesita una regla explícita y un comprobante, no una resta libre del conductor. La comisión de PideYa es otro concepto.

Si el cliente no está, no paga o rechaza la mercancía, abrir **Incidencia de entrega** y coordinar retorno. No marcar entregado ni inventar un cobro. Si el efectivo no cuadra, registrar la diferencia y bloquear nuevas salidas; el administrador puede resolverla mediante un ajuste justificado y auditado. No exigir mantener la app/GPS encendidos indefinidamente por una diferencia: se puede terminar la presencia operativa, conservando el bloqueo financiero y la incidencia.

El cliente debe ver **Entregado** cuando recibe su pedido. El retorno del efectivo es una operación interna y no mantiene su pedido artificialmente “en camino”. No cancelar una entrega terminada para resolver un faltante de caja.

### 5. Cobertura rural: radio, domicilio y decisión del negocio

El radio es un primer filtro. En el código actual `pideya-app/src/utils/deliveryCoverage.ts` calcula distancia en línea recta; eso no demuestra que un camino sea transitable ni cuánto tarda recorrerlo. El Home filtra los negocios según la ubicación de entrega y categoría seleccionada.

Propuesta de tres controles:

1. **Visibilidad:** negocios dentro de su radio configurado y las zonas habilitadas de PideYa. Conservar el comportamiento solicitado; no mostrar indiscriminadamente todos los pueblos a todos los clientes. El directorio del admin sí muestra todos los negocios.
2. **Al enviar:** el servidor vuelve a validar ubicación de entrega, cobertura y negocio activo/abierto. Usar la dirección elegida para ese pedido, no asumir que coincide con el GPS actual del teléfono. Guardar una copia de ubicación, referencias, tarifa y cobertura aplicada; un cambio posterior exige recalcular y reconfirmar.
3. **Antes de aceptar:** el negocio ve el pin, localidad/ranchería, referencia de acceso y contacto, distancia aérea claramente etiquetada y ruta estimada si está disponible. Puede rechazar por camino inaccesible, fuera de cobertura, falta de repartidor o demora que no puede comprometer. No confundir un mapa sin ruta con una distancia cero.

Para el domicilio rural: pin confirmado, nombre de localidad/ranchería, referencias como portón/color/cruce y teléfono; foto del acceso opcional. No obligar a inventar número de calle. Antes de preparar se puede aclarar el punto con el cliente; esa aclaración no debe dejar el pedido esperando indefinidamente. Zonas excluidas o polígonos de cobertura pueden añadirse cuando existan datos fiables; no ampliar automáticamente el radio porque un pedido quedó fuera.

### 6. Respuesta del negocio, demora y cancelación

Separar **tiempo para responder** de **tiempo prometido para entregar**. Para comida preparada propongo como valores iniciales de piloto —no como tiempos ya medidos— recordatorio a los tres minutos, aviso operativo a los siete y **vencimiento de solicitud a los diez minutos** sin respuesta, según la decisión del dueño. El negocio no puede ampliar indefinidamente ese plazo; la plataforma puede ajustar tiempos por categoría y resultados del piloto.

Mientras espera, el cliente ve el plazo para respuesta, su estado y **Cancelar pedido**. Al aceptar, el negocio confirma una ventana estimada realista que incluye preparación, cola y recorrido rural. No anunciar que todos los pedidos llegarán pronto por usar un plazo de respuesta corto.

Cuando solo puede entregar mucho después, ofrecer **Proponer otra hora** antes de aceptar:

1. “Podemos entregarte entre 15:30 y 15:50. ¿Quieres esperar?” No basta un ambiguo “me voy a tardar”.
2. La solicitud sigue sin aceptación definitiva; el cliente puede confirmar o cancelar. No comenzar preparación ni registrar compromiso de reparto definitivo mientras falta su consentimiento.
3. Propuesta con vencimiento propio, inicialmente dos minutos; una sola propuesta activa y un límite total inicial de doce minutos desde la solicitud (diez para responder y hasta dos para decidir sobre una propuesta enviada a tiempo). Son parámetros de piloto a validar. El silencio nunca equivale a aceptación.
4. Si confirma a tiempo, el servidor acepta de forma atómica tras revalidar capacidad y guardar la ventana acordada. Si la capacidad dejó de existir, informar y cerrar la solicitud; no aceptar silenciosamente otra hora.
5. Si vence o el cliente no quiere esperar, cerrar con motivo claro y avisar a ambas partes. Una notificación retrasada no puede reabrir un pedido vencido.

**Regla base solicitada:** el cliente cancela libremente antes de la aceptación del negocio. Aceptación y cancelación compiten sobre el mismo estado y plazo en servidor: solo una puede ganar. Después de aceptar, una solicitud de cancelación o una demora sobrevenida se gestiona como incidencia con resolución explícita; no habilitar una cancelación automática que haga desaparecer una entrega o su efectivo. Antes de aceptar el negocio **rechaza**; después, si no puede cumplir, **reporta incumplimiento y resuelve/cancela con trazabilidad**. Para futuros pagos con tarjeta, definir autorización, captura, devolución y comunicación al cliente por separado; no heredar penalizaciones sin una decisión expresa.

### 7. Qué encontré al revisar el código actual

| Aspecto | Evidencia local y diferencia con esta propuesta |
| --- | --- |
| Cobertura | `deliveryCoverage.ts` usa radio aéreo; sirve para filtro, no para garantizar acceso rural. Falta acreditar validación transaccional equivalente al crear el pedido |
| Rechazo del negocio | La pantalla de pedidos de Negocios permite escribir motivo de rechazo y actualizar el estado; conviene añadir motivos estructurados y conservar nota libre |
| Cancelación del cliente | `src/services/orders.ts` permite `PENDING` y también tarjeta en `ACCEPTED/ON_THE_WAY`; el comentario menciona un cargo del 30 %, cuya ejecución efectiva no se verificó. No coincide con la regla base aquí acordada |
| Carrera aceptar/cancelar | Esa función decide con el estado recibido de la pantalla y actualiza por ID, sin condicionar el UPDATE al estado anterior. Requiere transición atómica en servidor y verificación de políticas efectivas |
| Caducidad antigua | Migración 023 cancela `PENDING`, `ACCEPTED` y `ON_THE_WAY` de más de dos horas, ejecutándose cada quince minutos. No es un plazo de respuesta adecuado; podría cancelar una entrega rural en curso. No se comprobó si el cron sigue instalado en remoto |
| Proponer demora | No se identificó en los archivos revisados un flujo completo de propuesta, consentimiento y vencimiento como el descrito |
| Turnos/efectivo | Alta por código sí existe; exclusividad de identidad, cola reservada, retorno y conciliación por ciclo siguen siendo diseño pendiente |

Antes del piloto se debe revisar el cron remoto y reemplazar el comportamiento antiguo: vencer solo solicitudes aún sin aceptar según su fecha límite. Las demoras de pedidos aceptados o en camino generan alertas e incidencias, no una cancelación por antigüedad. Mantener nombres de estados o añadirlos exige compatibilidad con las cuatro aplicaciones.

### 8. Estados, datos y pantallas propuestos

Separar tres dimensiones para que una sola columna de estado no mezcle todo:

- **Pedido del cliente:** pendiente de respuesta / propuesta de horario / aceptado / preparación / entrega / entregado, más rechazo, vencimiento y cancelación con motivo.
- **Ciclo del repartidor:** reservado en cola / recogida / en reparto / regreso / por liquidar / cerrado o incidencia. Solo un ciclo con custodia activa por persona.
- **Turno:** disponible / ocupado / pausado / terminando / finalizado. Un saldo pendiente se conserva independientemente de la presencia en línea.

Modelo propuesto: identidad global `couriers`; vínculo negocio-persona con tipo propio/temporal y aprobación; turno con `available_until`; reservas ordenadas; ciclo que relaciona pedido, conductor y negocio; movimientos de caja inmutables con correcciones compensatorias; confirmaciones de recepción; incidencias y auditoría. Importes en centavos enteros o decimal exacto, nunca aritmética monetaria de punto flotante. Las operaciones repetidas por mala señal llevan clave idempotente.

**Negocio:** mapa y referencias antes de aceptar; aceptar con ventana, proponer demora o rechazar; equipo propio/temporal con hora de fin; cola, entregas en curso, regresos y **Recibir efectivo**. **Repartidor:** activarme hasta, extender, terminar turno; pedido actual y cola; total a cobrar/cambio; entregué; regresando; liquidación y comprobante. **Cliente:** dirección rural, respuesta con cuenta regresiva, propuesta de horario y decisión, seguimiento y entrega. **Admin:** cobertura por localidad, tiempos de respuesta, rechazos por causa, vencimientos, turnos, incidencias y efectivo por conciliar con separación entre fondos del negocio, remuneración y comisión.

### 9. Mala señal y notificaciones

Una pérdida de señal no prueba abandono: mostrar última actualización y suspender nuevas asignaciones tras un umbral configurable, pero conservar entrega, custodia y saldo. Permitir consultar localmente el pedido ya asignado y preparar el reporte de entrega; mostrar **Pendiente de sincronizar**, nunca fingir confirmación de servidor. La siguiente salida requiere conciliación confirmada; si hay que operar manualmente, dejar una incidencia y reconciliar después sin duplicar cobros.

Reutilizar el outbox preparado para solicitud, propuesta de horario, aceptación/rechazo/vencimiento, cambio de cola, fin de turno e incidencia. La reserva y el cobro se deciden en servidor, no por haber recibido un push. El nuevo worker y sus migraciones siguen pendientes de desplegar. No difundir pedidos a todos los repartidores: avisar al negocio y al conductor autorizado correspondiente. No cancelar un recorrido porque llegó tarde un heartbeat.

## Decisiones adicionales: rutas compartidas, incidencias y categorías

### Dos pedidos en la misma ruta

Para el temporal del piloto se mantiene un pedido físico por salida, retorno y liquidación antes de recoger el siguiente. Es más sencillo de verificar y reduce la exposición de efectivo, aunque consume más recorrido. No se afirma que sea la ruta más rápida: es la opción inicial con menos excepciones para el modelo de confianza elegido.

Para optimizar ahora: asignar al temporal rutas compatibles con su hora de regreso, preparar el siguiente pedido mientras regresa y evitar reservas que retrasen innecesariamente a otro repartidor libre. No dejar comida preparada esperando una cola incierta.

Una evolución posible es **un viaje con dos pedidos**, autorizado expresamente por el negocio para un conductor habilitado. Las entregas se completan en secuencia, pero se custodian dos pedidos y dos cobros a la vez: contradice la regla actual de una sola custodia y por eso no debe entrar como excepción escondida. Necesitaría límite de efectivo, ruta y ventanas compatibles, desglose por pedido, manejo de devolución parcial y liquidación conjunta conciliada. Misma dirección general no basta: un desvío rural o la espera del primer cliente puede perjudicar al segundo. Esa modalidad no se implementa ni se activa ahora.

### Incidencias: hechos separados de sospechas

El pedido no queda “inhibido” solo porque se pierda señal. El servidor conserva el último estado confirmado. El teléfono puede tener una entrega todavía sin sincronizar; las pantallas deben mostrar la hora del último dato, sin inventar un estado nuevo. Una alerta automática se convierte en caso de revisión, no en acusación de abandono.

| Situación | Acción inmediata | Cierre y dinero |
| --- | --- | --- |
| GPS sin actualización | Advertir última conexión; negocio intenta contactar si procede | Conservar asignación. No ofrecer el mismo pedido a otro conductor por el simple timeout |
| Entrega realizada sin señal | Guardar evento local con identificador único y hora del dispositivo; mostrar pendiente de sincronizar | Servidor valida y confirma al reconectar; guardar también hora de recepción. Evitar duplicar entrega/cobro |
| Dirección no encontrada | Registrar motivo, referencia o contacto intentado; pedir instrucción al negocio | Reintentar con indicación válida o regresar; no marcar entregado para poder continuar |
| Cliente ausente o no contesta | Intento de contacto y ventana corta comunicada, inicialmente cinco minutos como parámetro de piloto | Negocio autoriza retorno; registrar si hubo cobro y quién recibe mercancía |
| Camino cerrado, lluvia o acceso peligroso | Detener recorrido y reportar acceso imposible | Resolver reintento o devolución sin penalización automática inferida del GPS |
| Avería o accidente | Priorizar atención y avisar al negocio | Transferencia explícita de custodia si otro recoge: mercancía, dinero, conductor y confirmaciones |
| Cliente rechaza mercancía o no paga | Registrar motivo y cobro real, incluso cero | Devolver mercancía o resolver por negocio; nunca registrar efectivo ficticio |
| Falta de cambio | Contactar y registrar solución acordada | No marcar pago completo si no lo hubo; no crear deuda del cliente sin consentimiento |
| Producto equivocado, dañado o incompleto | Evidencia proporcionada, sin pedir datos innecesarios del cliente | Negocio decide reposición, devolución o cierre; ajustar cobro y custodia con trazabilidad |
| Regreso con efectivo diferente al esperado | Registrar esperado, recibido y diferencia | Liquidación observada; bloquear nueva salida hasta resolución autorizada, conservando historial |
| Posible abandono | Falta de respuesta y hechos revisados por negocio/admin | Escalar a responsable; no declarar robo ni reasignar mercancía que sigue en custodia sin procedimiento |
| Pedido aceptado sin repartidor disponible | Avisar demora, detener nuevas promesas irreales y buscar conductor autorizado | Resolver con cliente; cierre explícito si el negocio no puede cumplir |

Un solo expediente por pedido y causa abierta evita alarmas duplicadas. Datos propuestos: código de causa, descripción, detección automática o reporte humano, tiempos, último estado/ubicación conocido, responsable, próxima acción, mercancía y efectivo en custodia, acciones y resolución. Estados: **Por revisar → En atención → Esperando retorno/liquidación cuando corresponda → Resuelta**. Cerrar una alerta no equivale a cerrar el pedido; el expediente debe indicar qué ocurrió finalmente con entrega, mercancía y efectivo.

El negocio ve y atiende sus casos. El admin de PideYa ve todos, puede filtrar, asignar responsable y escalar. Solo los roles autorizados resuelven o ajustan, dejando actor, fecha y motivo. Vencimientos por gravedad y avisos agrupados; reconocer una alerta no elimina su historial. Dos horas se usan como umbral inicial de revisión, no cancelación automática ni conclusión de abandono. Más adelante, comparar también con la ventana de entrega prometida.

### Liberación gradual de categorías

El admin actual permite crear, editar y mostrar/ocultar `app_categories.is_active`. Esto es un control de visibilidad, no un sistema completo de lanzamiento privado: hay que validar el acceso por enlaces, búsqueda, listas guardadas, carrito antiguo y API. No se cambió ninguna categoría remota en esta revisión.

Diseño de lanzamiento:

- **Cerrada:** no aparece para nuevas compras y el servidor rechaza nuevos pedidos de esa categoría; los pedidos existentes se pueden completar, conciliar o resolver.
- **Piloto:** solo compradores de prueba autorizados, negocios seleccionados y localidades seleccionadas. Autorización en servidor; no basta esconder el botón. La app pública no debe exponer el piloto como oferta disponible a cualquiera.
- **Pública:** disponible en las localidades autorizadas y dentro de cobertura del negocio. Sigue pudiendo pausarse la recepción de nuevos pedidos sin interrumpir entregas existentes.

Guardar categoría por ID y su valor al crear el pedido para informes históricos; el modelo actual relaciona negocios por texto `type`, que puede cambiar. Cada transición de lanzamiento requiere auditoría y verificación de compatibilidad de cliente, negocio, driver y backend. Retroceder de Pública a Piloto/Cerrada bloquea pedidos nuevos, no borra historial, listas ni dinero pendiente.

Orden sugerido: estabilizar restaurantes; probar una frutería; después carnicería con cantidades/pesos bien definidos. Farmacia requiere un flujo propio y no hereda reglas de sustitución alimentaria. No activar todas por compartir técnicamente una pantalla.

### Faltantes y sustituciones: una regla corta para el cliente

**“Si falta, lo quitamos y no lo cobramos. Solo lo cambiamos por la alternativa que tú hayas elegido.”**

Para el primer piloto, si aún no existe selector de alternativa por producto, aplicar solo **quitar y descontar**. No presentar el actual “Sustituir” genérico como si equivaliera a una alternativa concreta autorizada. Llamar puede ayudar excepcionalmente, pero no es condición para surtir ni autoriza cambios si el cliente no responde.

| Ejemplo | Resultado |
| --- | --- |
| No hay papas y no eligió alternativa | Marcar faltante, cantidad surtida cero, restar importe y conservar la línea en el historial |
| No hay lechuga normal, hay romana, sin alternativa elegida | Quitar la lechuga; no mandar romana por criterio del surtidor |
| Eligió expresamente romana como alternativa, con cantidad y tope de precio aceptados | Surtir exactamente esa alternativa dentro del límite; si no existe o supera el límite, quitar |
| No hay el corte de carne elegido | No cambiar corte, especie, preparación, fresco/congelado ni cantidad por decisión del negocio |
| Solo hay una parte de la cantidad | Entregar menos solo si el cliente autorizó cantidad parcial; precio proporcional y unidad consistente. Nunca aumentar peso/cobro sobre el máximo aceptado |
| Falta el producto que el cliente marcó como imprescindible | Detener y cancelar por faltante imprescindible antes de despacho según instrucción previa; informar, sin enviar el resto automáticamente |
| No queda ningún producto | Cancelar por falta de existencias, sin enviar repartidor y sin cobrar envío de una compra vacía |

Guardar el pedido original y las líneas surtidas: no borrar papas del registro como si nunca se hubieran pedido. Al finalizar, el cliente recibe un resumen con quitados, alternativas preautorizadas y **total definitivo en efectivo**. El mismo importe debe aparecer para el repartidor y para caja.

Si solo se aplican descuentos, cantidades parciales o alternativas dentro de lo autorizado previamente, informar sin exigir una segunda respuesta bloqueante. Cualquier modificación fuera de ese consentimiento requiere aprobación explícita; para el piloto, si falta aprobación, quitar el artículo. No aumentar tarifa de envío porque bajó el subtotal sin consentimiento, ni cobrar un sustituto y conservar además el original. Definir el tratamiento de comisión por separado y mantener el total visible consistente.

El selector de alternativa debe mostrar producto concreto, cantidad/unidad y límite de importe. Cambiar un kilogramo por una pieza o sustituir alimentos con características diferentes no es equivalencia automática. En carnicería el peso real solo se cobra dentro del intervalo y máximo autorizados; hasta soportarlo de punta a punta, usar paquetes de peso/precio fijo y describirlos con precisión.

### Listas reutilizables

Una lista es una plantilla de intención, no una reserva de inventario ni un precio garantizado. Al reutilizarla se crea un carrito nuevo y se revalida categoría habilitada, negocio, cobertura, existencia, precio y alternativas. Mostrar diferencias antes de confirmar. Conservar el artículo original de la lista salvo que el cliente decida editarla: un faltante temporal no debe borrar sus papas para la próxima semana. Una alternativa autorizada en un pedido no se vuelve preferencia permanente sin consentimiento.

### Diferencias del surtido actual que bloquean el lanzamiento

En el checkout revisado hay opciones genéricas `substitute/remove/ask_me`, y “Sustituir” aparece como recomendado. La migración local 033 permite nombre y precio libre de sustituto cuando la preferencia global lo permite; no representa una alternativa exacta por línea. `merchant_finish_picking` pasa todo ajuste a `ADJUSTED` y espera confirmación del cliente, incluso si el cambio ya podría estar autorizado. También conserva cargos sobre el subtotal: el caso de cero productos necesita un cierre específico. Por eso esta política no se considera implementada por haber escrito el documento.

Se debe cambiar conjuntamente checkout, preferencias por línea, surtido del negocio, cálculo autoritativo del total, comprobante del driver y caja. Mantener estos negocios en pruebas hasta validar faltantes, cero productos, cantidades, cambios de precio, doble confirmación y mala señal.

### Vista operativa añadida en esta revisión

Implementación **local**, sin desplegar: nueva pestaña **Operación** del admin PideYa y vista en **Pedidos** del panel web del negocio. Filtros por negocio/categoría para el global, por estado y período para ambos; métricas de pendientes, en camino, entregados, rechazados/cancelados, alertas y tiempo de salida a entrega con fechas válidas. Muestra motivo registrado y última actualización de ubicación.

Alertas calculadas: pendiente sin respuesta a partir de diez minutos; recorrido abierto de dos horas; ubicación ausente o sin actualizar diez minutos. No cambian estados ni crean automáticamente expedientes. La consulta es una fotografía actualizable manualmente; no es una alarma push ni seguimiento en vivo. Incluye pedidos creados en los últimos 1, 7 o 30 días; puede excluir pedidos anteriores aún abiertos. A partir de 5.000 pedidos, declara explícitamente muestra parcial; filtros se aplican a esa muestra. Antes de volumen alto, migrar a agregados y filtros de servidor y una bandeja de pendientes independiente de fecha de creación.

La categoría mostrada es la actual del negocio, no una categoría histórica guardada en el pedido. La duración no incluye retorno o liquidación porque esos registros todavía no existen. No se inventan porcentajes de cumplimiento sin ventana prometida ni conteos de incidentes resueltos sin expedientes.

Pruebas locales: build web y TypeScript correctos; ocho pruebas de catálogo/alertas correctas. No se realizó validación visual autenticada ni se alteró cron, estados, RLS o categorías remotas. Referencia de implementación: `src/components/DeliveryOperations.tsx`, `src/lib/deliveryOperations.ts`.

## Orden de implementación recomendado

1. **Reglas de pedidos y cobertura:** comprobar RLS y cron remotos; respuesta con plazo, aceptar/cancelar atómicos, rechazo por motivo, propuesta de horario y validación de domicilio/cobertura en servidor.
2. **Piloto temporal completo:** alta por negocio, identidad exclusiva, turno extensible, una entrega activa, cola limitada, retorno y liquidación de efectivo. La caja es parte del MVP, no una fase opcional posterior. Mantener compatibilidad con códigos actuales durante la migración.
3. **Prueba rural con un negocio:** direcciones sin calle, falta de señal, efectivo exacto y con cambio, regreso tardío, falta de efectivo, cancelación simultánea, turno que vence con cola y cambio de conductor antes de recoger. Verificar que ninguna ruta permite dos salidas, doble cobro o liberar saldo sin recepción.
4. **Ampliación por localidad:** medir cumplimiento de ventanas, duración completa ida/vuelta, dinero pendiente, rechazos y pérdidas de señal. Afinar radio, exclusiones y capacidad sin introducir entregas simultáneas ni múltiples negocios activos como supuesto del producto.

## Referencias de producto

La combinación de flota propia y apoyo externo tiene precedentes en [DoorDash Self-Delivery](https://merchants.doordash.com/en-ca/products/self-delivery) y sus [reglas de Flexible Fulfillment](https://help.doordash.com/en-ca/merchants/article/self-delivery-faq). El control de disponibilidad y fin de nuevas solicitudes aparece en [Uber: entregas consecutivas](https://www.uber.com/in/en/deliver/basics/making-deliveries/back-to-back-trips/). Son antecedentes de interacción, no el modelo operativo que debe copiar PideYa. La revisión actual prioriza alta por el negocio, retorno con efectivo y una sola entrega activa. Los tiempos propuestos son parámetros de piloto, no promedios comprobados.

## Validación de esta revisión

Build y TypeScript de web correctos; TypeScript del repartidor correcto; cinco pruebas de acceso del repartidor y cuatro regresiones de catálogo correctas. La migración 035 pasó en PostgreSQL 14 local desechable: código inválido, pedido ajeno, coordenadas fuera de rango, pedido finalizado y ausencia de inicio automático por GPS. Cambios web/driver y 035 permanecen locales; no están incluidos en el APK de Negocios ni se desplegaron al backend.

La primera revisión rural fue documental. La continuación añadió la vista operativa web descrita arriba; los flujos de turnos, caja, expedientes y sustituciones siguen pendientes. No se cambiaron cron, políticas ni datos remotos.

Referencias consultadas para faltantes: [Instacart: reemplazos elegidos por el cliente](https://docs.instacart.com/storefront/learn_about_your_storefront/cart_and_checkout/replacements/) y [Uber Eats: opciones ante faltantes](https://help.uber.com/en/merchants-and-restaurants/article/how-do-grocery-order-replacements-work-?nodeId=036167a4-b1c3-47ce-88ab-e422eb6645d5). La regla de PideYa es una decisión específica para este piloto en efectivo; no copia automáticamente las políticas de esos servicios.
