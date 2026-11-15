import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { friendlyApiError } from '../src/error-messages.ts';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const client = source('src/api.ts');
const clientView = source('src/views/ClientsView.tsx');
const ui = source('src/components/ui.tsx');
const errorBoundary = source('src/components/ErrorBoundary.tsx');
const app = source('src/App.tsx');

const internal = friendlyApiError({
  path: '/api/clients',
  method: 'POST',
  status: 500,
  code: 'INTERNAL_ERROR',
  serverMessage: 'Error interno del servidor.',
  requestId: '67faf2e9-fa07-429c-bc02-3b0b947d0d80',
});
assert.match(internal, /No se pudo crear el cliente/);
assert.match(internal, /Motivo: El servidor encontró un fallo inesperado/);
assert.match(internal, /motivo exacto necesita revisarse en los registros/);
assert.match(internal, /Qué hacer: Comprueba primero si los cambios se guardaron/);
assert.match(internal, /Referencia para soporte: 67faf2e9/);
assert.doesNotMatch(internal, /INTERNAL_ERROR|HTTP 500|Error interno del servidor/);

const secret = friendlyApiError({
  path: '/api/clients',
  method: 'POST',
  status: 500,
  code: 'INTERNAL_ERROR',
  serverMessage: 'TypeError at server.js password=secret postgres://admin:p@host',
});
assert.doesNotMatch(secret, /secret|postgres|password=|TypeError/);

const unique = friendlyApiError({
  path: '/api/clients',
  method: 'POST',
  status: 409,
  code: 'CONFLICT',
  serverMessage: 'Ya existe un registro con esos datos.',
});
assert.match(unique, /Ya existe un registro/);
assert.match(unique, /comprueba|Comprueba/);
assert.doesNotMatch(unique, /CONFLICT/);

const field = friendlyApiError({
  path: '/api/profiles/1234',
  method: 'PATCH',
  status: 400,
  code: 'INVALID_FIELD',
  serverMessage: 'url no es válido.',
});
assert.match(field, /guardar los cambios del perfil/);
assert.match(field, /url no es válido/);
assert.match(field, /Qué hacer/);

const network = friendlyApiError({
  path: '/api/extensions/abc/package',
  method: 'POST',
  status: 0,
  code: 'NETWORK_ERROR',
  requestId: 'example-request-ref',
});
assert.match(network, /subir el archivo/);
assert.match(network, /navegador no pudo comunicarse/);
assert.match(network, /Referencia para soporte/);

const unavailable = friendlyApiError({
  path: '/api/clients',
  method: 'GET',
  status: 503,
  code: 'DATABASE_UNAVAILABLE',
});
assert.match(unavailable, /cargar los datos de cliente/);
assert.match(unavailable, /base de datos no respondió/);
assert.doesNotMatch(unavailable, /DATABASE_UNAVAILABLE/);

const partial = friendlyApiError({
  path: '/api/clients',
  method: 'POST',
  status: 409,
  code: 'CLIENT_CREATED_CONFIGURATION_INCOMPLETE',
});
assert.match(partial, /puede haberse creado/);
assert.match(partial, /Busca al cliente/);

const unknown = friendlyApiError({
  path: '/api/plans',
  method: 'POST',
  status: 418,
  code: 'TERRIBLY_CONFUSING_INTERNAL_SERVER_CODE',
  serverMessage: 'SELECT * FROM secrets',
});
assert.match(unknown, /Motivo:/);
assert.match(unknown, /Qué hacer:/);
assert.doesNotMatch(unknown, /TERRIBLY_CONFUSING|SELECT/);

assert.match(client, /friendlyApiError\(\{/);
assert.match(clientView, /setError\(createError\?\.message/);
assert.doesNotMatch(clientView, /Código: \$\{code\}/);
assert.match(ui, /whiteSpace: 'pre-line'/);
assert.match(errorBoundary, /Motivo:/);
assert.match(errorBoundary, /Qué hacer:/);
assert.match(errorBoundary, /Referencia para soporte:/);
assert.match(app, /setSessionError\(error\?\.message/);
assert.match(app, /No se pudo verificar la sesión de administrador/);
console.log('Actionable Spanish Admin errors: OK');
