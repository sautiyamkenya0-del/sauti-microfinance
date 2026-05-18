export type MemberCategory = "member" | "investor" | "both";

function extractMembershipDigits(value: string | number | null | undefined) {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  const match = raw.match(/(\d+)/);
  if (!match) return undefined;
  return match[1].replace(/^0+/, "") || "0";
}

export function membershipSequenceValue(value: string | number | null | undefined) {
  const digits = extractMembershipDigits(value);
  return digits ? Number(digits) : 0;
}

export function formatMembershipNumber(value: string | number | null | undefined) {
  const digits = extractMembershipDigits(value);
  if (!digits)
    return String(value ?? "")
      .trim()
      .toUpperCase();
  return `SBC${digits.padStart(4, "0")}K`;
}

export function normalizeMembershipNumber(value: string | number | null | undefined) {
  const digits = extractMembershipDigits(value);
  if (!digits) return undefined;
  return `SBC${digits.padStart(4, "0")}K`;
}

export function nextMembershipNumber(
  values: Array<string | number | null | undefined>,
  minimum: number = 1,
) {
  const maxNumeric = values.reduce(
    (max, value) => Math.max(max, membershipSequenceValue(value)),
    0,
  );
  return formatMembershipNumber(Math.max(maxNumeric + 1, minimum));
}

export function isMembershipAccountReference(value: string | number | null | undefined) {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  return /^SBC\d{3,}K?$/.test(raw) || /^M\d+$/.test(raw);
}

export function legacyMemberIdFromSequence(value: string | number | null | undefined) {
  const sequence = membershipSequenceValue(value);
  if (!sequence) return undefined;
  return `M${String(sequence).padStart(3, "0")}`;
}

export function membershipIdCandidates(value: string | number | null | undefined) {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  const normalized = normalizeMembershipNumber(raw);
  const legacy = legacyMemberIdFromSequence(raw);
  const candidates = new Set<string>();
  if (raw) candidates.add(raw);
  if (normalized) candidates.add(normalized);
  if (legacy) candidates.add(legacy);
  return Array.from(candidates);
}

export function resolveMemberCategory(
  value?: string | null,
  isInvestor?: boolean | null,
): MemberCategory {
  if (value === "member" || value === "investor" || value === "both") return value;
  return isInvestor ? "both" : "member";
}

export function isInvestorCategory(category?: MemberCategory | null) {
  return resolveMemberCategory(category) !== "member";
}

export function isInvestorOnlyCategory(category?: MemberCategory | null) {
  return resolveMemberCategory(category) === "investor";
}

export function isMemberCategory(category?: MemberCategory | null) {
  return resolveMemberCategory(category) !== "investor";
}

export function memberCategoryLabel(category?: MemberCategory | null) {
  const resolved = resolveMemberCategory(category);
  if (resolved === "investor") return "Investor";
  if (resolved === "both") return "Member + Investor";
  return "Member";
}
