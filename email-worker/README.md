# Correo de pedidos entregados

Preparado y probado localmente; **no está desplegado ni activado**. No requiere modificar ni compilar el cliente. No tiene dependencias externas de npm; usa Node 20 o posterior y `fetch`.

Guía de conexión, pruebas y activación: [CORREOS_DE_PEDIDOS_2026-10-30.md](../docs/plataforma/CORREOS_DE_PEDIDOS_2026-10-30.md).

```sh
npm test
npm run preview
node tests/run-sql.mjs
```

La última orden crea y elimina su propio PostgreSQL local temporal; nunca utiliza credenciales ni URL de producción. En Mac espera PostgreSQL 14 en `/opt/homebrew/opt/postgresql@14/bin`. En otro entorno se puede indicar `PG_BIN`. `tests/schema.sql` es una fixture desechable: **no es una migración**.

`preview.html` y `preview.txt` usan datos ficticios y no envían correos. Para ejecutar el servicio con secretos inyectados por el alojamiento:

```sh
npm start
```

Para un archivo local privado de variables, usar `node --env-file=.env worker.mjs`. No subir `.env` ni claves al repositorio. El servicio se niega a arrancar salvo que `ORDER_EMAIL_ENABLED=true` y las variables de correo estén completas; además, la base debe habilitar la captura y el envío. Mantener **una sola réplica** para respetar el ritmo del proveedor.

Los logs solo muestran conteos y códigos. `accepted` significa que el proveedor aceptó el mensaje; no confirma que llegó a la bandeja. Los eventos de entrega/rebote se revisan en Resend durante el piloto. La ingestión de webhooks de esos eventos no forma parte de esta primera integración.
