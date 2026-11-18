# Publicación coordinada — 29 de octubre de 2026

Trabajo autorizado: completar ajustes de lanzamiento y generar APK Android de cliente, negocio y repartidor. Los APK usan producción y distribución interna; no se enviaron a las tiendas.

## Servidor y web

- Staging `rganzksyljjerfuowodi`: aplicadas 053–057 en una transacción. La primera ejecución detectó una firma histórica ampliada de `driver_get_session`; se revirtió íntegramente y se corrigió 056 para conservar tanto la firma de 015 como la ampliada del servidor.
- Prueba real sobre staging: `tests/hosted-launch-smoke.sql` pasó cotización, snapshot, aceptación del pedido, turno, oferta, aceptación del repartidor sin custodia prematura, confirmación física, salida, cobro, desactivación con custodia, liquidación exacta y cierre del acceso revocado. Todos los usuarios, pedidos y registros de outbox sintéticos se revirtieron mediante ROLLBACK.
- Producción `apnxrbuqwgnfuelqjjfy`: 053 ya existía; se aplicaron 054–057 transaccionalmente, con RLS y recarga de PostgREST. Antes de aplicar: cero pedidos activos, una custodia abierta. No se ejecutaron liquidaciones, cobros ni pedidos de prueba en producción.
- Contratos públicos comprobados después del reinicio: lectura de `delivery_pricing` y columna `delivery_enabled`, HTTP 200. Tarifa vigente: $20 / 1 km / $5 adicional / tope $80.
- Web: despliegue Vercel `dpl_8DwrbmxXHRHjcmXYuTMEpJhAoDZR`, READY, publicado en `https://www.pide-ya.app`. Ruta de superadmin: `/administrador`.
- Verificación autenticada del bundle desplegado: backend de producción, `admin_save_delivery_pricing` y `merchant_confirm_handover` presentes. La comprobación pública directa desde terminal ha dado timeout; no se confundió la página de autenticación de Vercel con el bundle real. El propietario confirmó que `/administrador` abre desde un celular con datos móviles. El fallo queda limitado a esta conexión, no se modificó DNS. No se deshabilitó Deployment Protection ni la validación TLS. Vercel CLI generó su token de acceso de diagnóstico al usar `vercel curl` autenticado.
- `.vercelignore` excluye credenciales, archivos .env, worker, SQL y pruebas de la subida web.

## Sentry

Organización `movida-tci`, con proyectos independientes:

- `pideya-cliente`: https://movida-tci.sentry.io/projects/pideya-cliente/
- `pideya-negocio`: https://movida-tci.sentry.io/projects/pideya-negocio/
- `pideya-repartidor`: https://movida-tci.sentry.io/projects/pideya-repartidor/

SDK instalado según Expo: 7.2.x para SDK 54 y 7.11.x para SDK 57. Inicialización y envoltura de raíz, integración Metro y plugin Expo. Errores y trazas al 5%; sin Session Replay, capturas de pantalla ni jerarquía de vistas. No se activó recolección masiva de logs de consola. Excepciones esperadas de negocio no deben disparar alertas técnicas.

Filtro previo a envío: elimina usuario, petición, extras, breadcrumbs, mensajes libres y argumentos de spans; conserva ubicaciones de pila para depuración y etiquetas operativas limitadas. Se configuraron scrubbers de organización, campos sensibles e IP, privacidad reforzada y desactivación de compartir incidencias anónimamente. Todos esos valores se volvieron a verificar guardados después del reinicio; evidencia en `release-artifacts/2026-10-29/sentry-privacy.png`.

El propietario autorizó específicamente crear el token `PideYa EAS builds`, scope `org:ci` (mapas, versiones y code mappings), y guardarlo como **secreto** `SENTRY_AUTH_TOKEN` en los tres proyectos EAS. El token no está en Git ni en el código de las apps. La copia temporal desapareció al reiniciar macOS; no se regeneró. Los DSN son claves públicas de ingestión y están en las variables de producción EAS.

Después del reinicio, Sentry aceptó tres eventos sintéticos de nivel informativo sin datos personales, HTTP 200; recibos en `release-artifacts/2026-10-29/sentry-smoke.json`. Esto acredita ingestión, no una prueba de crash real en un teléfono. La subida de mapas se comprueba en los logs de los builds.

## Apps y configuración

| App | Versión | Expo / React Native | Proyecto EAS |
|---|---|---|---|
| Cliente | 1.4.0 | 54 / 0.81.5 | pide-ya |
| Negocio | 1.5.0 | 57 / 0.86.3 | pideya-restaurant |
| Repartidor | 1.2.0 | 54 / 0.81.5 | pideya-driver |

Perfil `release`: APK interno firmado, backend y variables EAS de producción, Node 22.22.0, notificaciones V2 habilitadas, demo deshabilitado y versión Android autoincrementada de forma remota. Negocio tenía contador remoto 4 frente a código local 12: se canceló el primer intento 5 y se elevó el contador a 12 para generar el código 13 actualizable.

`eas-build-pre-install` comprueba flags, endpoint Supabase, ausencia de clave privilegiada en cliente, DSN y token de subida de Sentry, organización/proyecto y correspondencia de FCM con el package Android. `.easignore` excluye archivos locales de entorno y credenciales; la configuración llega desde EAS.

Otras mejoras: fotos nuevas del negocio usan URL versionada y caché prolongada; seguimiento del cliente consulta cada 30 s en primer plano y con pantalla enfocada, conservando Realtime y reconciliación al volver; el dashboard del repartidor pausa consultas fuera de foco/primer plano. No se alteró el servicio GPS de entregas activas.

## Verificaciones

- Expo Doctor: 18/18 cliente, 18/18 repartidor, 21/21 negocio. Una repetición de negocio falló por respuesta externa de React Native Directory y la siguiente pasó completa.
- Bundles Android de las tres apps exportados correctamente con Node 22.
- 44 pruebas cliente (incluidas seis de privacidad, sobre los tres filtros), 20 repartidor y 21 negocio.
- 35 pruebas web/worker; TypeScript de apps y web, build Vite y guard de duplicados correctos.
- Las imágenes PNG de los tres proyectos tienen firmas correctas.
- Se aplicaron actualizaciones npm compatibles, sin `audit fix --force` ni cambio mayor de Expo. Quedan avisos de dependencias que requieren revisión específica; no se certificó ausencia total de vulnerabilidades.

## Artefactos y límites

Estado, recibos, pruebas, APK descargados y SHA-256 en `release-artifacts/2026-10-29` de la raíz del workspace. Ese directorio está fuera de los repositorios de las apps. Los intentos de subida sin build por timeout no deben distribuirse. Solo usar los recibos de estado FINISHED y los enlaces finales registrados en el manifiesto.

No se probó todavía este binario final en dispositivos físicos ni se ejecutó una prueba de carga representativa. Antes de abrir al público: instalar las tres versiones juntas, probar notificaciones con pantalla bloqueada, un pedido completo con extras y propuesta de tiempo, rechazo/reasignación, custodia, cobro y liquidación física, fotos/cámara, ubicación y teclado en Android con navegación por botones. Confirmar alertas y comportamiento con desconexión. No se habilitó Redis ni se prometió capacidad de usuarios sin mediciones.

## Entrega final de APK

Los tres builds finalizaron y se descargaron. Cliente 1.4.0 (39), negocio 1.5.0 (13), repartidor 1.2.0 (10). Los tres pasaron CRC completo del ZIP, presencia de manifiesto y bundle, backend de producción, ausencia de staging, proyecto Sentry correcto y ausencia del patrón de token privado en el bundle. Los logs cloud confirman subida de mapas de código y BUILD SUCCESSFUL en las tres apps.

Enlaces de descarga y SHA-256 en `release-artifacts/2026-10-29/README.md` y `manifest.json`.

Limpieza de disco autorizada: caché npm de paquetes, tres cachés npx prescindibles y CLI temporal de Vercel; aproximadamente 1.7 GiB liberados, 8 GiB disponibles. Se conservaron fuentes, dependencias de proyectos, Node 22 y APK.
