import { useMemo, useState } from "react";

import { memberCategoryLabel } from "@/lib/store";

type MemberOption = {
  id: string;
  name: string;
  phone?: string;
  category?: string;
  member_category?: string;
  shares?: number;
};

export function MemberSearchSelect({
  members,
  value,
  onChange,
  placeholder = "Search name, member no., or phone",
  emptyLabel = "Select member",
  describeMember,
}: {
  members: MemberOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  describeMember?: (member: MemberOption) => string;
}) {
  const [query, setQuery] = useState("");
  const filteredMembers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return members;
    return members.filter((member) =>
      [member.id, member.name, member.phone, member.category, member.member_category]
        .filter(Boolean)
        .some((part) => String(part).toLowerCase().includes(normalized)),
    );
  }, [members, query]);

  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
      />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
      >
        <option value="">{emptyLabel}</option>
        {filteredMembers.map((member) => (
          <option key={member.id} value={member.id}>
            {describeMember
              ? describeMember(member)
              : `${member.id} - ${member.name} (${memberCategoryLabel(
                  (member.member_category ?? member.category) as never,
                )})`}
          </option>
        ))}
      </select>
      {filteredMembers.length === 0 ? (
        <div className="text-xs text-muted-foreground">No members match that search.</div>
      ) : null}
    </div>
  );
}
