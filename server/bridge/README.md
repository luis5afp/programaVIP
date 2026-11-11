# UserFlex / programaVIP — puente de pruebas v1.1

Implementación separada para validar la comunicación entre el administrador y el cliente PC. No sustituye el servidor comercial, no está desplegada y no debe recibir cookies de producción. Las Releases originales permanecen intactas.

## Funcionalidad

Autenticación con scrypt y contraseñas sin valores por defecto; tokens de 15 minutos almacenados como hash. Inscripción Ed25519, aprobación administrativa y firma de cada solicitud con timestamp y nonce persistente contra repetición. El HWID por sí solo no autoriza. Catálogo basado exclusivamente en asignaciones explícitas, suscripción y módulo activos. Vault SQLite cifrado AES-256-GCM, clave de 32 bytes externa, AAD ligado a cliente, módulo, perfil, versión y expiración. No se generan cookies automáticamente. Entrega de un único bundle aprobado, validación de dominios y vencimiento, revocación y auditoría sin valores secretos.

## Pruebas locales

Requiere Node.js 22.16 o superior. Desde la raíz del repositorio ejecute `node --test server/bridge/*.test.mjs`. El conjunto de integración adicional se encuentra en `server/bridge/durable-gateway.test.mjs`. Para iniciar el servicio, configure `BRIDGE_DB_PATH` con una ruta privada y persistente y `BRIDGE_VAULT_KEY` con una clave aleatoria de 32 bytes codificada en base64, generada y guardada fuera del repositorio. Ejecute `node server/bridge/run.mjs bootstrap-admin <usuario>` una sola vez y luego `node server/bridge/run.mjs serve`. El servicio escucha en 127.0.0.1:8788. La contraseña inicial requiere 12 caracteres o más; la entrada provisional es visible, por lo que debe utilizarse una terminal privada.

La API administrativa provisional `/api/bridge/v1/admin/` permite crear clientes, módulos y perfiles, asignar permisos, configurar credenciales, aprobar dispositivos y guardar o revocar bundles. El cliente nativo usa `/enroll`, `/login`, `/catalog`, `/session`, `/heartbeat` y `/logout`. No están montadas las rutas legadas `/api/data`, códigos maestros ni autocaptura.

## Bloqueos de producción

No fusionar ni desplegar como solución estable. Falta integrar el login real del administrador con MFA y permisos, migrar solo metadatos de forma auditada, sustituir SQLite local por almacenamiento transaccional compartido para múltiples instancias, gestionar copias de seguridad y rotación de claves, implementar rate limiting distribuido y revisar dominios con una biblioteca de sufijos públicos. No utilizar el filesystem efímero de Cloud Run para la base de datos. La API administrativa provisional no debe exponerse públicamente.

Antes de habilitar sesiones reales deben cerrarse las rutas antiguas que exponen el estado completo, eliminarse contraseñas maestras y por defecto y la generación de cookies simuladas, y verificarse propiedad, consentimiento y permisos de cada sesión. Las puntuaciones heurísticas y marcas de 2FA no prueban un login real. La entrega no garantiza que un proveedor acepte la sesión ni que una revocación local invalide una sesión ya establecida en el proveedor. Usar mecanismos oficiales de autenticación cuando existan y respetar las condiciones de cada servicio.

En UserFlex falta conectar el cliente al proceso principal y al registro definitivo de pestañas, completar la suspensión y limpieza de sesiones al revocar y validar Electron y Windows. Este trabajo es una base de integración, no un EXE terminado. No incluye credenciales, perfiles ni cookies reales.
