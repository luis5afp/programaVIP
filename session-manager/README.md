# userFLEX Session Manager

Aplicación local de Windows que abre el Chromium aislado usado para preparar y renovar sesiones administradas desde el panel userFLEX.

## Instalación

1. Descarga el instalador `userFLEX-Session-Manager-*-Setup.exe` desde la release más reciente del repositorio.
2. Instálalo en Windows. El instalador registra el protocolo `userflex-session://`.
3. No necesitas dejar la aplicación abierta.
4. Desde **Perfiles** en el panel userFLEX pulsa **Cargar sesión** o **Renovar sesión**.
5. El navegador puede pedir confirmación para abrir **userFLEX Session Manager**. Acepta esa apertura.
6. Se abrirá un Chromium aislado para ese perfil. Completa el acceso/2FA/CAPTCHA y pulsa **Guardar sesión** en el panel flotante de userFLEX.

## Red

- Si el perfil no tiene proxy, Chromium usa conexión directa.
- Si el perfil tiene proxy, la captura usa ese mismo proxy que usarán los clientes del perfil.
- Para perfiles con proxy, el Client bloquea el fallback directo cuando el proxy no está disponible.

## Desarrollo

```bash
npm install
npm start
```

Para crear el instalador x64 de Windows:

```bash
npm run dist:win
```
