export type MemberCategory =
  | "member"
  | "investor"
  | "both"
  | "locomotive"
  | "stock"
  | "service"
  | "supplier";

function extractMembershipDigits(value: string | number | null | undefined) {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  const comparable = raw.replace(/\s+/g, "");
  const normalized = comparable.startsWith("SBC") ? comparable.replace(/O/g, "0") : comparable;
  const match = normalized.match(/(\d+)/);
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
  const maxNumeric = values.reduce<number>(
    (max, value) => Math.max(max, membershipSequenceValue(value)),
    0,
  );
  return formatMembershipNumber(Math.max(maxNumeric + 1, minimum));
}

export function isMembershipAccountReference(value: string | number | null | undefined) {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  const comparable = raw.replace(/\s+/g, "");
  const normalized = comparable.startsWith("SBC") ? comparable.replace(/O/g, "0") : comparable;
  return /^SBC\d+K?$/.test(normalized) || /^M\d+$/.test(normalized) || /^\d+$/.test(normalized);
}

export function legacyMemberIdFromSequence(value: string | number | null | undefined) {
  const sequence = membershipSequenceValue(value);
  if (!sequence) return undefined;
  return `M${String(sequence).padStart(3, "0")}`;
}

export function legacyShortMembershipNumber(value: string | number | null | undefined) {
  const digits = extractMembershipDigits(value);
  if (!digits) return undefined;
  return `SBC${digits.padStart(3, "0")}K`;
}

export function compactMembershipNumber(value: string | number | null | undefined) {
  const digits = extractMembershipDigits(value);
  if (!digits) return undefined;
  return `SBC${digits}K`;
}

export function membershipIdCandidates(value: string | number | null | undefined) {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!isMembershipAccountReference(raw)) return raw ? [raw] : [];
  const normalized = normalizeMembershipNumber(raw);
  const legacyShort = legacyShortMembershipNumber(raw);
  const compact = compactMembershipNumber(raw);
  const legacy = legacyMemberIdFromSequence(raw);
  const candidates = new Set<string>();
  if (raw) candidates.add(raw);
  if (normalized) candidates.add(normalized);
  if (legacyShort) candidates.add(legacyShort);
  if (compact) candidates.add(compact);
  if (legacy) candidates.add(legacy);
  return Array.from(candidates);
}

export function resolveMemberCategory(
  value?: string | null,
  isInvestor?: boolean | null,
): MemberCategory {
  if (
    value === "member" ||
    value === "investor" ||
    value === "both" ||
    value === "locomotive" ||
    value === "stock" ||
    value === "service" ||
    value === "supplier"
  ) {
    return value;
  }
  return isInvestor ? "both" : "member";
}

export function normalizeMemberTags(
  values?: Array<string | null | undefined> | string | null,
  fallbackCategory?: string | null,
  isInvestor?: boolean | null,
): MemberCategory[] {
  const rawValues = Array.isArray(values)
    ? values
    : String(values ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
  const tags = new Set<MemberCategory>();

  for (const value of rawValues) {
    tags.add(resolveMemberCategory(value));
  }

  const fallback = resolveMemberCategory(fallbackCategory, isInvestor);
  if (tags.size === 0 || fallback !== "member") tags.add(fallback);
  if (isInvestor) tags.add("investor");
  if (tags.size === 0) tags.add("member");
  if (tags.has("both")) {
    tags.delete("both");
    tags.add("member");
    tags.add("investor");
  }

  return Array.from(tags);
}

export function hasMemberTag(
  tags: Array<string | null | undefined> | undefined,
  category: MemberCategory,
  fallbackCategory?: MemberCategory | null,
) {
  return normalizeMemberTags(tags, fallbackCategory).includes(category);
}

export function isInvestorCategory(category?: MemberCategory | null) {
  const resolved = resolveMemberCategory(category);
  return resolved === "investor" || resolved === "both";
}

export function isInvestorOnlyCategory(category?: MemberCategory | null) {
  return resolveMemberCategory(category) === "investor";
}

export function isMemberCategory(category?: MemberCategory | null) {
  const resolved = resolveMemberCategory(category);
  return resolved !== "investor" && resolved !== "supplier";
}

export function memberCategoryLabel(category?: MemberCategory | null) {
  const resolved = resolveMemberCategory(category);
  if (resolved === "investor") return "Investor";
  if (resolved === "both") return "Member + Investor";
  if (resolved === "locomotive") return "Locomotive";
  if (resolved === "stock") return "Stock";
  if (resolved === "service") return "Service";
  if (resolved === "supplier") return "Supplier";
  return "Member";
}

export function isSpecialMemberCategory(category?: MemberCategory | null) {
  const resolved = resolveMemberCategory(category);
  return resolved === "locomotive" || resolved === "stock" || resolved === "service";
}
