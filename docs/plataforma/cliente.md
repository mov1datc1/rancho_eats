# Cliente · 1.3.0
El catálogo consulta categorías públicas o pilotos autorizados para la cuenta y negocio. El domicilio necesita coordenadas dentro del radio del negocio. El servidor vuelve a comprobar cobertura, disponibilidad, precios y cargos antes de crear el pedido.

En esta fase el servidor solo admite efectivo; tarjetas y otros métodos necesitan una integración de pago verificada antes de habilitarse.

El negocio dispone de 10 minutos para responder. El cliente puede cancelar mientras siga PENDING. Una propuesta de otra hora requiere aceptación explícita; vence como máximo dos minutos después y nunca prolonga la respuesta más allá de 12 minutos desde la creación. No hay cancelación automática de entregas en camino por superar dos horas.

Fruterías/carnicerías: faltante se retira y no se cobra; no se sustituye libremente. Cantidad parcial solo con preferencia consentida. Si falta todo, se cancela sin cobro. Listas guardadas son plantillas: el carrito debe comprobar disponibilidad y precio actuales. Pizzerías conservan tamaño, extras y notas por línea. Farmacia debe mantenerse cerrada mientras no se valide su flujo específico.

Instalar el nuevo AAB mediante Google Play; la versión anterior no contiene todos los controles nuevos. Dar permiso de notificaciones y abrir la app con sesión para registrar el dispositivo.

## Domicilio e indicaciones — mejora local del 23/10/2026

Estado: cambios locales en cliente y repartidor. Sin despliegue, cambios SQL, push ni APK/AAB nuevos. Las versiones ya instaladas no incluyen todavía estos ajustes.

Flujo: colocar el pin en la entrada accesible desde el camino; revisar dirección (también admite nombre de rancho/localidad); agregar indicaciones opcionales; guardar con nombre Casa/Trabajo/Otro. Las indicaciones usan el campo existente `client_addresses.reference` y se conservan al guardar desde Inicio. No se exige un número de calle inexistente para domicilios rurales.

El campo orienta a describir color de fachada, reja, piso, timbre, entrada y referencias del camino. Límite de captura de 500 caracteres. Evitar claves permanentes en la dirección guardada; los accesos temporales se escriben en checkout. Antes de confirmar el cliente puede revisar/editar indicaciones; esos cambios aplican al pedido y no sobrescriben automáticamente el domicilio guardado.

El pedido copia dirección escrita e indicaciones en `client_location_note`, conservando compatibilidad con el negocio y repartidor actuales. Modificar la dirección guardada después no cambia un pedido existente. Al elegir un punto diferente desde checkout se elimina la selección anterior para no enviar las coordenadas de otra dirección.

Efectivo: recepción en persona y cobro. No se incorpora entrega desatendida ni un código obligatorio de acceso/entrega. Un acceso al fraccionamiento no es prueba de recepción ni autoriza marcar entregado. El repartidor muestra la nota completa durante la entrega, sin truncarla a dos líneas.

Validación realizada: TypeScript de cliente y repartidor, sin errores. Pendiente QA en dispositivo: teclado y formulario en Redmi, selección entre Casa/Trabajo, persistencia al reiniciar, pin nuevo desde checkout, recepción de dirección/indicaciones en negocio y repartidor, y lectura con señal intermitente. No se afirma disponibilidad offline de pedidos por este ajuste.

Criterio UX: separar ubicación, descripción del domicilio e instrucciones. Uber Eats permite instrucciones especiales antes de confirmar y distintas formas de encuentro; PideYa conserva recepción presencial por el efectivo. Fuente: https://help.uber.com/ubereats/restaurants/article/d%C3%B3nde-debo-encontrarme-con-el-repartidor?nodeId=8c9a6cc6-5fda-4e5c-8171-7e1994e1efcf
