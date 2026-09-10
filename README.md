# userFLEX Admin

Panel web y API central de userFLEX.

## Arquitectura

- **Cloudflare Worker + Static Assets**: sirve el panel y concentra toda la API.
- **Supabase CREATORTOOLS LAB** (`lbvxnbbglkjnwphaomyx`): fuente de verdad persistente.
- **userFLEX Client para Windows**: consume exclusivamente `/api/client/*` desde el proceso principal de Electron.

No se usa Express, Cloudflare D1, KV ni almacenamiento en memoria para datos de producción.

## Seguridad

- El login Admin reutiliza temporalmente la autenticación real de CreatorTools LAB y crea una cookie `HttpOnly + Secure + SameSite=Lax` para este panel.
- No hay usuarios, contraseñas maestras ni tokens hardcodeados en React.
- Las contraseñas del Client se almacenan como PBKDF2-HMAC-SHA256 con salt aleatorio y 310.000 iteraciones.
- Los tokens del Client se generan aleatoriamente y en Supabase solo se guarda SHA-256 del token.
- Las contraseñas de proxy se cifran en el Worker con AES-256-GCM antes de persistirse. El panel Admin solo recibe `has_password`.
- Todas las tablas `userflex_*` tienen RLS activado y acceso directo revocado para `anon` y `authenticated`.
- Las acciones relevantes quedan en `userflex_audit_logs`; no se registran contraseñas, cookies, tokens ni claves de proxy.
- El login Admin tiene rate-limit persistente en Supabase.

## Preparación de CREATORTOOLS LAB

Aplicar primero:

`supabase/migrations/20260910_userflex_foundation.sql`

La migración crea Clientes, Planes, Suscripciones, Perfiles, Proxies, Asignaciones, Dispositivos, sesiones del Client y auditoría. No inserta datos de demostración.

## Secrets de Cloudflare

Configurar en el Worker:

- `SUPABASE_URL=https://lbvxnbbglkjnwphaomyx.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=<service role de CREATORTOOLS LAB>`
- `USERFLEX_PROXY_MASTER_KEY=<32 bytes aleatorios en base64url>`

Ejemplo para generar la clave de proxy localmente:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Nunca guardar esas claves en GitHub.

## API del Client

- `POST /api/client/auth`
- `GET /api/client/catalog`
- `POST /api/client/profiles/:profileId/launch`
- `POST /api/client/heartbeat`
- `POST /api/client/logout`

La respuesta de catálogo es sanitizada. La ruta de launch puede entregar la configuración de proxy únicamente a un Client autenticado y asignado. Las credenciales de proxy no se exponen al navegador Admin.

### Sesiones de páginas

Esta base **no genera cookies falsas ni clona sesiones de terceros**. `managed-first-party` queda reservado para una fase de entrega de sesión autorizada para dominios propios/controlados. Hasta que esa fase tenga allowlist y cifrado específicos, `sessionDelivery.materialIncluded` permanece en `false`.

## Desarrollo

```bash
npm install
npm run typecheck
npm run build
npm run cf:check
```
