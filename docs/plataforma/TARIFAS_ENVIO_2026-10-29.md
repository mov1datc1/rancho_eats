# Tarifas de envío administradas por PideYa

Actualización: migración 057 aplicada en staging y producción el 29 de octubre de 2026; web publicada. Los tres APK de producción finalizaron y fueron verificados. Estado y pruebas en [Lanzamiento coordinado](LANZAMIENTO_2026-10-29.md).

## Configuración

Superadmin → **Tarifas de envío**. Valores iniciales confirmados: $20 MXN hasta 1 km, $5 por cada kilómetro adicional iniciado y máximo $80. Todos los importes y los kilómetros incluidos son editables. Ejemplos: 1 km $20; 1.1 km $25; 2 km $25; 5 km $40; 10 km $65; desde 13 km $80.

La distancia conserva el modelo existente de línea recta (Haversine), **no distancia vial**. La cotización redondea la distancia a seis decimales antes de determinar kilómetros adicionales para evitar errores numéricos de frontera. Cobrar por ruta requeriría otro proveedor y contrato de cotización.

Las rancherías se definen mediante nombre, pin central, radio circular y tarifa fija. No se inventaron nombres ni coordenadas de localidades. El administrador debe registrar las zonas reales. Una coincidencia reemplaza la fórmula por distancia; si coinciden varias, gana la primera de la lista, con botón para subir prioridad. El importe de cada zona debe estar entre la tarifa mínima y el tope global. La cobertura y la disponibilidad del negocio se validan antes de aplicar cualquier tarifa; una zona no autoriza entregas fuera de cobertura.

Este módulo determina el envío cobrado al cliente (`orders.delivery_amount`). No implementa nómina, comisión ni pagos automáticos al repartidor.

## Integridad y actualización

- Nueva tabla `delivery_pricing`: lectura pública para cotización/Realtime, edición exclusivamente mediante RPC de superadmin; no admite escrituras directas de anon/authenticated.
- `admin_save_delivery_pricing`: valida importes, zonas y versión; registra actor y configuración en `operation_audit`. Una versión desactualizada no sobrescribe el trabajo de otro administrador.
- `quote_delivery`: misma autoridad para checkout móvil, web y trigger de precios. No hay fallback a tarifas antiguas o envío gratis cuando falla la consulta.
- Las cotizaciones abiertas escuchan cambios por Realtime, se consultan al volver a primer plano y se reconcilian cada 30 segundos. La propagación visual depende de la conectividad; la validación del servidor es inmediata.
- Antes de enviar el pedido, ambos clientes vuelven a cotizar. Si el importe mostrado cambió, piden revisar el total y confirmar otra vez. El trigger rechaza un importe alterado o desactualizado incluso si el cambio ocurre entre cotización e INSERT.
- El checkout adquiere bloqueo compartido sobre la configuración, compatible entre pedidos y excluyente con edición de tarifas. Los pedidos conservan un snapshot con importe, versión, distancia y zona. Un trigger impide cambiar el envío o su snapshot después de crear el pedido.
- Los pedidos anteriores conservan su importe y snapshot nulo. No se recalculan pedidos existentes, aceptados, en curso ni terminados.
- Los campos antiguos `restaurants.delivery_fee_*` dejan de usarse; sus cambios quedan bloqueados y se retiran del editor del negocio web. El negocio mantiene su configuración de cobertura y ubicación.

## Publicación coordinada

1. Aplicar primero en staging sobre el esquema completo hasta 056, con la migración `057_platform_delivery_pricing.sql` y el portal/cliente nuevos preparados para publicarse juntos. Revisar la tarifa inicial de $20/$5/$80 y configurar las localidades reales con sus radios y precios.
2. Verificar checkout real móvil y web, edición desde superadmin con carrito abierto, reanudación tras desconexión, entrega pausada, recogida gratuita y zonas en los bordes de cobertura. Revisar también picking y liquidación sobre pedidos existentes.
3. Publicar coordinadamente migración, web y app cliente. Las apps antiguas calculan con campos por negocio y podrían presentar importes diferentes: el servidor rechazará esos pedidos si no coinciden; no publicar la migración de forma aislada.
4. Confirmar publicación Realtime de `delivery_pricing`, RLS y permisos en el entorno destino. La migración agrega la tabla a `supabase_realtime` si la publicación existe.

No se ejecutaron migraciones, envíos push, pedidos reales ni builds EAS en producción.

## Verificación local

- 17 escenarios PostgreSQL en base desechable `pideya_pricing_qa` mediante `tests/delivery-pricing/run.mjs`: fronteras de kilómetros, tope, pickup, cobertura, entrega deshabilitada, privilegios/RLS, auditoría, edición con versión antigua, configuración inválida, zonas superpuestas, nombres repetidos, manipulación de importe, snapshot, cambio inmediato, conservación histórica, bloqueo de tarifas antiguas, inmutabilidad y edición concurrente con checkout.
- Fixture aislado con tablas mínimas y el trigger real de precios de 039 actualizado por 057; no equivale a una restauración completa de Supabase.
- TypeScript de cliente y portal; pruebas de regresión del cliente y del portal.
- Vista previa del componente real con Supabase simulado, comprobada en escritorio y a 390×844. La publicación visual se probó con datos ficticios. No demuestra conexión a producción ni sustituye la prueba en dispositivo.

El script SQL de prueba usa únicamente socket local `/private/tmp`, puerto 55449 y una base de nombre fijo. Reinicia sus esquemas de prueba; nunca acepta URLs de aplicación.
