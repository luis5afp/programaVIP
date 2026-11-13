// EX1 and EX2 are distributed globally but can be opted out of individually.
// The existing userflex_profile_extensions join table records opt-outs for
// these two *global* extensions; every other row keeps its normal assignment
// semantics. Browser Guard is never controlled by this table.
const OPTIONAL_GLOBAL_NAMES = new Set(['ex1', 'ex2']);

export function isProfileOptionalGlobalExtension(row: { scope: string; name: string }) {
  return row.scope === 'global'
    && OPTIONAL_GLOBAL_NAMES.has(String(row.name || '').toLowerCase());
}

export function persistedProfileExtensionIds({
  selectedIds,
  optionalGlobalIds,
  previousMembershipIds,
  manageOptionalGlobals,
}: {
  selectedIds: string[];
  optionalGlobalIds: string[];
  previousMembershipIds: string[];
  manageOptionalGlobals: boolean;
}) {
  const optional = new Set(optionalGlobalIds);
  const selected = new Set(selectedIds);
  // Old Admin clients only submitted selective IDs. Preserve existing opt-outs
  // until the caller explicitly enables the new EX1/EX2 selection protocol.
  const optOuts = manageOptionalGlobals
    ? optionalGlobalIds.filter((id) => !selected.has(id))
    : previousMembershipIds.filter((id) => optional.has(id));
  return [...new Set([...selectedIds.filter((id) => !optional.has(id)), ...optOuts])];
}

export function filterGlobalExtensionsForProfile<T extends { id: string; name: string; scope: string }>(
  extensions: T[],
  profileMembershipIds: Iterable<string>,
): T[] {
  const optedOut = new Set(profileMembershipIds);
  return extensions.filter((item) =>
    !isProfileOptionalGlobalExtension(item) || !optedOut.has(item.id));
}

export function optionalGlobalAvailableToAnyProfile(profileIds: string[], optedOutProfileIds: Iterable<string>) {
  const optedOut = new Set(optedOutProfileIds);
  return profileIds.some((profileId) => !optedOut.has(profileId));
}
