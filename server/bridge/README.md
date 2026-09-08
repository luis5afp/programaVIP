# Puente UserFlex v1 — base aislada, no desplegada

Este módulo es el contrato inicial entre programaVIP (administrador) y UserFlex PC. No está montado en server.ts, no se conecta a Cloudflare/Cloud Run y no entrega cookies reales. Ejecutar las pruebas no requiere cuentas ni credenciales.

## Contrato HTTP

Montaje previsto: `/api/bridge/v1`. `POST /login` recibe identifier, password y deviceId; devuelve un bearer aleatorio de 15 minutos. `GET /catalog` devuelve únicamente módulos y perfiles explícitamente asignados, sin contraseñas ni cookies. `POST /session` recibe moduleId y profileId y entrega una sola sesión aprobada. `POST /heartbeat` comprueba vigencia y `POST /logout` revoca el bearer. Todas las rutas privadas requieren Authorization: Bearer y X-Device-ID. Las respuestas son no-cache y el API nativo no acepta Origin de navegadores.

El dispositivo identificado por un HWID no está criptográficamente autenticado: el identificador no es secreto. Antes de producción se necesita enrolamiento seguro, prueba de posesión de clave del dispositivo, límites de intentos y revocación. El bearer se guarda únicamente en el proceso principal del cliente, con almacenamiento del sistema operativo si se añade persistencia.

## Adaptadores obligatorios

`createDesktopBridge({authenticate,sessions,readData,readBundle,audit})` necesita implementaciones reales. authenticate debe verificar contraseñas con hashes resistentes y controlar intentos; nunca debe usar los PIN maestros, contraseñas de reserva ni autenticación opcional del servidor antiguo. sessions requiere almacenamiento persistente y compartido entre instancias, con put/get/revoke por hash SHA-256 y expiración. readData debe consultar el estado autorizado actual, no una semilla ni caché que ignore revocaciones. readBundle debe recuperar un registro cifrado en reposo desde un vault protegido y devolverlo solo cuando exista aprobación explícita del administrador. El proveedor debe validar propietario, módulo, perfil, origen, vigencia y versión.

Un bundle autorizado contiene clientId, moduleId, profileId, url, version, approved:true, source:'admin-verified', expiresAt y cookies. No se aceptan cookies inventadas ni indicadores de verificación simulados. Los dominios padre deben estar autorizados explícitamente en profile.allowedCookieDomains; el valor predeterminado solo permite el host exacto. Nunca se deben incluir credenciales en URLs, logs o respuestas de catálogo.

## Bloqueos del servidor actual

Antes de activar el puente hay que proteger `/api/data`, `/api/reset`, las rutas de administración, exportación, cookies y códigos; eliminar accesos maestros y contraseñas por defecto; migrar contraseñas en claro a hashes; retirar la autocaptura ficticia; y reemplazar el secreto AES fijo por una clave administrada fuera del código. Los endpoints antiguos no deben seguir ofreciendo otra ruta para obtener sesiones o cambiar permisos. No usar el almacenamiento global en memoria para datos de producción. Cloudflare necesita persistencia transaccional y un vault con cifrado y gestión de claves. No se debe publicar el archivo de seed como una sesión real.

## Integración pendiente

Montar el handler con un parser JSON de máximo 64 KiB y el prefijo anterior, antes del middleware CORS legado, solo después de configurar los adaptadores seguros. La aplicación Electron debe obtener el catálogo desde su proceso principal, crear un identificador local estable por pestaña, usar una partición persistente independiente por usuario y perfil local, instalar las cookies antes de navegar y mantener el mismo perfil al cambiar de pestaña. Debe suspender las vistas gestionadas si se revoca el acceso y comprobar el lease periódicamente. Cerrar una pestaña no borra automáticamente su almacenamiento. Nunca se copia una partición entre clientes.

Un bearer de 15 minutos no garantiza revocación instantánea de cookies que ya estén en Chromium. Se requiere política explícita de caducidad, renovación, eliminación de cookies gestionadas y prueba real de revocación; las restricciones y condiciones de cada sitio siguen aplicando. No afirmar que un contador de cookies prueba un inicio de sesión real.

## Pruebas

Node.js 22: `node --test server/bridge/*.test.mjs`. Son pruebas aisladas con datos ficticios, no validan la API pública, la base de datos real, un despliegue ni un EXE de Windows. El sistema original y los despliegues existentes permanecen sin cambios.
