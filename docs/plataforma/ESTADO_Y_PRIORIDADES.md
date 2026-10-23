# Estado y prioridades de PideYa

Actualización: 23 de octubre de 2026. Base: código, manuales, pruebas y despliegues registrados en este repositorio y la conversación de liberación. No es una auditoría exhaustiva de seguridad, finanzas ni capacidad, y no supone que las pruebas físicas del propietario hayan pasado sin registrar sus resultados.

## Estimación de avance

**Aproximadamente 70% de preparación para un piloto controlado de restaurantes en uno o dos pueblos**, con efectivo y flota propia/temporal validada por el negocio. Es una estimación profesional, no una medición automática por líneas de código. El alcance no incluye apertura simultánea de veinte pueblos, tarjetas, todas las categorías ni 50.000 usuarios concurrentes.

| Dimensión | Peso en la estimación | Preparación estimada | Evidencia / limitación |
|---|---:|---:|---|
| Producto y reglas necesarias para el piloto | 60% | 85% | Cuatro superficies, pedidos, catálogo, turnos, caja, incidencias, panel y campañas implementados; quedan integración UX y pruebas reales. |
| Validación integral y calidad en dispositivos | 25% | 45% | Builds, pruebas automáticas y SQL; falta acreditar recepción push, Redmi, recuperación de señal y recorrido físico completo. |
| Preparación de operación y recuperación | 15% | 50% | Reglas y controles definidos; faltan responsables, tiempos de soporte, cierre diario y ensayo de recuperación documentados. |

Cálculo orientativo: 0,60 × 85 + 0,25 × 45 + 0,15 × 50 = 69,75, redondeado a 70. Las ponderaciones y notas son juicios explícitos y se revisarán con evidencia. No equivalen a porcentaje del presupuesto, probabilidad de éxito o calendario restante. **La capacidad de 50.000 usuarios simultáneos no está acreditada** y no se le asigna un porcentaje a partir de una prueba sintética de cola.

## Lo que ya existe

- Cliente: catálogo/cobertura, variantes, pedidos en efectivo, cancelación previa a aceptación y reglas de faltantes.
- Negocio: móvil/tablet, guía inicial, pedidos/cocina, repartidores y caja.
- Repartidor: acceso por código, turnos, una custodia activa, reservas, retorno y confirmación de entrega persistida localmente.
- Administración: negocios, pedidos filtrados, comisiones por corte, categorías/pilotos, reportes, mapa e incidencias/anti-spam.
- Notificaciones: cola transaccional, rutas por app, reintentos, caducidad y worker supervisado.
- Campañas: segmentos por negocio/plataforma, vista previa, cobertura, límites y seguimiento de compras posteriores. Publicadas el 23/10, sin campañas reales enviadas durante la entrega.

«Existe» no significa «validado en campo». Ver las limitaciones de cada manual.

## Bloqueantes antes de ampliar el piloto

| Prioridad | Falta o evidencia pendiente | Criterio de cierre |
|---|---|---|
| P0 | Prueba física completa cliente → negocio → repartidor → caja | Completar y documentar todos los escenarios de pruebas.md, incluido rechazo, devolución y diferencia de efectivo; sin errores críticos abiertos. |
| P0 | Notificaciones reales en Redmi y otros Android | Registrar dispositivos y demostrar recepción con pantalla bloqueada, segundo plano y ahorro de batería; medir demoras y comprobar recuperación. El último conteo conocido de endpoints cliente era cero. |
| P0 | Mala señal y cierres inesperados | Cortar conexión antes/después de recoger y confirmar; reabrir y verificar un solo resultado, total exacto y custodia conservada. Fotos/incidencias todavía requieren conexión. |
| P0 | Dinero en efectivo | Acordar y probar cambio, regreso, diferencia, devolución, cierre diario y responsable de resolver saldos. No liberar custodia con dinero pendiente sin un proceso autorizado. |
| P0 | Ubicaciones y cobertura reales | Verificar accesos de negocios y domicilios rurales del piloto. Resolver el negocio detectado sin coordenadas válidas. Un radio geográfico no demuestra que una carretera sea transitable. |
| P0 | Recuperación y soporte | Nombrar responsable y horario, definir escalamiento, ensayar respaldo/restauración y rollback compatible; registrar resultados. No se afirma que esas capacidades no existan, sino que falta evidencia de su ensayo. |

## Mejoras prioritarias después de cerrar los bloqueantes

1. **Completar la experiencia de campañas en cliente:** pantalla para activar/desactivar publicidad, enlace al negocio patrocinador y condiciones visibles. Hoy tocar el push abre la app. No vender clics, retorno incremental o ventas garantizadas sin instrumentación. El precio acordado no ejecuta cobros.
2. **Calidad de datos:** conservar `client_user_id` en pedidos nuevos y mostrar cobertura de identificación en métricas. No asignar a una cuenta las 44 entregas históricas sin usuario usando teléfono o nombre como suposición. Los tiempos históricos anómalos deben distinguirse de operación nueva.
3. **Observabilidad:** crash/ANR móvil, éxito de login/checkout, edad de cola, demoras de aceptación, fallos push, incidencias y saldos sin cerrar; alertas con responsable. La salud del worker no verifica por sí sola toda la cadena.
4. **Afinar seguridad y acceso:** códigos de invitación de un solo uso, revocación/sesiones, protección en el borde frente a abuso y revisión de permisos. Los bloqueos por cuenta actuales no constituyen un WAF por IP.
5. **Comisiones y cobros comerciales:** pagos parciales, correcciones/reversos auditados, conciliación de recibos antiguos y proceso de patrocinios. No confundir registrar dinero con transferirlo o facturarlo.
6. **Consistencia visual móvil:** consumir los iconos de categoría del catálogo en cliente; las imágenes locales de la APK no cambian con el despliegue web.

## Fases que no deben confundirse con terminar el piloto

- Frutería/carnicería: mantener piloto; paquetes de peso fijo hasta validar peso real y total final. No habilitar sustitutos libres. Alternativas exactas por producto requieren implementación/validación específica.
- Tarjetas: integración, confirmación servidor, reembolsos, conciliación y pruebas antes de activarlas. Hoy el servidor admite efectivo.
- Expansión territorial: abrir por localidad y capacidad real, con seguimiento de rechazos, incidencias y tiempos de ida/vuelta/caja.
- Escala: carga integral de API/base de datos/cola, concurrencia, cuotas de proveedor, costos, fallos y recuperación. La prueba local de 50.000 registros no acredita 50.000 usuarios simultáneos.

## Cómo subir la estimación con evidencia

No sumar puntos por añadir pantallas. Actualizar esta evaluación cuando haya pruebas físicas aprobadas, incidencias resueltas y operación conciliada. Antes de lanzamiento, todo bloqueante P0 debe estar cerrado aunque el promedio estimado sea alto. Para continuar conviene ejecutar el protocolo con un restaurante y un repartidor, corregir lo encontrado y después repetir con otro negocio y un domicilio rural.

Responsabilidades propuestas: propietario PideYa coordina negocios, teléfonos y operación real; desarrollo corrige/instrumenta; negocio valida acceso/capacidad y recibe efectivo; repartidor comprueba turnos, señal, entrega y retorno. Acordar quién atiende cada incidencia antes de abrir al público.

## Referencias internas

- [Prueba integral y registro de evidencia](pruebas.md)
- [Despliegues y artefactos](despliegues.md)
- [Investigación 2023–2026 y prioridades](INVESTIGACION_DELIVERY_2023_2026.md)
- [Manual de administración](admin.md)

## Revisión posterior de seguridad (23/10)

La [revisión de seguridad y capacidad](SEGURIDAD_CAPACIDAD_Y_ACTUALIZACIONES.md) corrigió los permisos de funciones internas con 051 aplicada. Identificó bloqueantes adicionales antes de apertura pública: permisos de columnas de perfiles, eliminación de cuenta por identidad y límites de alta/API. Deben incorporarse al cierre de P0; el 70% anterior no certifica seguridad ni autoriza el lanzamiento. No se acreditó capacidad concurrente ni staging aislado.
