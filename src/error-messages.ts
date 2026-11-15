// All Admin screens receive actionable Spanish error messages through this
// single formatter. Error codes are retained on ApiError for diagnostics, but
// never displayed as the primary explanation. Unknown server failures cannot
// be diagnosed from an HTTP response; their exact cause stays in Worker logs.

export type ApiFailureDetails = {
  path: string;
  method: string;
  status: number;
  code?: string;
  serverMessage?: unknown;
  requestId?: string;
};

const reasons: Record<string, { cause: string; action: string }> = {
  UNAUTHENTICATED: {
    cause: 'La sesión de administrador terminó o ya no es válida.',
    action: 'Inicia sesión otra vez y repite la operación.',
  },
  INVALID_CREDENTIALS: {
    cause: 'El usuario o la contraseña no coinciden con una cuenta autorizada.',
    action: 'Comprueba los datos de acceso. Si no recuerdas la contraseña, solicita un restablecimiento.',
  },
  INVALID_CLIENT_CREDENTIALS: {
    cause: 'Los datos de acceso del cliente no son correctos.',
    action: 'Comprueba el usuario y la contraseña del cliente.',
  },
  ADMIN_ACCESS_REVOKED: {
    cause: 'Tu cuenta ya no dispone de permisos de administrador.',
    action: 'Solicita al propietario que revise tus permisos.',
  },
  ORIGIN_REJECTED: {
    cause: 'El navegador no pudo confirmar que la solicitud provenga del panel autorizado.',
    action: 'Recarga la página desde la dirección oficial de userFLEX e inténtalo otra vez.',
  },
  INVALID_FIELD: {
    cause: 'Uno de los campos contiene un valor no admitido.',
    action: 'Revisa los datos y las fechas del formulario antes de guardarlo.',
  },
  INVALID_JSON: {
    cause: 'El servidor recibió información con un formato incorrecto.',
    action: 'Recarga el formulario y vuelve a introducir los datos.',
  },
  INVALID_ID: {
    cause: 'El elemento seleccionado no tiene un identificador válido.',
    action: 'Recarga la lista y selecciona de nuevo el elemento.',
  },
  INVALID_URL: {
    cause: 'La dirección web introducida no es válida.',
    action: 'Comprueba que la dirección esté completa y bien escrita.',
  },
  HTTPS_REQUIRED: {
    cause: 'Esta dirección web debe utilizar una conexión segura HTTPS.',
    action: 'Introduce una dirección que comience por https://.',
  },
  WEAK_PASSWORD: {
    cause: 'La contraseña no cumple los requisitos de seguridad.',
    action: 'Utiliza una contraseña más larga que cumpla los requisitos indicados.',
  },
  PAYLOAD_TOO_LARGE: {
    cause: 'Los datos o el archivo superan el tamaño permitido.',
    action: 'Selecciona un archivo más pequeño o reduce su contenido.',
  },
  CONFLICT: {
    cause: 'Ya existe un registro con esos datos.',
    action: 'Comprueba si el correo, usuario o nombre ya se encuentra registrado antes de volver a guardarlo.',
  },
  IN_USE: {
    cause: 'El elemento todavía está asociado con otros registros.',
    action: 'Revisa y quita las asignaciones relacionadas antes de eliminarlo.',
  },
  CLIENT_CREATED_CONFIGURATION_INCOMPLETE: {
    cause: 'La cuenta puede haberse creado, pero no se pudieron guardar todas sus opciones.',
    action: 'Busca al cliente en la lista antes de intentar crearlo otra vez. Contacta soporte si los permisos faltan.',
  },
  CLIENT_CREATE_CONFIGURATION_FAILED: {
    cause: 'No se pudieron guardar las opciones de acceso del cliente.',
    action: 'Revisa si el cliente aparece en la lista antes de repetir la operación.',
  },
  CLIENT_CREATE_RESULT_INVALID: {
    cause: 'El servidor no pudo confirmar el resultado del alta.',
    action: 'Revisa si el cliente ya aparece en la lista antes de intentar crearlo nuevamente.',
  },
  CLIENT_CREATE_ROW_MISSING: {
    cause: 'La cuenta creada no pudo localizarse para completar su configuración.',
    action: 'Comprueba si la cuenta existe y vuelve a intentarlo solo si no aparece.',
  },
  PROFILE_LIMIT_REACHED: {
    cause: 'El plan alcanzó el máximo de perfiles autorizados.',
    action: 'Desasigna algún perfil o cambia a un plan con mayor capacidad.',
  },
  DEVICE_LIMIT_REACHED: {
    cause: 'El cliente alcanzó el máximo de dispositivos permitidos.',
    action: 'Revoca un dispositivo antiguo o amplía su límite.',
  },
  PLAN_INACTIVE: {
    cause: 'El plan seleccionado está desactivado.',
    action: 'Selecciona un plan activo o activa ese plan en Administración.',
  },
  SUBSCRIPTION_INACTIVE: {
    cause: 'La suscripción del cliente no está activa o ya venció.',
    action: 'Revisa las fechas y el estado de su suscripción.',
  },
  DATABASE_UNAVAILABLE: {
    cause: 'La base de datos no respondió a tiempo.',
    action: 'Comprueba la conexión del servidor. Si estabas guardando información, verifica primero si se registró antes de reintentar.',
  },
  DATABASE_ERROR: {
    cause: 'La base de datos rechazó la operación, pero no indicó al panel un motivo específico.',
    action: 'Revisa si el cambio ya se guardó y solicita una revisión de los registros del servidor si vuelve a ocurrir.',
  },
  NEON_CONFIG_MISSING: {
    cause: 'El servidor no tiene configurada su conexión a la base de datos.',
    action: 'El administrador técnico debe revisar la conexión de Neon en Cloudflare.',
  },
  CLIENT_BROWSER_ACCESS_SCHEMA_ERROR: {
    cause: 'El servidor no pudo preparar la configuración de permisos del navegador.',
    action: 'El administrador técnico debe revisar el esquema de clientes en Neon.',
  },
  EXTENSION_SCHEMA_ERROR: {
    cause: 'El servidor no pudo preparar el almacenamiento de extensiones.',
    action: 'El administrador técnico debe revisar la base de datos de extensiones.',
  },
  AUTH_BACKEND_UNAVAILABLE: {
    cause: 'El servicio que verifica las cuentas no está disponible.',
    action: 'Vuelve a intentar el acceso cuando se restablezca el servicio.',
  },
  REQUEST_TIMEOUT: {
    cause: 'El servidor tardó demasiado en responder.',
    action: 'Comprueba tu conexión. Si estabas guardando datos, verifica el resultado antes de intentarlo otra vez.',
  },
  NETWORK_ERROR: {
    cause: 'El navegador no pudo comunicarse con el servidor.',
    action: 'Comprueba la conexión a Internet y vuelve a cargar el panel.',
  },
  REQUEST_CANCELLED: {
    cause: 'La solicitud se interrumpió antes de terminar.',
    action: 'Inténtalo de nuevo cuando quieras continuar.',
  },
  CLIENT_UPDATE_REQUIRED: {
    cause: 'La versión instalada de userFLOW ya no es compatible con el servidor.',
    action: 'Actualiza userFLOW y vuelve a iniciar sesión.',
  },
};

function actionLabel(method: string, path: string): string {
  const target = path.split('?')[0].toLowerCase();
  const verb = method.toUpperCase();
  const isList = verb === 'GET' || verb === 'HEAD';
  const isDelete = verb === 'DELETE';
  const isEdit = verb === 'PATCH' || verb === 'PUT';
  const subject =
    target.startsWith('/api/clients') ? 'cliente'
    : target.startsWith('/api/plans') ? 'plan'
    : target.includes('extension') ? 'extensión'
    : target.includes('session') ? 'sesión'
    : target.includes('profile') ? 'perfil'
    : target.includes('proxy') ? 'proxy'
    : target.includes('assignment') ? 'asignación'
    : target.includes('device') ? 'dispositivo'
    : target.includes('content-rule') ? 'regla de página'
    : target.includes('admin') ? 'administrador'
    : target.includes('auth') ? 'inicio de sesión'
    : 'operación';
  if (target === '/api/clients' && verb === 'POST') return 'crear el cliente';
  if (target.endsWith('/credentials')) return 'guardar las credenciales';
  if (target.includes('upload') || target.includes('package') || target.includes('image')) {
    return isList ? 'descargar el archivo' : 'subir el archivo';
  }
  if (isList) return subject === 'operación' ? 'cargar la información' : `cargar los datos de ${subject}`;
  if (isDelete) return `eliminar ${subject === 'operación' ? 'el elemento' : 'el ' + subject}`;
  if (isEdit) return `guardar los cambios del ${subject}`;
  return `guardar ${subject === 'operación' ? 'la información' : 'el ' + subject}`;
}

function safeUserExplanation(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const message = raw.trim();
  if (message.length < 12 || message.length > 260) return null;
  if (/^(?:[A-Z][A-Z0-9_]+|HTTP\s+\d+|Error interno del servidor\.?|Internal Server Error)$/i.test(message)) return null;
  if (/\b(?:TypeError|ReferenceError|SyntaxError|Exception|stack trace|traceback|postgresql|SELECT |INSERT |UPDATE |DELETE FROM |DATABASE_ERROR)\b/i.test(message)) return null;
  if (/[<>\{\}]/.test(message) || /(?:Bearer\s|postgres(?:ql)?:\/\/|at [\w.]+\s*\()/i.test(message)) return null;
  // The server's own HttpError messages are deliberately user-safe. Refuse to
  // surface unfamiliar English infrastructure exceptions from other sources.
  if (!/[áéíóúñ¿¡]/i.test(message) && !/\b(?:no se|no pudo|debe|es válido|existe|límite|contraseña|perfil|cliente|sesión|plan|datos|servidor|archivo|acceso)\b/i.test(message)) return null;
  return message;
}

export function friendlyApiError(details: ApiFailureDetails): string {
  const operation = actionLabel(details.method, details.path);
  const code = String(details.code || '').toUpperCase();
  const known = reasons[code];
  const explicit = safeUserExplanation(details.serverMessage);

  const isUnexpected = code === 'INTERNAL_ERROR' || details.status >= 500 && !known;
  const isUnknownResult = details.method.toUpperCase() !== 'GET' && details.method.toUpperCase() !== 'HEAD';
  const fallbackCause = isUnexpected
    ? 'El servidor encontró un fallo inesperado. El motivo exacto necesita revisarse en los registros.'
    : details.status === 403
      ? 'Tu cuenta no tiene autorización para realizar esta acción.'
      : details.status === 404
        ? 'La información solicitada ya no está disponible.'
        : details.status === 429
          ? 'Se realizaron demasiadas solicitudes en poco tiempo.'
          : details.status >= 400 && details.status < 500
            ? 'El servidor no pudo aceptar los datos enviados.'
            : 'La operación no pudo completarse y aún no se conoce la causa exacta.';

  const fallbackAction = isUnknownResult
    ? 'Comprueba primero si los cambios se guardaron antes de intentarlo otra vez. Si continúa, solicita soporte.'
    : 'Actualiza la página y vuelve a intentarlo. Si continúa, solicita soporte.';

  const cause = explicit && !isUnexpected ? explicit : known?.cause || fallbackCause;
  const guidance = known?.action || (details.status === 401 ? 'Inicia sesión de nuevo.' : fallbackAction);
  const reference = typeof details.requestId === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(details.requestId)
    && (details.status >= 500 || details.status === 0)
    ? `\nReferencia para soporte: ${details.requestId}.`
    : '';

  return `No se pudo ${operation}.\nMotivo: ${cause}\nQué hacer: ${guidance}${reference}`;
}
