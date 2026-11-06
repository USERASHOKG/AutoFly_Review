export const MAX_REPLY_LENGTH = 4096; // Google's limit for review replies

export type ModerationFlag =
  | "contains_url"
  | "contains_phone"
  | "contains_email"
  | "promises_compensation"
  | "legal_or_medical_claim"
  | "admits_fault"
  | "too_long"
  | "empty";

export const FLAG_LABELS: Record<ModerationFlag, string> = {
  contains_url: "Contains a link",
  contains_phone: "Contains a phone number",
  contains_email: "Contains an email address",
  promises_compensation: "Promises a refund or compensation",
  legal_or_medical_claim: "Makes a legal or medical statement",
  admits_fault: "Admits fault or liability",
  too_long: "Longer than Google allows",
  empty: "Reply is empty",
};

const CHECKS: [ModerationFlag, RegExp][] = [
  ["contains_url", /(https?:\/\/|www\.)\S+/i],
  ["contains_email", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ["contains_phone", /(\+?\d[\d\s().-]{8,}\d)/],
  [
    "promises_compensation",
    /\b(refund|reimburse|compensat|free of charge|complimentary|discount|voucher|credit you)\w*/i,
  ],
  [
    "legal_or_medical_claim",
    /\b(lawsuit|sue|legal action|liab(le|ility)|diagnos\w+|medical advice|prescri\w+|cure[sd]?)\b/i,
  ],
  ["admits_fault", /\b(our fault|we were wrong|we admit|we are responsible|we take full responsibility)\b/i],
];

export function checkReply(text: string): ModerationFlag[] {
  const flags: ModerationFlag[] = [];
  const t = text.trim();
  if (!t) return ["empty"];
  if (t.length > MAX_REPLY_LENGTH) flags.push("too_long");
  for (const [flag, re] of CHECKS) if (re.test(t)) flags.push(flag);
  return flags;
}

/**
 * Low-star reviews and any flagged reply need an explicit extra confirmation
 * before they can go public. Enforced server-side in the publish route.
 */
export function needsExplicitConfirmation(starRating: number, flags: string[]): boolean {
  return starRating <= 3 || flags.some((f) => f !== "too_long" && f !== "empty");
}
