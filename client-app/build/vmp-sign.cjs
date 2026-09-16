'use strict';

const { execFileSync } = require('node:child_process');

module.exports = async function afterPack(context) {
  if (context?.electronPlatformName !== 'win32') return;

  const productionSigningRequired = process.env.USERFLOW_VMP_REQUIRED === '1';
  if (!productionSigningRequired) {
    console.log('EVS: development/PR build; production VMP signing skipped.');
    return;
  }

  const accountName = String(process.env.EVS_ACCOUNT_NAME || '').trim();
  const password = String(process.env.EVS_PASSWD || '');
  if (!accountName || !password) {
    throw new Error('Production VMP signing requires EVS_ACCOUNT_NAME and EVS_PASSWD GitHub secrets.');
  }

  const appOutDir = String(context?.appOutDir || '').trim();
  if (!appOutDir) throw new Error('electron-builder did not provide appOutDir for VMP signing.');

  console.log('EVS: requesting production VMP signature for packaged userFLOW...');
  execFileSync('python', ['-m', 'castlabs_evs.vmp', 'sign-pkg', appOutDir], {
    stdio: 'inherit',
    env: {
      ...process.env,
      EVS_NO_ASK: '1',
    },
  });
  console.log('EVS: production VMP signing completed successfully.');
};
