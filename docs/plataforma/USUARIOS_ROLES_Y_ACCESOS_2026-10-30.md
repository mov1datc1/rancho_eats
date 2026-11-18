# Equipo, roles y accesos de PideYa — 30 de octubre de 2026

## Uso desde el panel

Entrar en **Administración → Configuración**. La cuenta principal dispone de cuatro pestañas:

- **General:** cuenta, notificaciones y GPS, conservando la operación existente.
- **Usuarios:** dar acceso a una cuenta existente con correo confirmado, asignar perfil, editar nombre, suspender/reactivar y, cuando esté conectado el correo, invitar o solicitar recuperación de contraseña.
- **Roles y permisos:** perfiles base y creación/edición de roles personalizados.
- **Actividad:** cambios de acceso, roles, solicitudes de correo y cambios de estado realizados por el equipo; lista paginada.

No se crearon cuentas de trabajadores reales ni se enviaron correos durante la implementación. El superadmin principal existente se conserva como cuenta protegida. No se permite suspenderlo ni degradarlo desde este módulo.

## Perfiles iniciales

| Perfil | Alcance |
| --- | --- |
| Superadmin principal | Plataforma y gestión del equipo. Cuenta protegida. |
| Administrador | Gestión de los módulos existentes de plataforma; no puede gestionar usuarios/roles ni resetear contraseñas del equipo desde Negocios. |
| Operación | Consulta pedidos e incidencias de pedidos; puede efectuar los cambios de estado autorizados, con motivo y control de concurrencia. |
| Finanzas | Consulta comisiones, saldos y recibos; registra dinero recibido mediante el mismo libro de comisiones, con recibo inmutable e idempotencia. No modifica tarifas ni acuerdos de cobro. |
| Comercial | Consulta negocios y contactos de solicitudes de incorporación. |
| Personalizado | Combinación de los permisos disponibles. Los cambios alcanzan también a quienes ya usan el rol. |

Los perfiles limitados entran por la misma dirección `/administrador`, pero reciben su propio espacio de trabajo y solo los módulos permitidos. No se les asigna el indicador antiguo de administrador completo. El permiso de escritura incluye el correspondiente permiso de consulta.

## Agregar, cambiar o suspender accesos

1. En Usuarios, elegir **Dar acceso a cuenta existente**. La cuenta debe tener el correo confirmado y una contraseña de inicio de sesión; si solo usa un proveedor social, necesitará configurar su contraseña mediante el flujo de correo antes de entrar con correo/contraseña.
2. Indicar nombre, correo y perfil, y guardar. Esto asigna acceso a una identidad existente; no crea una cuenta ni una contraseña.
3. La persona entra en `https://www.pide-ya.app/administrador` con su propia cuenta.
4. Para modificarla, usar **Editar acceso**. Suspender retira los permisos de administración/equipo; no borra su cuenta de cliente ni su historial.
5. Ante un aviso de cambio concurrente, actualizar y revisar de nuevo; el servidor evita sobrescribir una modificación reciente.

El servidor comprueba los permisos en cada operación. La pantalla actualiza el acceso al volver a enfocarla y cada 30 segundos mientras está visible. La suspensión impide nuevas operaciones aunque el JWT siga vigente; no cancela una operación que ya estaba ejecutándose.

## Qué puede cambiar Operación

- Pendiente → aceptado/rechazado, respetando el plazo y la aprobación de horario del cliente.
- Aceptado → en preparación/listo y en preparación → listo, para categorías de preparación.
- Listo → entregado únicamente si es recogida en el negocio.

Requiere motivo de 10 a 500 caracteres y el estado esperado al guardar. No cambia precios, productos, cliente, negocio, repartidor ni cantidades. No completa una entrega a domicilio, no salta el surtido, no reabre pedidos terminados y no avanza un pedido con custodia activa. Esas operaciones conservan sus flujos específicos de entrega, retorno y liquidación.

## Qué puede registrar Finanzas

Usa el mismo estado de cuenta y recibo que el negocio y el superadmin. Se conservan los controles de saldo esperado, cortes, asignación exacta de pedidos y referencia única del cobro. Repetir o enviar a la vez una confirmación no crea dos recibos. El trabajador registra únicamente dinero ya recibido; no puede marcarlo pagado mediante una escritura directa sobre tablas.

## Invitaciones y recuperación: preparación lista, SMTP pendiente

La revisión del panel de Supabase confirmó que producción usa el servicio básico de correo de pruebas. No se activó correo de acceso para trabajadores externos. En Usuarios se muestra este estado y los botones de invitación/recuperación quedan deshabilitados; la función de servidor también rechaza esos envíos. Dar acceso a cuentas existentes sí está disponible.

La función `staff-auth` está preparada para **Supabase Auth**, con identidad comprobada mediante `getUser`, permiso de cuenta principal, límite de 20 solicitudes por día por responsable y espera de 90 segundos por destinatario. No recibe ni crea una contraseña elegida por el administrador. El trabajador la configura personalmente desde el enlace; el formulario exige de 12 a 128 caracteres y confirmación.

Los enlaces de retorno permitidos de producción incluyen exactamente:

```text
https://www.pide-ya.app/administrador/acceso?flow=invite
https://www.pide-ya.app/administrador/acceso?flow=recovery
```

Se mantuvieron los enlaces existentes de la app móvil. El destino del correo se establece en el servidor; no se acepta una URL enviada por el formulario.

### Activación cuando esté listo Resend

1. Verificar dominio/remitente en Resend, como en la [guía de correos de pedidos](CORREOS_DE_PEDIDOS_2026-10-30.md).
2. Conectar **Custom SMTP en Supabase → Authentication → Emails → SMTP Settings**. Esto es independiente de guardar `RESEND_API_KEY` en el worker de resúmenes de pedidos: configurar uno no configura el otro.
3. Revisar límites de Auth y las plantillas de invitación/recuperación. No enviar pruebas a trabajadores sin haber confirmado los destinatarios.
4. Para pruebas de correo en staging, usar un frontend apuntado al proyecto staging y configurar un retorno propio de ese entorno. La función permite una base local explícita (`http://localhost:5173` o `http://127.0.0.1:5173`) mediante `STAFF_AUTH_REDIRECT_BASE`; añadir también las rutas exactas correspondientes al allowlist de Auth de staging. No abrir un token de staging con el frontend de producción.
5. Habilitar el interruptor únicamente para la prueba controlada del entorno correcto:

   ```sql
   UPDATE public.app_settings SET value='true'::jsonb
   WHERE setting_key='staff_auth_email_ready';
   ```

6. Enviar una invitación a un buzón propio autorizado, abrir el enlace en otro navegador, elegir contraseña y comprobar el perfil concedido. Probar también recuperación, enlace vencido y suspensión. Confirmar recepción real; una respuesta de la API no demuestra entrega en bandeja.
7. Tras validar staging, repetir la conexión/activación en producción y la prueba con cuenta propia autorizada. Para pausar, volver el interruptor a `false`.

Los errores de SMTP no conceden acceso. Si el correo fue solicitado pero el alta no pudo confirmarse, la pantalla pide revisión antes de repetir. La persona puede existir en Auth sin tener acceso al equipo; se debe revisar y, si corresponde, dar acceso a la cuenta ya confirmada.

Documentación primaria: [invitación de Auth](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), [recuperación de contraseña](https://supabase.com/docs/guides/auth/passwords), [validación de identidad](https://supabase.com/docs/reference/javascript/auth-getuser).

## Implementación y validación

- Migración `061_staff_access.sql`, independiente de la migración opcional 060 de resúmenes de pedidos.
- Tablas privadas con RLS y sin acceso directo de roles de aplicación. RPCs de gestión reservadas a la cuenta principal. Finalización de invitaciones reservada a `service_role`.
- Los administradores completos conservan el acceso existente; al suspenderlos o quitarles el permiso completo se retira su fila antigua de `admin_profiles` en la misma transacción.
- La recuperación de cuentas del equipo se protege frente al reseteo antiguo de contraseñas de restaurantes en SQL. El código de la función opcional `admin-restaurants` también incorpora esa protección y está desplegado en staging. El inventario de producción no contiene esa función opcional; el panel usa el RPC SQL protegido. Los intentos de publicarla desde esta conexión agotaron el tiempo de espera y no se necesitó crearla para este módulo.
- 32 pruebas JavaScript, incluidas pruebas simuladas de la función de correo y del tiempo de espera de sesión; 23 escenarios SQL locales, con cobros concurrentes, intentos de escalamiento, suspensión y cambios de rol.
- Prueba del esquema real de staging: aceptación por Operación, reparto con custodia, liquidación, cobro por Finanzas, idempotencia, aislamiento de perfiles y suspensión. Resultado `hosted_staff_smoke_passed_and_rolled_back`; sin datos ni correos reales retenidos.
- La migración preservó una cuenta principal en producción, creó cinco perfiles base y dejó `staff_auth_email_ready=false`.

Las credenciales de servicio permanecen únicamente en el servidor. El frontend nunca recibe la clave de servicio, una contraseña ajena o un enlace de recuperación generado para copiarlo.

## Publicación

Vercel producción `dpl_8AzCcTvPPLXrGsRn8jKEcfi6Hffo`, estado `READY`, alias `https://www.pide-ya.app`. Las cuatro pestañas se distribuyen en dos columnas en móvil. La comprobación inicial de acceso tiene un límite de 15 segundos: si falla, muestra reintento y mantiene el acceso cerrado; no concede permisos a partir del estado local del navegador.

Las funciones `staff-auth` se desplegaron en staging y producción, conservando la validación de JWT de la plataforma y la verificación de identidad/autorización dentro del handler. No se configuró SMTP, no se activó el interruptor de correo y no se aplicó la migración 060 de resúmenes de pedidos.

Se abrió la publicación final con la sesión principal y se revisaron General, Usuarios, Roles y Actividad. El directorio mostró la cuenta protegida; los cinco perfiles y el formulario personalizado cargaron correctamente. Revisión de 390, 768 y 1440 px, sin desbordamiento horizontal. Evidencias en `release-artifacts/2026-10-30-staff-access/` de la raíz del workspace. Se dejó abierta la pestaña Usuarios para revisión.

Para repetir las comprobaciones locales desde `rancho_eats`:

```sh
node --test tests/*.test.cjs
node tests/staff/run.mjs
npm run build
```

La prueba SQL crea y elimina un clúster local desechable; requiere PostgreSQL 14 instalado en la ruta indicada por `PG_BIN` o en la ubicación por defecto de Homebrew. No acepta una URL de producción.
