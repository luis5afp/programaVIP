'use strict';

const { execFileSync } = require('node:child_process');

module.exports = async function afterPack(context) {
  if (context?.electronPlatformName !== 'win32') return;

  const productionSigningRequested = process.env.USERFLOW_VMP_REQUIRED === '1';
  if (!productionSigningRequested) {
    console.log('EVS: production VMP signing not requested; continuing build.');
    return;
  }

  const accountName = String(process.env.EVS_ACCOUNT_NAME || '').trim();
  const password = String(process.env.EVS_PASSWD || '');
  if (!accountName || !password) {
    console.warn('EVS: production credentials are not configured; continuing without production VMP signing so client updates are not blocked.');
    return;
  }

  const appOutDir = String(context?.appOutDir || '').trim();
  if (!appOutDir) {
    console.warn('EVS: electron-builder did not provide appOutDir; continuing without production VMP signing.');
    return;
  }

  try {
    console.log('EVS: requesting production VMP signature for packaged userFLOW...');
    execFileSync('python', ['-m', 'castlabs_evs.vmp', 'sign-pkg', appOutDir], {
      stdio: 'inherit',
      env: {
        ...process.env,
        EVS_NO_ASK: '1',
      },
    });
    console.log('EVS: production VMP signing completed successfully.');
  } catch (error) {
    console.warn(`EVS: production signing failed; continuing build so automatic client updates are not blocked. ${error?.message || error}`);
  }
};
