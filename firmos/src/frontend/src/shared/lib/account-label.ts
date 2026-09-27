/**
 * The D2 account display standard (meeting #3, 00:18:10 / 00:32:17):
 * "bank name -> account type -> last 4" everywhere an account is named -
 * intake mini-forms, the online-access checklist, the review screen, the
 * statements grid/queue, the client record's accounts table, and vault slot
 * labels. The intake nickname field is gone (D1); the identifier is the
 * bank plus the masked last-4 capture.
 *
 * `accountLabel` renders the standard when a 4-digit last4 is present and
 * falls back to the row's stored name for legacy accounts captured before
 * it existed.
 */

/** The pieces a label can be built from - intake mini-form items and
 *  accounts table rows both fit this shape. */
export interface AccountLabelParts {
  name?: string | null;
  institution?: string | null;
  accountType?: string | null;
  last4?: string | null;
}

/** Type words for the label's middle slot ("Chase Checking · 4411"). The
 *  intake money types carry plain words; anything else humanizes its key. */
const LABEL_TYPE_WORDS: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit card',
  merchant: 'Merchant',
  loan: 'Loan',
  vehicle_loan: 'Vehicle loan',
  line_of_credit: 'Line of credit',
  mortgage: 'Mortgage',
};

function typeWord(accountType: string | null | undefined): string | null {
  const key = accountType?.trim().toLowerCase();
  if (!key) return null;
  return (
    LABEL_TYPE_WORDS[key] ??
    key
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  );
}

/** Exactly 4 digits, else null - the intake mini-form and conversion both
 *  gate through this (the column is app-layer checked, not a DB CHECK). */
export function normalizeLast4(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return /^\d{4}$/.test(digits) && digits === String(value ?? '').trim() ? digits : null;
}

/** "Chase Checking · 4411"; legacy rows without last4 keep the old label. */
export function accountLabel(account: AccountLabelParts): string {
  const last4 = normalizeLast4(account.last4);
  if (last4 == null) {
    return (
      [account.name, account.institution]
        .map((v) => v?.trim())
        .find((v): v is string => !!v) ?? 'Account'
    );
  }
  const parts = [account.institution?.trim(), typeWord(account.accountType)].filter(
    (p): p is string => !!p,
  );
  const head = parts.join(' ');
  return head === '' ? `Account · ${last4}` : `${head} · ${last4}`;
}
