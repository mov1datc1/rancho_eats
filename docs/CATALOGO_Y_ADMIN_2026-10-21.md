# Catálogo, variantes y revisión de administración

21 de octubre de 2026. Cambios locales; no son una publicación de las apps. Esta revisión combina inventario remoto de lectura, revisión de código, pruebas automatizadas y una vista previa visual. No certifica todo el sistema ni sustituye una compra de prueba en Android.

## Inventario confirmado

Supabase devolvió tres negocios activos: **La Guera**, **Vegas Frutas** y **Birrieria La Abuela**. La Guera usa una miniatura de Google Images; los otros dos guardan portadas base64 dentro de la fila. No se reemplazaron sus imágenes ni se modificaron sus datos.

El esquema remoto contiene `menu_item_options.option_type`, pero faltaba una migración versionada que lo estableciera. Se añadió `034_menu_option_type.sql` como reconciliación local. No se ejecutó remotamente. Una opción existente llamada «Adicionales» está marcada `size`: necesita revisión del comerciante, no se cambió automáticamente.

## Cinco negocios preparados

| Negocio ficticio | Categoría | Menú y prueba principal |
| --- | --- | --- |
| Forno 21 · PRUEBA | Restaurantes | Pepperoni, Margherita y agua; 3 tamaños por pizza, extras, extra gratuito |
| Huerta Clara · PRUEBA | Frutería | Manzanas por bolsa de 1 kg o pieza y canasta; faltantes y producto sin sustitución |
| Tacos del Patio · PRUEBA | Restaurantes | Orden de 3/5 tacos, guacamole, salsa gratuita y agua |
| Brasa Urbana · PRUEBA | Restaurantes | Hamburguesa con extras independientes y agua |
| Miga y Café · PRUEBA | Restaurantes | Croissant y americano con tamaños y shot extra |

Total: **5 negocios, 12 productos, 23 opciones, 7 fotografías generadas**. Fotos ilustrativas de comercios ficticios. Los productos sin foto específica usan el estado vacío de la app; no se les asignó una foto de otro plato.

Los archivos reproducibles están en `scripts/qa-catalog-data.mjs` y `scripts/seed-qa-catalog.mjs`. Los IDs son deterministas. El script no elimina negocios, no crea usuarios, pedidos ni mensajes. Una nueva ejecución vuelve a establecer los datos del catálogo QA; no usarla para sobrescribir ajustes manuales posteriores sin revisar el diff.

**Actualización 22/10: carga remota completada y autorizada.** Los cinco negocios quedaron asignados a la cuenta propietaria de La Guera. Se creó el bucket público `menu-images` que faltaba. Verificación con acceso público: ocho negocios activos, los doce productos nuevos disponibles, veintitrés opciones y cinco portadas HTTP 200. No se crearon pedidos ni se enviaron notificaciones.

Para inspeccionar el plan sin conectar a Supabase:

```sh
node scripts/seed-qa-catalog.mjs
```

Con credenciales de servidor autorizadas, el script requiere `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `QA_OWNER_SOURCE_ID`, y solo muta con `--apply`. No poner esas credenciales en variables VITE/EXPO_PUBLIC. El resultado verificado está en `docs/QA_CATALOG_RESULT.json`. La cuenta asignada es la propietaria de La Guera; no se cambian contraseñas. Los negocios activos de QA serán visibles a cualquier cliente del mismo backend, no solo al canal interno de Google Play: una separación exclusiva de testers requeriría staging o un filtro autorizado en servidor.

## Formato de imagen propuesto para PideYa

| Uso | Propuesta propia para PideYa |
| --- | --- |
| Foto original de producto | 1536 × 1024 o mayor, 3:2, producto centrado y márgenes para recorte |
| Presentación de tarjeta de negocio | Recorte visual panorámico; comprobar que no corte el plato |
| Miniatura de producto | Cuadrada en listas, manteniendo sujeto en el centro |
| Formato servido | JPEG para fotografía; WebP puede añadirse con variantes; PNG para transparencia/logos |
| Almacenamiento | Supabase Storage y URL, sin base64 en las filas |
| Objetivo de transferencia | Derivados de 150–350 KB para tarjetas y hasta ~500 KB para portada, medidos por imagen |

Estas dimensiones y presupuestos son nuestra propuesta, no requisitos de Uber/Rappi. La referencia de Uber recomienda producto identificable, iluminación suficiente, encuadre centrado y sin textos/logos superpuestos para las fotos de producto. Sus requisitos de portada son distintos. No estamos afirmando que estas imágenes generadas sean aceptables para publicarlas en Uber. [Guía oficial de fotografía](https://help.uber.com/en/merchants-and-restaurants/article/merchant-submitted-menu-photo-guidelines?nodeId=ec36c30b-3a94-4f7c-b401-769e8a245fff).

La subida web ahora valida JPEG/PNG/WebP, limita entrada a 10 MB, reduce el lado mayor a 1600 px y codifica JPEG con calidad 0.82. Crea nombres únicos para evitar imágenes viejas en caché. Si falla la subida no informa éxito guardando una foto vacía. Falta añadir generación central de miniaturas y presupuesto por imagen a todos los puntos de carga.

Las siete imágenes QA se generaron como originales PNG (aprox. 18 MB) y se conservaron en `qa/source-images/`. Se crearon derivados JPEG de 1200 × 800 en `public/qa-catalog/`, usados por la vista previa y el seed. La conversión conserva la imagen sin añadir ni quitar elementos. Las versiones JPEG pesan en conjunto 2.04 MB frente a 17.8 MB de originales PNG (aproximadamente 89 % menos). El peso final es de 232–390 KB por archivo, aproximadamente 2 MB en conjunto; se evita enviar los originales como parte del catálogo público.

## Variantes: lo que se corrigió

- El admin ya conserva `option_type` al insertar. Antes lo capturaba en el formulario y lo descartaba al guardar.
- Un extra de $25 ya no hace que una pizza de $199 tenga precio base $25. Se usa el menor tamaño completo, o el precio base cuando solo hay extras.
- Extras gratuitos válidos; entradas incompletas o precios inválidos producen error visible.
- El producto nuevo con opciones permanece no disponible hasta que las opciones se guardan. Si falla, queda desactivado para revisión, no vendible a un precio incompleto. Esta secuencia no sustituye un RPC transaccional de catálogo.
- En el cliente, un único tamaño disponible sigue siendo un tamaño. Ya no se convierte en extra ni duplica el precio.
- El carrito distingue opciones, precio y notas. Dos pizzas iguales con extras diferentes no se fusionan ni se sobrescriben.
- Si falla la carga de opciones, el cliente bloquea añadir ese producto y permite reintentar; no vende silenciosamente la versión base.
- La app de negocio permite ver, crear y editar tamaños/extras y su disponibilidad en el catálogo. Los tamaños tienen precio completo; extras tienen recargo. El precio base todavía se mantiene explícitamente en el formulario.
- Cocina y ticket de negocio muestran extras/notas; el precio de la línea incluye extras una sola vez.

La referencia de Uber organiza personalización mediante grupos con selección obligatoria y límites. PideYa hoy implementa **un tamaño + extras**, no un motor completo de grupos. [Referencia oficial](https://help.uber.com/en/merchants-and-restaurants/article/%C3%BAprava-menu?nodeId=156909ff-4025-44c7-a200-20b339f9fa93).

Pendientes para pizzerías más complejas: masas/bordes como grupos de selección exclusiva, límites por grupo, cantidad repetible de toppings, precio del extra según tamaño, mitades de pizza y disponibilidad de combinaciones. No simular estas reglas con notas libres si cambian el precio. El menú QA usa únicamente reglas que la app soporta actualmente.

## Sustituciones por categoría

| Flujo | Categorías actuales | Comportamiento |
| --- | --- | --- |
| prepared | Restaurantes | Sin preferencias de sustitución; tamaño/extras/notas de cocina |
| picked | Frutería, Carnicería, Pescadería, Cremería, Tiendas | Si falta: Sustituir / Quitar / Preguntarme. Si hay menos: Aceptar disponible / Quitar / Preguntarme |
| pharmacy | Farmacia | Consulta al cliente para cambios; no sustituir automáticamente |

«Preguntarme» es una preferencia operativa y confirmación en la app; no realiza una llamada telefónica automática. La implementación actual confirma el resumen ajustado; no tiene aún una conversación completa ni aprobación individual de cada propuesta antes de surtir.

La migración local 033 ahora rechaza iniciar surtido para restaurantes y también respeta `menu_items.allow_substitution=false`. Las preferencias no bastan sin que el servidor las haga cumplir. Las políticas amplias heredadas de la migración 027 permiten otras escrituras directas y siguen siendo un riesgo pendiente: estas comprobaciones del RPC no equivalen a haber corregido toda la RLS.

El selector móvil actual maneja unidades enteras. Por eso el QA usa una bolsa de 1 kg como unidad de venta, no pretende que el cliente pueda pedir 0.25 kg. Pesos variables requieren selector decimal, pasos/mínimos, cotización y ajuste final consistentes.

## Auditoría del panel web

| Hallazgo | Estado tras esta revisión |
| --- | --- |
| `App.tsx` mezcla admin, negocio, repartidor, catálogo público, reportes y notificaciones | Pendiente de separar por rutas/dominios; unas 5 mil líneas |
| Reconstrucción de líneas buscando una suma igual al total | Eliminada: ocultaba productos y mezclaba total con comisiones/envío |
| Formato móvil `quantity/price/options` frente a web `qty/unit_price` | Normalizador explícito; conserva todas las líneas, extras, notas y productos gratuitos |
| Extras vendidos como si fueran productos completos en vista pública web | Bloqueado. Esa vista aún no ofrece personalización de extras como la app móvil |
| Fotos base64 y guardado silencioso tras fallo | Corregido en creación/portada web; datos históricos no migrados |
| HTML sin escape en líneas del ticket | Corregido en líneas y campos de cliente del ticket; otros reportes necesitan auditoría propia |
| `npm run typecheck` no comprobaba proyectos referenciados | Ahora ejecuta `tsc -b --force` |
| Build reescribía automáticamente `App.tsx` para quitar duplicados | Retirado del build. Se conserva comprobación que falla explícitamente |
| RLS de pedidos/surtido, ajustes y Storage demasiado amplia | Riesgo pendiente; requiere migraciones revisadas y prueba de permisos remotos |
| Precios aceptados desde cliente sin cotización autoritativa integral | Pendiente: RPC de checkout que calcule catálogo/opciones y total en servidor |
| Editor web basado en `window.prompt`, mensajes/campañas y estados heredados | Pendiente de refactorización de UX y pruebas completas por rol |

El siguiente trabajo estructural debe separar catálogo, pedidos, usuarios, operación y ajustes; evitar una reescritura masiva que mezcle permisos, facturación y UI sin pruebas. No se declara el panel listo para operación masiva por haber compilado.

## Validación y cómo repetirla

- Cliente: exportación Android/Hermes correcta (no es un APK instalado); `npx tsc --noEmit`; `node --test tests/*.test.cjs` (23 pruebas).
- Web: `npm run build`; `node --test tests/catalog.test.cjs` (4 pruebas de esta revisión).
- Negocio: exportación Android/Hermes correcta; `npm run typecheck`; `npm test` (6 pruebas).
- PostgreSQL temporal: `tests/merchant-picking.sql`; verifica propietario, duplicados, farmacia, conservación de cargos, no sustitución por producto y exclusión de restaurantes. Sin conexión a Supabase.
- App de negocio en navegador: se abrió Catálogo, se añadió «Mozzarella extra» de $25 en demostración y se verificó «Opción guardada». No se modificó catálogo remoto.
- Vista visual: `npm run dev -- --host 127.0.0.1 --port 5182`, después `/qa-catalog.html`. Se comprobó pizza mediana $199 + mozzarella $25 = $224 y preferencias solo en la frutería.

La vista visual es una herramienta de revisión del catálogo, **no la app cliente real ni una prueba de notificaciones**. La app cliente no tiene dependencias web instaladas y no se ha probado este cambio en el Redmi. La carga remota ya terminó. Sigue pendiente el pedido completo cliente → negocio → repartidor en dispositivos físicos.

## Limpieza realizada y conservada

Se retiraron también los archivos regenerables `*.tsbuildinfo` del panel y se añadieron a `.gitignore`.

Se retiraron nueve archivos de componentes de la plantilla Expo sin referencias desde pantallas: animated-icon (nativo/web/CSS), external-link, hint-row, themed-view, themed-text, web-badge y ui/collapsible. Se comprobó que sus referencias eran internas al mismo grupo.

Se eliminó únicamente la caché regenerable `/private/tmp/pideya-npm-cache` creada durante este trabajo (~363 MB). No se borraron bases remotas, migraciones, claves, proyectos nativos, archivos de usuarios ni backups.

`Documentacion_pideya.md` se actualizó como índice y mapa vigente; su versión anterior se archivó en `.local-backups/docs-2026-10-21/`. Se amplió el documento existente de notificaciones. Las guías antiguas quedan identificadas como históricas: antigüedad por sí sola no demuestra que sea seguro borrarlas. El patch de rebranding y logs antiguos son candidatos a archivar tras revisar su contenido y trazabilidad.

## Imágenes y prompts

Herramienta: generación de imágenes integrada (no API/CLI externa). Originales conservados en `qa/source-images/` y derivados JPEG en `public/qa-catalog/` y fuente reproducible del menú en `scripts/qa-catalog-data.mjs`.

Dirección común del prompt: fotografía editorial de comida realista para un catálogo ficticio de delivery, fondo de piedra marfil, luz natural lateral suave, composición horizontal 3:2, sujeto centrado y margen para recorte, sin texto, logotipos, marcas de agua ni personas.

| Archivo | Sujeto pedido |
| --- | --- |
| pizzeria.png | Pizza completa de pepperoni con mozzarella y tomate, masa dorada |
| margherita.png | Pizza completa de tomate, mozzarella y albahaca, sin pepperoni |
| grocer.png | Caja de frutas con plátanos, manzanas, naranjas, aguacates y limones |
| apples.png | Tres manzanas Gala rojas con una hoja |
| tacos.png | Una orden de tres tacos al pastor con piña, cilantro, cebolla y limón |
| burger.png | Una hamburguesa de res con cheddar, lechuga, tomate y pepinillos, sin papas |
| cafe.png | Un croissant de mantequilla sobre plato marfil, sin bebidas |

La continuación de la revisión del admin y el diseño de afiliaciones están en [Reparto flexible y admin](REPARTO_FLEXIBLE_Y_ADMIN_2026-10-22.md).
