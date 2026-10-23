# Despliegues · actualizado el 23 de octubre de 2026
Base de datos: migraciones 030a–050 aplicadas. Web: proyecto Vercel rancho-eats / www.pide-ya.app. Apps EAS bajo pideya1.

Las tres compilaciones EAS terminaron con estado FINISHED. Cliente AAB para carga manual: no se ejecuta submit a Google Play. El workflow de cliente se mantiene manual durante esta configuración.

No reutilizar APK anteriores como evidencia de esta liberación.

Compilaciones terminadas:
- Negocios 1.4.0 / 10: https://expo.dev/accounts/pideya1/projects/pideya-restaurant/builds/bb090707-665f-406a-b6cc-05699dee6134
- Repartidor 1.1.0 / 7: https://expo.dev/accounts/pideya1/projects/pideya-driver/builds/fee821f2-77d1-4a4c-82aa-8d5e346a9b86
- Cliente 1.3.0 / 31: https://expo.dev/accounts/pideya1/projects/pide-ya/builds/87a3bda0-2696-4767-bf77-128e3e1cee6f

Render: https://dashboard.render.com/web/srv-dbd6atbncjis73b9jn30 . Plan Starter permanente, endpoint /healthz. Variables web públicas persistidas en Vercel; secretos solo en Render.

Categorías iniciales: restaurantes públicos; frutería y carnicería piloto; otras cerradas. Falta el correo de cliente de pruebas para habilitar su piloto.

Git: cliente 0e98e51, repartidor 27f5a74 publicados. Negocios 2c6595d: repositorio privado autorizado por el propietario; push completado en https://github.com/mov1datc1/pideya-restaurant.

La compilación anterior de repartidor (build 6) quedó reemplazada por build 7, que serializa confirmaciones offline concurrentes. Usar únicamente el enlace final de arriba.

Cliente confirmado FINISHED: [AAB 1.3.0 build 31](https://expo.dev/artifacts/eas/8emmoH-hnVcSSvLXGKHDN9qD6qLRVU7w8kSIeFpKn7g.aab). Copia local en `releases/2026-10-22` del workspace. No se ejecutó submit a Play.

Negocios confirmado FINISHED: [APK 1.4.0 build 10](https://expo.dev/artifacts/eas/YqXrOu7gKKJBwuuXjCm4GzRPf20rI9Mi6xg0QgM5qlw.apk).

Repartidor confirmado FINISHED: [APK 1.1.0 build 7](https://expo.dev/artifacts/eas/c9-SnkXzyQS6-4eTp2SAonRX_lYfhNB6MoLwn0pJw9Q.apk).

Verificación final: panel de producción muestra los controles «Cerrar categoría» y «Abrir piloto». El push previo publicó esos cambios; no fue necesario repetir el despliegue manual. Servicio de notificaciones: `/healthz` respondió `healthy: true`.

Validación automatizada: 63 pruebas entre las aplicaciones, web y worker; comprobaciones TypeScript y Expo Doctor satisfactorias. La prueba sintética local procesó 50 000 registros de pedidos y entregas de notificaciones; no certifica 50 000 usuarios simultáneos ni entrega real de push en teléfonos. Sigue pendiente la prueba física completa con permisos de notificaciones, sesión iniciada y pantalla bloqueada, además de verificar apertura en Redmi.

Las copias locales y sus SHA-256 están en `releases/2026-10-22` del workspace, fuera de los repositorios de código.

Actualización del panel (045–046): migraciones aplicadas, consultas de pedidos/cobros por fechas CDMX y campañas durables. Publicación automática de web y worker desde main. Verificado en sesión real: filtro anual de Birrieria La Abuela devuelve 53 pedidos con dos páginas; balance anual agrega los entregados; estudio de campañas muestra límites y no contiene campañas nuevas. Datos históricos con total distinto del desglose se señalan sin recalcular ni alterar sus importes. Pruebas: calendario, centavos, SQL de cobros/permisos/cola y elegibilidad de campañas; no se registraron cobros ni publicidad reales.


## Liberación confirmada el 23 de octubre de 2026

- Commit `1ae2e36ca7b80fc868267ae6293aa99cfe98ad4e` publicado en `mov1datc1/rancho_eats`, rama `main`, con autorización del propietario.
- Vercel confirmó despliegue satisfactorio. El paquete público contiene `admin_campaign_preview`, `admin_schedule_targeted_campaign` y «Calcular audiencia».
- Render: despliegue `dep-dbdm50jm8hqs73egd6sg`, estado `live`, mismo commit, finalizado el 23/10/2026 a las 13:35:46 UTC. `/healthz` respondió `healthy:true`; consulta de errores inmediatamente posterior sin resultados. Es una comprobación puntual, no una garantía de disponibilidad futura.
- Migraciones 047–049: catálogo visual, reportes agregados, mapa, restricciones temporales y verificación de ubicación. Migración 050: campañas por comportamiento, alcance por negocio, cobertura y asociación temporal de compras.
- Última ejecución conjunta: 31 pruebas JavaScript de web/worker correctas. Pruebas SQL locales de segmentación, exclusiones, programación, encolado, idempotencia y asociación de compra satisfactorias, con ROLLBACK y sin proveedor push real.
- No se crearon campañas, no se enviaron promociones y no se cobraron patrocinios durante la validación.
- No se generaron APK/AAB nuevos con estos cambios web/servidor. Los artefactos móviles anteriores conservan las limitaciones descritas en sus manuales.
- Última lectura del 22/10/2026 a las 22:01 CDMX: 0 cuentas cliente con endpoint push activo, 0 campañas y 44 entregas sin `client_user_id`. Son datos de esa consulta; recalcular audiencia para conocer el estado actual.

Pendiente: validar visualmente el nuevo flujo completo de campañas autenticado y realizar la prueba física integral. Un despliegue exitoso no acredita recepción de notificaciones ni operación rural completa.

## 23/10 — permisos internos de base (051)

Aplicada `051_internal_function_privileges.sql`: revoke explícito de helpers/procesadores de campañas para PUBLIC/anon/authenticated, admin RPC solo autenticadas con validación interna y defaults de funciones creadas por postgres sin acceso público automático. Se conservan rutas de las APK y worker. Prueba previa con ROLLBACK y verificación posterior `tests/security-privileges.sql` aprobadas; 31 pruebas JavaScript aprobadas. Sin envíos push ni cambios de pedidos. No hubo nueva APK ni despliegue web/worker. Migración, informe y mejora de CI quedan locales pendientes de commit/push. Ver `SEGURIDAD_CAPACIDAD_Y_ACTUALIZACIONES.md` para riesgos aún abiertos.

## 23/10 — preparación de staging y monitoreo

El commit `88cafe4` publicó la corrección 051 y la documentación previa; CI aprobada. Se creó Supabase persistente `pideya-staging` sin datos y ramas staging en los cuatro repositorios. Las previews de Vercel y secretos del entorno GitHub staging usan ese proyecto aislado. 052 de métricas agregadas aplicada primero en staging y después en producción, solo service_role. Ver `STAGING_VERSIONES_Y_MONITOREO.md` para preparación y limitaciones: Grafana/alertas, worker y APK de QA siguen pendientes.
