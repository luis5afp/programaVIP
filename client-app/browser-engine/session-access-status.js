// Classify only visible browser evidence. Never infer authentication from
// installed cookies, a successful launch, a blank page or missing login fields.
export function sessionAccessStatus(inspection, profileUrl, needsLogin = false) {
  if (!inspection || inspection.inspectionComplete !== true) return 'unconfirmed';
  if (inspection.humanVerificationVisible === true) return 'verification-required';
  if (inspection.netflixHouseholdRestriction === true || inspection.streamingAccessRestriction === true) return 'provider-restricted';
  if (needsLogin) return 'login-required';
  let target, current;
  try {
    target = new URL(profileUrl);
    current = new URL(inspection.currentUrl);
  } catch { return 'unconfirmed'; }
  if (current.origin !== target.origin || inspection.documentReady !== true || inspection.meaningfulContent !== true) return 'unconfirmed';
  // The syntx.ai public homepage displays an explicit Iniciar sesión action.
  // Unlike a generic login link on other services, do not classify that page
  // as authenticated when the sign-in action is present.
  if (target.hostname === 'syntx.ai' && inspection.explicitLoginActionVisible === true && inspection.logoutActionVisible !== true) return 'login-required';
  if (inspection.loginActionVisible === true) return 'unconfirmed';
  return inspection.logoutActionVisible === true ? 'authenticated' : 'unconfirmed';
}
