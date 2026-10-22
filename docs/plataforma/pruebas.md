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

Automatizadas: TypeScript de las cuatro apps; 23 pruebas cliente, 6 negocio, 5 acceso repartidor, 8 web y 17 trabajador; integración SQL de plazo, consentimiento, efectivo, piloto, caducidad y aislamiento entre clientes. Las pruebas automatizadas no sustituyen recepción física de push.
