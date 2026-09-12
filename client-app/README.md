# userFLEX Client

Aplicación de escritorio para los clientes finales de userFLEX.

## Flujo

1. El cliente inicia sesión con el usuario/correo y contraseña creados en Admin.
2. El equipo se registra con una clave estable y respeta el límite de dispositivos del plan.
3. El Client obtiene únicamente los perfiles asignados a ese cliente.
4. Al pulsar **Abrir**, solicita un lease de lanzamiento al Worker.
5. Si el perfil usa proxy, Electron lo configura antes de navegar. En perfiles con red bloqueada no existe fallback directo.
6. Si el perfil usa sesión administrada, el Client restaura las cookies y almacenamiento web capturados por Session Manager sin recibir las credenciales administrativas de la cuenta.
7. Cada perfil se abre en una partición Chromium persistente y aislada.

## Seguridad

- El token de acceso se guarda con `safeStorage` cuando Windows ofrece cifrado del sistema.
- Las credenciales de la web administrada no se entregan al Client.
- DevTools y Node integration están deshabilitados en las ventanas de contenido.
- Los perfiles con proxy bloqueado validan la IP pública antes de abrir la web cuando existe una IP esperada registrada.
- Se fuerza WebRTC a evitar UDP no proxificado.

## Desarrollo

```bash
npm install
npm start
```

## Instalador Windows

```bash
npm run dist:win
```

El instalador se genera en `dist/` mediante electron-builder/NSIS.

> La versión v1 del material de sesión restaura cookies, Local Storage y Session Storage. IndexedDB todavía no forma parte del snapshot distribuido.
