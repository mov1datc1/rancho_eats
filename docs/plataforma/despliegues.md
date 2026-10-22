# Despliegues · 22 de octubre de 2026
Base de datos: migraciones 030a–044 aplicadas. Web: proyecto Vercel rancho-eats / www.pide-ya.app. Apps EAS bajo pideya1.

Artefactos de esta liberación y revisión de servicios: se registran al terminar las compilaciones. Cliente AAB para carga manual: no se ejecuta submit a Google Play. El workflow de cliente se mantiene manual durante esta configuración.

No reutilizar APK anteriores como evidencia de esta liberación.

Compilaciones solicitadas (consultar estado; no equivalen a éxito hasta FINISHED):
- Negocios 1.4.0 / 10: https://expo.dev/accounts/pideya1/projects/pideya-restaurant/builds/bb090707-665f-406a-b6cc-05699dee6134
- Repartidor 1.1.0 / 7: https://expo.dev/accounts/pideya1/projects/pideya-driver/builds/fee821f2-77d1-4a4c-82aa-8d5e346a9b86
- Cliente 1.3.0 / 31: https://expo.dev/accounts/pideya1/projects/pide-ya/builds/87a3bda0-2696-4767-bf77-128e3e1cee6f

Render: https://dashboard.render.com/web/srv-dbd6atbncjis73b9jn30 . Plan Starter permanente, endpoint /healthz. Variables web públicas persistidas en Vercel; secretos solo en Render.

Categorías iniciales: restaurantes públicos; frutería y carnicería piloto; otras cerradas. Falta el correo de cliente de pruebas para habilitar su piloto.

Git: cliente 0e98e51, repartidor 27f5a74 publicados. Negocios 2c6595d: repositorio privado autorizado por el propietario; push completado en https://github.com/mov1datc1/pideya-restaurant.

La compilación anterior de repartidor (build 6) quedó reemplazada por build 7, que serializa confirmaciones offline concurrentes. Usar únicamente el enlace final de arriba.

Cliente confirmado FINISHED: [AAB 1.3.0 build 31](https://expo.dev/artifacts/eas/8emmoH-hnVcSSvLXGKHDN9qD6qLRVU7w8kSIeFpKn7g.aab). Copia local en `releases/2026-10-22` del workspace. No se ejecutó submit a Play.
