/**
 * Institution-name normalization (intake restructure I3/I5): the single
 * definition both sides match on. `institutions.name`, SOP `institution_key`
 * values, and the accounts text snapshot all fold through here so
 * "Columbia Bank", " columbia  bank ", and "COLUMBIA BANK" are one key.
 */
export function normalizeInstitutionKey(value: string | null | undefined): string | null {
  const key = value?.trim().replace(/\s+/g, ' ').toLowerCase();
  return key ? key : null;
}
