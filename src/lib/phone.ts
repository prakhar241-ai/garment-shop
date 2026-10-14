// Login is phone + 6-digit PIN. Supabase Auth stores it as an email/password
// pair: the email is derived from the phone number and never receives mail
// (example.com is reserved), and the PIN is the password. No SMS cost.

/** "+91 98765-43210" -> "9876543210". Returns null unless it is a 10-digit Indian mobile. */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export function phoneToAuthEmail(phone: string): string {
  return `p${phone}@phone-login.example.com`;
}
