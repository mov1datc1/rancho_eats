# Revisión de seguridad · 17 nov 2026

Alcance: Supabase (producción `apnxrbuqwgnfuelqjjfy` probada desde fuera, solo lectura; staging `rganzksyljjerfuowodi` probado a fondo), las 3 apps, el portal web, las Edge Functions y el historial Git de los 4 repositorios. No es una prueba de penetración externa ni una certificación.

## Resultado por tema

| Tema | Estado | Detalle |
|---|---|---|
| RLS | ✅ Bien, con 2 correcciones | Todas las tablas públicas tienen RLS. Un anónimo en producción solo lee catálogo, menú, categorías, tarifas de envío y `app_settings` (configuración de GPS y rutas, sin secretos). OpenAPI cerrado a anónimos. Corregido: `ratings` era legible por cualquiera (067). |
| Vulnerabilidad lógica | 🔴→✅ Corregida en staging (067) | `delete_user_account` cancelaba pedidos PENDING buscando por el teléfono de `user_metadata`, que el usuario puede editar: se podían cancelar pedidos ajenos. Ahora usa `client_user_id`. Probado en staging. |
| Datos de cuenta expuestos | 🟠→✅ Corregida en staging (068) | Cualquiera leía `email`, `phone` y `owner_id` de los negocios; el email es el de inicio de sesión del dueño. 068 lo mueve a `restaurant_private` (solo dueño y superadmin) y deja vacía la columna pública; el contacto público es el teléfono/WhatsApp. Las apps actuales siguen funcionando sin rebuild. Probado 10/10 en staging. |
| Validación de entradas | ✅ Corregida en staging (066) | El nombre del producto en el pedido venía del teléfono del cliente. Ahora se reescribe desde el menú; notas ≤200, nombre ≤80, dirección ≤500, sin caracteres de control; límites de texto en catálogo. |
| Inyección HTML | ✅ Corregida (app negocio) | El ticket HTML (`generateHTMLReceipt`) insertaba nombre, notas y dirección del cliente sin escapar. El correo y la web ya escapaban. |
| Límite de intentos de login | 🟡 Parcial | Supabase bloquea por IP: 429 después de unos 35 intentos de contraseña y desde el 3.er código OTP por correo. No hay bloqueo por cuenta ni CAPTCHA. |
| SMS del repartidor | 🟠 Configurar | `signInWithOtp({ phone })` crea usuarios y envía SMS a cualquier número (riesgo de fraude por envío masivo de SMS). Limitar países a México en el proveedor de SMS y bajar el límite de SMS por hora en Auth; activar CAPTCHA. |
| CORS | ✅ / 🟡 | La API REST de Supabase no limita CORS por diseño; la protección real es RLS. `staff-auth` usa una lista de dominios permitidos. `admin-restaurants` usaba `*`: corregido en código (no está desplegada). |
| Edge Functions antiguas | 🟡 Borrar | `check-spam` y `notify-restaurant` (marzo) siguen desplegadas y ninguna app las usa; `check-spam` corre con la clave `service_role`. |
| Secretos en Git | ✅ Sin fugas críticas | Sin `service_role`, llaves privadas ni tokens en ningún commit. Hay llaves Google (`AIza…`) de Firebase y Maps y un `.env` versionado en `pideya-restaurant` con valores públicos `EXPO_PUBLIC_*`. Restringir esas llaves en Google Cloud por paquete/SHA-1 e identificador iOS, y limitar APIs. |
| Cifrado | ✅ / 🟡 | No se guardan tarjetas, CLABE, RFC ni documentos. Supabase cifra en reposo (AES-256) y en tránsito (TLS). El código de acceso del repartidor se guarda en texto plano en `driver_profiles` (protegido por RLS): guardarlo con hash cuando se rediseñe el alta. |
| Respaldos | ✅ Diarios / 🟡 Mejorar | Respaldos físicos diarios automáticos con 7 días de retención (verificado). Recomendado: PITR al lanzar (unos $100 USD al mes por 7 días) y un respaldo lógico semanal fuera de Supabase. |

## Migraciones

| Migración | Staging | Producción |
|---|---|---|
| 062 catálogo escalable + insert de negocios | ✅ | ✅ |
| 063 ritmo de campañas push | ✅ | ✅ |
| 064 ofertas, destacados y cobros | ✅ | ✅ |
| 065 promos por platillo | ✅ | ✅ 17/11 (verificado con clave pública) |
| 066 endurecimiento de entradas | ✅ | ✅ 17/11 |
| 067 correcciones de seguridad | ✅ | ✅ 17/11 (`ratings` cerrado a anónimos; `delete_user_account` responde 401 a anónimos) |
| 068 correo del negocio privado | ✅ 18/11 | Pendiente de autorización |

Builds lanzados el 17/11: cliente 1.5.0 (versionCode 42, AAB `production`) y negocio 1.6.0 (versionCode 16, APK `release`). El repartidor no cambia en Android.

Pruebas en staging (todas con limpieza): ofertas 21/21, promos 10/10, entradas 5/5, seguridad 5/5, ritmo de campañas 2 escenarios. Scripts en `release-artifacts/2026-11-17-scale-audit/pruebas-staging/`.

## Panel de Supabase (lo hace el propietario)

1. Auth → Attack Protection: activar CAPTCHA (Cloudflare Turnstile) y «Leaked password protection». Requiere enviar `captchaToken` desde las apps: se programa para la siguiente versión.
2. Auth → Rate Limits: bajar envíos de SMS por hora; proveedor de SMS: permitir solo México (+52).
3. Auth → contraseñas: longitud mínima de 10 o más con letras y números.
4. Database → Backups: activar PITR antes del lanzamiento.
5. Edge Functions: borrar `check-spam` y `notify-restaurant`.
6. Google Cloud: restringir llaves de Maps/Firebase.
