# Forecast de gastos e ingreso por pedido — 1 noviembre 2026

Modelo de planeación, antes de impuestos. No es una factura ni una garantía de rentabilidad. No se contrataron planes ni cambiaron comisiones. Calculadora editable en `release-artifacts/2026-11-01-forecast/forecast-operativo.html` de la raíz del workspace; datos reproducibles en `forecast.json`.

## Supuestos

- 30 días; pedidos **completados y comisionables**, todos a domicilio.
- Tipo de cambio supuesto: USD 1 = MXN 20; no es cotización en vivo.
- Google optimizado: 6 consultas Directions Legacy y 2 solicitudes Static Maps por pedido, franquicias por SKU y tramos progresivos. El control de rutas ya está implementado en Cliente 1.4.1 (41) y publicado en superadmin; requiere instalar esa versión. Las 6 consultas por pedido son un supuesto del forecast: el límite implementado es por pedido y sesión de app en ventanas móviles de 20 minutos, no una cuota mensual global. Reinicios, sesiones largas y llamadas de otras apps pueden superar ese supuesto. No se agregan llamadas de Google Geocoding, que no se confirmaron como cargo de PideYa.
- La operación cobra efectivamente 95% de las comisiones facturadas; 5% queda como merma de cobranza. No es un porcentaje observado.
- Reserva de imprevistos: 15% de tecnología + operación.
- Meta: 30% de margen operativo sobre ingreso efectivamente cobrado, superior a 25%; no es margen neto después de ISR.
- Comida y envío pagado al repartidor no son ingreso disponible de PideYa. El ingreso por pedido suma únicamente comisión y cargo de servicio realmente retenidos, sin duplicar una misma comisión.

## Presupuesto tecnológico para 100 pedidos diarios

| Concepto | USD/mes | MXN/mes | Base |
| --- | ---: | ---: | --- |
| Google Maps optimizado | 40 | 800 | Proyección de llamadas, no consumo medido |
| Supabase | 35 | 700 | Pro de 25 + segundo proyecto Micro de 10, una organización y ambos proyectos presupuestados |
| Vercel | 20 | 400 | Pro, un desarrollador, antes de excesos de consumo |
| Resend | 20 | 400 | Provisión de lanzamiento; correos aún pendientes de activación |
| Procesos de notificación/correo | 25 | 500 | Presupuesto de hosting editable, no precio contratado verificado |
| Sentry/Grafana | 50 | 1,000 | Reserva conjunta; no afirma que esos planes estén contratados ni que tengan precio fijo combinado |
| Dominio y tiendas amortizados | 5 | 100 | Provisión; cargos anuales/únicos prorrateados, no necesariamente pagos mensuales |
| Expo | 0 | 0 | Conserva la elección de cuota gratuita; uso adicional se presupuesta aparte |
| **Tecnología total** | **195** | **3,900** | |

Referencias oficiales consultadas: [Google Maps](https://developers.google.com/maps/billing-and-pricing/pricing), [Supabase](https://supabase.com/pricing), [cómputo Supabase](https://supabase.com/docs/guides/platform/manage-your-usage/compute), [Vercel](https://vercel.com/pricing), [Resend](https://resend.com/pricing), [Resend Pro 50,000 correos](https://resend.com/changelog/pay-as-you-go-pricing), [Render](https://render.com/pricing), [Grafana](https://grafana.com/products/cloud/grafana/), [Sentry](https://sentry.io/pricing/), [Expo](https://expo.dev/pricing).

Vercel Hobby se destina a uso personal no comercial; por eso el presupuesto comercial contempla Pro. [Condiciones de Hobby](https://vercel.com/docs/plans/hobby). No se presupuestan licencias de desarrollador Vercel para cada trabajador del panel PideYa: son accesos distintos.

No fue posible leer de forma fiable la página de precios de Sentry mediante el buscador; se conserva como reserva, sin atribuirle una tarifa concreta. Render, monitoreo y dominio se mantienen como asignaciones editables. Los importes del modelo son presupuestos para lanzamiento, no afirmaciones de los planes actuales de cada cuenta.

## Operación humana y comercial

El propietario confirmó el 1 de noviembre de 2026 un presupuesto inicial total de **MXN 15,000/mes** para soporte, mantenimiento, marketing y cobranza, incluyendo su tiempo. El desglose siguiente es una propuesta de distribución; los aumentos por crecimiento siguen siendo supuestos:

| Concepto | MXN/mes |
| --- | ---: |
| Soporte y administración, incluyendo tiempo del propietario | 6,000 |
| Mantenimiento técnico | 4,000 |
| Marketing y promoción | 3,000 |
| Cobranza, traslados y comunicaciones | 1,000 |
| Contabilidad | 1,000 |
| **Total** | **15,000** |

No son cotizaciones ni salarios completos de personal contratado. Reemplazar por costos reales, cargas laborales, turnos y cobertura necesaria. Si se usan servicios compartidos con otros negocios, asignar a PideYa su parte, sin sumar facturas ajenas completas ni contar dos veces un costo ya incluido.

## Forecast mensual en MXN

| Pedidos/día | Pedidos/mes | Google | Tecnología | Operación | Total con reserva | Cobro para ≥30% | Ganancia a $12/pedido antes de ISR |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30 | 900 | 0 | 3,100 | 15,000 | 20,815 | 35 | -10,555 |
| 100 | 3,000 | 800 | 3,900 | 15,000 | 21,735 | 11 | 12,465 |
| 300 | 9,000 | 4,720 | 8,820 | 18,333 | 31,226 | 6 | 71,374 |
| 500 | 15,000 | 8,800 | 12,900 | 21,667 | 39,752 | 4 | 131,248 |
| 1000 | 30,000 | 17,400 | 22,800 | 30,000 | 60,720 | 4 | 281,280 |

Los cobros se redondean hacia arriba a pesos completos. Son pisos matemáticos bajo estos supuestos, **no una recomendación de bajar el precio al crecer**.

Supabase se provisiona en USD 35 hasta 100 pedidos/día, USD 85 a 300–500 y USD 150 a 1,000. El tramo de 85 sirve como referencia de Pro + producción Medium + staging Micro − crédito de cómputo; 150 es una reserva de mayor cómputo/uso, no un plan con ese nombre. No se afirma que un volumen diario obligue a esos cambios: deben decidirse por carga simultánea, usuarios activos, índices, fotos/egreso, almacenamiento y Realtime. Vercel se mantiene en USD 20 de base; los sobreconsumos requieren medición y pueden superar la reserva.

El presupuesto de operación se mantiene en 15,000 hasta 100 pedidos diarios, crece linealmente hasta 30,000 a 1,000 pedidos diarios y se mantiene en ese tope. Es el escenario de planeación solicitado; se puede sustituir por un monto fijo en el simulador. No es una estimación de personal suficiente certificada por los ensayos de carga. Las consultas de usuarios que no compran, reembolsos y entregas fallidas pueden elevar el costo sin generar comisión.

## Cálculo del precio y recomendación

```text
Ingresos cobrados = pedidos completados × ingreso medio por pedido × 0.95
Gasto previsto = (tecnología + operación) × 1.15
Margen operativo = (ingresos cobrados − gasto previsto) / ingresos cobrados
Ingreso medio necesario = gasto previsto / (pedidos × 0.95 × 0.70)
```

Aplicar un recargo de 25% al costo da solo 20% de margen. Para 25% de margen se divide entre 0.75; para 30%, entre 0.70. Mensualidades a negocios pueden cubrir parte del ingreso objetivo; el simulador admite ese monto facturado y aplica la misma tasa de cobranza.

Como hipótesis comercial inicial, mantener **MXN 12 de ingreso promedio por pedido, antes de IVA**, sujeto a validación de demanda y acuerdos. Si parte ya corresponde a la comisión del negocio, cuenta dentro de esos 12; no se añade de nuevo automáticamente al cliente.

Con 100 pedidos/día:

- Facturación por comisiones: 3,000 × 12 = 36,000.
- Cobranza esperada al 95%: 34,200.
- Gasto con reserva: 21,735.
- Utilidad operativa prevista antes de ISR: 12,465, equivalente a 36.4% del ingreso cobrado.

Con 30 pedidos/día, cobrar 12 deja una pérdida prevista de 10,555/mes. El piso de 35 puede ser comercialmente inviable: en esa etapa hay que reducir costo fijo, financiar el arranque o acordar ingresos mensuales con negocios. No se garantiza 25% de ganancia con cualquier volumen ni se aconseja trasladar automáticamente 35 al usuario.

La meta de este modelo es operativa. Para exigir además un margen neto después de impuestos, usar la tasa efectiva que confirme contabilidad:

```text
margen operativo requerido = margen neto objetivo / (1 − tasa efectiva de ISR)
```

Ejemplo solo de sensibilidad: con una tasa efectiva hipotética de 30%, conseguir 25% neto exige aproximadamente 35.7% operativo. El ejemplo de 12 por pedido a 100/día dejaría aproximadamente 25.5% tras esa tasa hipotética. Esto no determina el régimen fiscal ni la tasa aplicable a PideYa.

## Exclusiones y caja

No se incluyen inversión de desarrollo inicial, oficina, personal adicional fuera del presupuesto, IVA/ISR, subsidios de reparto, devolución del valor completo de comida o fraude por montos superiores a la comisión. Si PideYa paga al repartidor, ese pago es un costo y debe incorporarse. Si activa tarjetas, incluir las comisiones de pasarela sobre el **total procesado**, no solo sobre el ingreso de PideYa.

Al cobrar a negocios mensualmente, utilidad no equivale a efectivo disponible cada día. Para el escenario de 100 pedidos/día, una reserva inicial orientativa de dos meses del gasto previsto sería **MXN 43,470**, aparte de inversión inicial, impuestos o anticipos a repartidores. No es un cargo adicional por pedido ni un gasto mensual duplicado.

Falta contrastar facturas de proveedores, tipo de cambio pagado, ingreso medio actual por comisión, porcentaje de pedidos comisionables, cobranza, presupuesto humano y situación fiscal. No se cambiaron planes ni tarifas durante esta proyección.


## Visibilidad de ingresos y control de rutas — actualización del 1 de noviembre

El simulador HTML permite separar pedidos de consultas: elegir cálculo de Google por pedido o introducir consultas mensuales independientes. No se puede deducir cuántos pedidos hubo solo con el número de consultas.

Ejemplo condicionado a **12,500 pedidos mensuales** (8 consultas de rutas y 2 mapas estáticos por pedido): 100,000 Directions + 25,000 Static Maps cuestan USD 480 según los precios usados por el modelo, equivalentes a MXN 9,600 a tipo de cambio 20. A MXN 12 por pedido se facturan 150,000; después de Google quedan 140,400, antes de los demás gastos. Con cobranza del 95% quedan 132,900 después de Google. Incluyendo todos los gastos presupuestados y reserva, la utilidad estimada es 103,425.30 antes de ISR. Ese tramo usa 20,278 de operación con la nueva progresión gradual y tope de 30,000.

| Pedidos/día | Pedidos/mes | Facturado a $12 | Cobrado 95% | Google MXN | Todos los gastos con reserva | Utilidad antes de ISR |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30 | 900 | 10,800 | 10,260 | 0 | 20,815 | -10,555 |
| 100 | 3,000 | 36,000 | 34,200 | 800 | 21,735 | 12,465 |
| 300 | 9,000 | 108,000 | 102,600 | 4,720 | 31,226 | 71,374 |
| 500 | 15,000 | 180,000 | 171,000 | 8,800 | 39,752 | 131,248 |
| 1000 | 30,000 | 360,000 | 342,000 | 17,400 | 60,720 | 281,280 |

Esta tabla usa 6 rutas y 2 mapas por pedido, diferente del ejemplo anterior de 8 rutas. Es una proyección, no una factura ni una garantía de margen. La tarifa de reparto y el valor de los alimentos no son ingreso de PideYa en este modelo.
