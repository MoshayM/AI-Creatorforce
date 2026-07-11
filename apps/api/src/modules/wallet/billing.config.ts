/** Credit-hold enforcement is opt-in (BILLING_ENFORCE_CREDITS) so zero-credit local deployments keep working. */
export function billingEnforced(): boolean {
  return (process.env['BILLING_ENFORCE_CREDITS'] ?? 'false').toLowerCase() === 'true';
}
