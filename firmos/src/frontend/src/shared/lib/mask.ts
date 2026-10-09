/**
 * L5 (J1, 10_06 01:07:49): password-style masking for sensitive identifiers
 * - "like a password where it has like a hide unhide… click the button
 * really quick to hide it or to unhide it." Bullets everywhere except the
 * last two digits; the canonical 9-digit EIN keeps its dash (••-•••••67).
 */
export function maskTaxId(taxId: string): string {
  const digits = taxId.replace(/\D/g, '')
  if (digits.length === 0) return '••'
  if (digits.length <= 2) return '•'.repeat(digits.length)
  const masked = '•'.repeat(digits.length - 2) + digits.slice(-2)
  return digits.length === 9 ? `${masked.slice(0, 2)}-${masked.slice(2)}` : masked
}
