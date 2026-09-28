# Neon database migrations

Este directorio contiene el historial SQL de userFLEX para PostgreSQL/Neon.

La aplicación de producción usa exclusivamente `NEON_DATABASE_URL` y el adaptador `cloudflare/lib/neon-rest.ts`.
Las migraciones se conservan para reconstrucción, auditoría y evolución del esquema.
