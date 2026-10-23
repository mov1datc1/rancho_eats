# Validación de la plataforma

`npm run build` verifica TypeScript y compila la web. `node --test tests/*.test.cjs` ejecuta pruebas de catálogo y métricas. `cd notification-worker && npm test` verifica entrega, reintentos, recibos, aislamiento y respuestas HTTP.

`release-operations.sql` se ejecuta exclusivamente en PostgreSQL local desechable con el esquema público real, roles anon/authenticated/service_role, auth.users de prueba, auth.uid()/auth.role(), extensiones UUID y cron.schedule simulado. Aplicar primero migraciones 030a y 031–044 en orden. El script usa transacción con ROLLBACK y verifica plazo de diez minutos, consentimiento horario, cancelación, custodia única, cobro, devolución, diferencias, conciliación, categorías piloto, caducidad, RLS real y métricas completas. Nunca ejecutarlo contra producción.

La prueba física está en docs/plataforma/pruebas.md. Los push requieren instalar las nuevas compilaciones y registrar dispositivos reales; compilar correctamente no prueba entrega de notificaciones.

`admin-modules.sql` prueba catálogo cerrado por defecto, permisos de mapas/reportes, alta sin autoaprobación, verificación del pin, bloqueo de traslado con pedidos activos, límites de pedidos, reportes de abuso, restricción y revocación auditadas. Ejecutar únicamente en PostgreSQL desechable con auth/storage simulados, esquema y migraciones hasta 049. Todo el escenario termina en ROLLBACK; no usar datos reales.
