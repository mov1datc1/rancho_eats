# Prueba integral antes de abrir al público
1. Instalar APK nuevo de negocio y repartidor; cliente nuevo por Play interno. Iniciar sesión y aceptar permisos de notificaciones.
2. Admin: comprobar cinco negocios PRUEBA y sus catálogos. Elegir piloto de frutería para la cuenta de cliente de pruebas.
3. Cliente: ubicación en cobertura; pizza con tamaño, extras y notas. Crear pedido en efectivo.
4. Negocio: recibir con app abierta y bloqueada; comprobar sonido, detalle, ubicación y orden cronológico. Repetir con rechazo, cancelación previa y propuesta horaria aceptada/vencida.
5. Crear repartidor temporal, entrar con código, activar cuatro horas, asignar y recoger. Comprobar bloqueo de segunda salida y otro negocio.
6. Entregar y confirmar cobro. Cortar red, intentar confirmación, reabrir con conexión y verificar sincronización sin doble cobro. Revisar entrega en cliente.
7. Registrar devolución por dirección, verificar incidencia en negocio y admin. Recibir mercancía. Probar diferencia de efectivo y después conciliación correcta.
8. Frutería: faltante retirado, parcial consentida, todo faltante sin cobro. Verificar importe cobrado coincide con lista final.
9. Admin: filtros, tiempos, incidencias y alerta de dos horas sin cancelación automática.

Evidencia histórica de la liberación móvil del 22/10 (no repetida en cada cambio web): TypeScript de las cuatro apps; 23 pruebas cliente, 6 negocio, 9 repartidor (acceso y sincronización), 8 web y 17 trabajador; integración SQL de plazo, consentimiento, efectivo, piloto, caducidad y aislamiento entre clientes. Las pruebas automatizadas no sustituyen recepción física de push.

Prueba sintética local de cola: 50.000 pedidos → 50.000 entregas persistentes en 4.629 ms; ocho consumidores concurrentes, 100 reservas únicas en la ventana limitada, recuperación de leases y rechazo de confirmaciones antiguas; 99 ms para reserva/recuperación. No mide red Expo, recepción Android ni 50.000 usuarios reales simultáneos.


## Estado de validación al 23/10/2026

Esta lista es un protocolo, no una lista de pruebas físicas aprobadas. No hay resultados registrados aquí que acrediten todavía el recorrido completo en Redmi ni entregas rurales reales.

Últimas pruebas web/worker: 31 pruebas JavaScript correctas; compilación web correcta. SQL de campañas validado en base local desechable: alcance por negocio, solo entregados, umbrales, cobertura, permisos, preferencias, frecuencia, programación, encolado único y compras posteriores. No sustituye pruebas de carga ni dispositivos.

Agregar a la prueba integral:

10. Registrar endpoints reales de cliente, negocio y repartidor; comprobar recepción con primer plano, segundo plano y pantalla bloqueada, sin confundir recibo del proveedor con mensaje visto. Registrar modelo, versión, permiso, ahorro de batería y hora.
11. Campañas: comprobar audiencia y exclusiones; probar primera compra por negocio, recuperación y compra ocurrida después de programar. Cualquier envío real de prueba requiere seleccionar destinatarios de prueba y autorizarlo expresamente.
12. Preferencias publicitarias: validar exclusión en servidor. La pantalla móvil de preferencias y el enlace directo de publicidad al negocio aún están pendientes.
13. Recuperación: documentar y ensayar restauración de respaldo, reversión de versión compatible con migraciones y alerta de worker caído en un entorno aislado.

Por cada escenario registrar: fecha, versiones de las tres apps, negocio de prueba, ID de pedido, estado esperado/obtenido, importe, evidencia, incidencia y responsable. Marcar aprobado solo con resultado reproducible. No incluir claves, tokens ni datos personales innecesarios.
