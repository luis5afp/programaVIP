# userFLOW LAB 0.1.0

Prototipo independiente. Electron/Chromium integrado, no Chrome ni Edge externos. Usa únicamente una aplicación ficticia en loopback y consulta GET /api/health del servidor de producción sin autenticación. No accede a perfiles, credenciales, datos de clientes, snapshots ni sesiones externas. No reemplaza userFLOW estable, no registra su protocolo y no modifica su actualizador.

## Ejecución

En Windows con Node.js 22: npm install, npm test, npm run smoke, npm start. npm run dist:win crea un ejecutable portable independiente; no se publica automáticamente. La CI conserva el artefacto de prueba. El directorio local es userFLOW-LAB; las pruebas usan un directorio temporal.

## Alcance

Prueba de inicio y cierre de sesión ficticia, recarga e independencia de dos particiones de navegador. El origen local cambia al reiniciar; no demuestra persistencia entre reinicios ni compatibilidad con sitios reales. La siguiente fase requiere un entorno de pruebas y un contrato de API autorizado para catálogo y permisos; no incluye transferencia de autenticación de terceros.
