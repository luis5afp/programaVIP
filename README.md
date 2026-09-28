# userFLEX Admin

Panel web y API central de userFLEX.

## Arquitectura

- **Cloudflare Worker + Static Assets**: sirve el panel y concentra toda la API.
- **Neon Postgres**: fuente de verdad persistente para clientes, planes, perfiles, sesiones, dispositivos, auditoría y configuración.
- **Cloudflare R2**: almacena instaladores/actualizaciones de userFLOW, imágenes de perfiles y paquetes ZIP de extensiones administradas.
- **userFLOW Client para Windows**: consume exclusivamente la API de userFLEX desde el proceso principal de Electron.

La aplicación de producción no depende de proveedores de base de datos anteriores. Toda lectura y escritura persistente pasa por `NEON_DATABASE_URL` y el adaptador `cloudflare/lib/neon-rest.ts`.

## Seguridad

- El login Admin reutiliza la autenticación autorizada de CreatorTools y crea una cookie `HttpOnly + Secure + SameSite=Lax`.
- No hay usuarios, contraseñas maestras ni tokens hardcodeados en React.
- Las contraseñas del Client se almacenan como PBKDF2-HMAC-SHA256 con salt aleatorio y 310.000 iteraciones.
- Los tokens del Client se generan aleatoriamente y en Neon solo se guarda SHA-256 del token.
- Las contraseñas de proxy se cifran en el Worker con AES-256-GCM antes de persistirse. El panel Admin solo recibe `has_password`.
- Las acciones relevantes quedan en `userflex_audit_logs`; no se registran contraseñas, cookies, tokens ni claves de proxy.
- El login Admin tiene protección persistente contra intentos repetidos.

## Base de datos

Las migraciones SQL están en:

`database/migrations/`

La conexión de producción se configura únicamente con:

- `NEON_DATABASE_URL=<cadena de conexión PostgreSQL de Neon>`

Ese valor debe existir como **secret del Worker en Cloudflare**. El workflow de GitHub no lo vuelve a guardar ni mantiene una copia adicional.

## Secrets de Cloudflare

Configurar en el Worker:

- `NEON_DATABASE_URL=<cadena de conexión PostgreSQL de Neon>`
- `USERFLEX_PROXY_MASTER_KEY=<32 bytes aleatorios en base64url>`

Ejemplo para generar la clave de proxy localmente:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Nunca guardar estas claves en el repositorio.

## API del Client

- `POST /api/client/auth`
- `GET /api/client/catalog`
- `POST /api/client/profiles/:profileId/launch`
- `POST /api/client/heartbeat`
- `POST /api/client/logout`

La respuesta de catálogo es sanitizada. La ruta de launch puede entregar la configuración de proxy únicamente a un Client autenticado y asignado. Las credenciales de proxy no se exponen al navegador Admin.

## Desarrollo

```bash
npm install
npm run typecheck
npm run build
npm run cf:check
```
