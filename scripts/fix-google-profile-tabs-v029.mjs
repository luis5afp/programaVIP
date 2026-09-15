import fs from 'node:fs/promises';

function mustReplace(content, from, to, label) {
  if (!content.includes(from)) throw new Error(`Missing marker: ${label}`);
  return content.replace(from, to);
}

{
  const path = 'client-app/main.js';
  let s = await fs.readFile(path, 'utf8');
  s = mustReplace(
    s,
    `    networkLabel: workspace.connection?.mode === 'proxy'\n      ? (lockedIp ? \`IP protegida · \${lockedIp}\` : 'Proxy del perfil')\n      : 'Conexión directa',\n    allowExternalBrowsing: authMeta?.client?.allowExternalBrowsing === true,\n  };\n}\n\nfunction attachedProfileIds()`,
    `    networkLabel: workspace.connection?.mode === 'proxy'\n      ? (lockedIp ? \`IP protegida · \${lockedIp}\` : 'Proxy del perfil')\n      : 'Conexión directa',\n  };\n}\n\nfunction attachedProfileIds()`,
    'remove permission from attached tab payload',
  );
  s = mustReplace(
    s,
    `    networkLabel: workspace.connection?.mode === 'proxy'\n      ? (lockedIp ? \`IP protegida · \${lockedIp}\` : 'Proxy del perfil')\n      : 'Conexión directa',\n  };\n}\n\nfunction sendDetachedState`,
    `    networkLabel: workspace.connection?.mode === 'proxy'\n      ? (lockedIp ? \`IP protegida · \${lockedIp}\` : 'Proxy del perfil')\n      : 'Conexión directa',\n    allowExternalBrowsing: authMeta?.client?.allowExternalBrowsing === true,\n  };\n}\n\nfunction sendDetachedState`,
    'add permission to detached state',
  );
  await fs.writeFile(path, s, 'utf8');
}

{
  const path = 'client-app/profile-window.css';
  let s = await fs.readFile(path, 'utf8');
  s = mustReplace(s, `  top: 34px;`, `  top: 31px;`, 'popover top');
  s = mustReplace(s, `  padding: 3px;`, `  padding: 2px;`, 'popover padding');
  s = mustReplace(s, `  height: 24px;`, `  height: 22px;`, 'popover option height');
  await fs.writeFile(path, s, 'utf8');
}

console.log('Fixed detached permission state and compact popover bounds.');
