# Publicidad v1 · ofertas, destacados y cobros (17 nov 2026)

Modelo inspirado en los marketplaces de delivery (Uber Eats y DoorDash venden lugares destacados y ofertas pagadas por el negocio; el push de publicidad lo controla la plataforma).

## Qué incluye

| Pieza | Dónde | Estado |
|---|---|---|
| Migración `064_offers_placements_charges.sql` | Supabase | Staging y producción (probada 21/21 en staging) |
| Migración `065_menu_item_promos.sql`: promos por platillo que pone el negocio (precio promo, texto, máximo por pedido, duración) | Supabase + app negocio (Catálogo → Editar producto) + app cliente (sección «🔥 Promociones») | Staging y producción (10/10). Falta el editor en el portal web del negocio |
| Panel admin: ofertas, destacados, cobros | Web admin → Promociones (`PromotionsStudio.tsx`) | Compila; se publica con el siguiente deploy de la web |
| App cliente: destacados, insignias, banner, descuento en checkout | `pideya-app` (`services/marketing.ts`) | En código; requiere nuevo AAB / build iOS |
| App negocio: línea «Promoción» en detalle y tickets | `pideya-restaurant` | En código; requiere nueva build |
| Ritmo de campañas push (300/min) | Migración 063 | Producción |

## Reglas

- **Ofertas**: % (máx. 90, con tope opcional) o monto fijo; compra mínima; audiencia todos / primera compra / clientes que regresan (N días sin comprar); vigencia, días de la semana y franja horaria (CDMX); usos por cliente, cupo total y presupuesto. Las paga el negocio (recibe menos efectivo; la comisión de PideYa no cambia) o PideYa.
- El servidor valida todo en `checkout_prices` y bloquea la fila de la oferta para que el cupo y el presupuesto no se excedan con pedidos simultáneos. El descuento es inmutable después de crear el pedido.
- **v1 solo aplica a comida preparada.** En tiendas con surtido, el ajuste recalcula el total con `total - subtotal`; habilitarlas requiere adaptar `merchant_finish_picking`.
- **Destacados**: el negocio aparece primero en el carrusel del inicio con su etiqueta, solo si está abierto y dentro de la cobertura del cliente.
- **Cobros** (`marketing_charges`): se crean al guardar una oferta o un destacado con precio y al programar una campaña push patrocinada (`sponsor_fee`). Al cancelar, el cargo pendiente se cancela. El admin marca «pagado» con una referencia. Todavía no se descuentan en el recibo de comisiones.
- Compatibilidad: las apps actuales no envían `offer_id`; su checkout es idéntico. La app nueva funciona aunque la base aún no tenga la 064, porque las llamadas se degradan a «sin promoción».

## Siguiente fase

1. Integrar los cobros de publicidad en el estado de cuenta y recibos del negocio.
2. Autoservicio: el negocio crea su oferta o destacado desde su portal y PideYa lo aprueba.
3. Envío gratis financiado por el negocio (requiere definir quién paga al repartidor).
4. Ofertas en tiendas con surtido.
5. Cobro por pedido atribuido (modelo DoorDash) cuando haya volumen.
