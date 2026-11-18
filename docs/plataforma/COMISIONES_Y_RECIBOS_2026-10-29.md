# Comisiones y recibos digitales — 29 de octubre de 2026

## Flujo para operación

1. El negocio abre **Comisiones** en la barra principal de la app. Ajustes continúa disponible en el engrane de la cabecera. Ve pendiente total de todos los cortes, acuerdo de cobro, resumen mensual, detalle por pedido (25 por página) e historial de comprobantes.
2. Superadmin → **Comisiones** usa el mismo estado de cuenta, filtrado por negocio y periodo. El pendiente total incluye periodos anteriores; las métricas del corte muestran solo esas fechas.
3. El gestor recoge físicamente el importe completo pendiente del corte seleccionado. El administrador elige **Confirmar dinero recibido**, escribe quién recibió, forma y referencia, y confirma la recepción explícitamente.
4. El servidor valida el saldo exacto, asigna cada pedido al cobro y emite un recibo inmutable con folio, nombre del negocio, periodo, importe, cantidad de pedidos, fecha, receptor, forma, referencia y frecuencia del acuerdo. No se realiza una transferencia bancaria desde la app.
5. Ambos pueden consultar el mismo recibo. La app permite compartir PDF o texto; web permite descargar HTML imprimible e imprimir/guardar PDF. No se envían mensajes automáticamente a terceros.

El propietario confirmó **mensual inicialmente**. No se crearon acuerdos individuales ficticios: la ausencia de acuerdo explícito significa mensual. PideYa puede configurar semanal (lunes–domingo), quincenal (1–15 y 16–fin) o mensual por negocio. Cambiar el acuerdo no modifica precios, pedidos ni recibos emitidos.

## Una sola fuente para los saldos

Migración `058_commission_receipts.sql` aplicada transaccionalmente en staging y producción. `commission_statement` y el contrato anterior `admin_commission_statement` comparten el mismo cálculo interno. Solo pedidos DELIVERED, comisión almacenada en el pedido, con corte por fecha de creación en America/Mexico_City. Envío, ventas del negocio y liquidación del repartidor no se mezclan.

Los cobros históricos sin detalle permanecen **por conciliar** y no se vuelven a cobrar automáticamente. Una entrega que se completa después de un cobro genera únicamente la comisión nueva pendiente. No se incorporaron abonos parciales ni ajustes contables reversibles en esta versión: el administrador confirma el pendiente completo del corte con importe exacto.

Permisos: el negocio solo consulta su información; PideYa confirma cobros y edita acuerdos. Helpers internos sin ejecución pública. Recibos y asignaciones de pedidos no admiten UPDATE/DELETE; escrituras directas revocadas a clientes. Folios numéricos únicos y snapshot de nombre/acuerdo/receptor. Un UUID de solicitud conserva el mismo recibo en reintentos; el bloqueo por negocio serializa cobros simultáneos o de cortes traslapados.

La app refresca al entrar, al volver al primer plano y cada 30 segundos mientras esta pantalla está enfocada y la app activa. También permite actualización manual. Las cifras son una lectura del servidor, no se recalculan a partir de una lista limitada en el teléfono.

## Validación

- 13 escenarios PostgreSQL locales: centavos, fechas CDMX, saldos idénticos, aislamiento de negocios, permisos, acuerdos, saldos desactualizados, reintentos simultáneos, cortes traslapados, recibos inmutables, snapshot de negocio, entregas tardías e históricos sin asignaciones.
- `tests/hosted-commission-smoke.sql` pasó en staging con esquema real: pedido, oferta, custodia, entrega y liquidación; comisión visible al negocio; confirmación de recepción por admin; recibo idéntico para ambos; reintento idempotente y saldo actualizado. Datos sintéticos y notificaciones revertidos con ROLLBACK. El fixture usa la tarifa de comisión entera vigente del checkout; las pruebas locales cubren importes con centavos. No se registraron cobros reales en producción.
- 24 pruebas de negocio y 15 web correctas; TypeScript de ambos y build Vite correctos. Helpers de periodos y recibos idénticos entre apps, probados en semanas entre años, quincenas y años bisiestos; nombres y notas escapados en HTML.
- Expo Doctor: 21/21. Export Android Metro correcto. Revisión visual con React Native Web en modo demo y superadmin local con datos ficticios; formulario y recibo revisados a 390 px. PDF nativo pendiente de prueba física.

## Publicación y APK

Servidor: 058 aplicada en staging y producción. Superadmin: Vercel producción READY, `dpl_9izDWboKxpAuxQc5uFLM7VTbJkqd`, alias `www.pide-ya.app`, ruta https://pide-ya.app/administrador. No se cambiaron protecciones de despliegue.

App negocio preparada como **1.5.1**. EAS recibió el archivo y elevó el contador remoto 13 → 14, pero rechazó la creación del build por cuota Android gratuita agotada. **No existe un APK 1.5.1 ni un build 14 para distribuir.** El propietario eligió esperar a la renovación gratuita del **1 de noviembre**. No se contrató ningún plan ni se programó una compilación automática. El próximo intento autoincrementará el contador otra vez.

El APK anterior 1.5.0 (13) sigue siendo válido para sus funciones anteriores, pero no incluye Comisiones. Cliente y repartidor no requieren recompilar para esta funcionalidad. Para compilar después: volver a ejecutar Expo Doctor, usar perfil `release` y credenciales/EAS de producción existentes, verificar mapas Sentry y APK final antes de distribuir.

Evidencias y recibos de estado: `release-artifacts/2026-10-29-commissions/`. Las capturas son de modo demo o datos ficticios, no saldos reales de negocios.

Implementación de PDF y compartir basada en las APIs existentes de Expo SDK 57: [Print](https://docs.expo.dev/versions/v57.0.0/sdk/print/) y [Sharing](https://docs.expo.dev/versions/v57.0.0/sdk/sharing/). No se añadieron dependencias nativas nuevas.
