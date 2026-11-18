# Acceso de administración — 30 de octubre de 2026

Corregido y publicado en https://www.pide-ya.app/administrador.

## Causa y corrección

`/administracion` no era una ruta reconocida. Montaba el componente general sin mostrar ningún módulo, iniciaba la selección de un negocio y sus consultas de catálogo. Los errores de red visibles en consola se producían en esa vista; el aviso de instalación de la PWA era independiente.

Vercel ahora redirige permanentemente `/administracion` y `/admin` a `/administrador`. El router también resuelve esos alias y las barras finales antes de montar la aplicación, conservando consulta y fragmento. Las rutas desconocidas muestran opciones para continuar en lugar de una vista vacía. La autenticación y los permisos del superadmin se conservan.

Se actualizó el service worker a `pideya-v6-admin-routes`: las navegaciones sin red ni caché reciben una página explícita de conexión; los fallos de recursos estáticos devuelven una respuesta controlada. No se guardan respuestas HTTP fallidas como shell ni respuestas de API como recursos estáticos. Un límite de errores de React muestra una acción para reintentar si falla la carga de un módulo. Esto no sustituye la conectividad de Supabase ni significa que las operaciones de administración funcionen sin conexión.

## Verificación y publicación

- 21 pruebas web aprobadas, incluidos alias de administración y fallos de red/caché simulados.
- Compilación de producción y TypeScript aprobados.
- Vercel: `dpl_3DXZxeENan4KsNm2avWHHxGsnPbW`, estado `READY`, alias `www.pide-ya.app`.
- Reproducido el fallo original en el navegador público y comprobada la redirección tras desplegar.
- Acceso realizado con las credenciales ya guardadas en el navegador, sin leerlas ni cambiarlas: sesión de superadmin activa, resumen, negocios y pedidos cargados.
- Vista móvil de 390 px verificada sin desbordamiento horizontal. Evidencia: `release-artifacts/2026-10-30-admin-entry/admin-mobile.png` en la raíz del workspace.

La CLI Vercel 42.2.0 instalada fue rechazada por el servicio. La publicación se completó con la CLI oficial 65.8.0 instalada temporalmente. Para siguientes despliegues usar una versión compatible (el endpoint exigía como mínimo 47.2.2).

No se aplicaron migraciones de base de datos ni se activó el correo de pedidos.
