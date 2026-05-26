import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, Badge } from "@/components/ui-bits";
import {
  useStore,
  fmtKES,
  formatMembershipNumber,
  hasMemberTag,
  isInvestorCategory,
  isInvestorOnlyCategory,
  isMemberCategory,
  memberCategoryLabel,
  nextMembershipNumber,
  normalizeMembershipNumber,
  type BusinessPermanence,
  type Member,
  type MemberCategory,
} from "@/lib/store";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { MemberLoanHistory } from "@/components/loans/LoanBook";
import { MemberPayDialog } from "@/components/MemberPayDialog";
import { Smartphone, Send } from "lucide-react";

type MemberForm = {
  memberNo: string;
  category: MemberCategory;
  memberTags: MemberCategory[];
  firstName: string;
  secondName: string;
  thirdName: string;
  dob: string;
  gender: "Male" | "Female";
  phone: string;
  email: string;
  address: string;
  city: string;
  county: string;
  village: string;
  businessName: string;
  businessType: string;
  businessPermanence: "" | BusinessPermanence;
  businessAddress: string;
  fieldOfficerId: string;
  shares: number;
  savingsBalance: number;
  investorContribution: number;
  investorNotes: string;
};

type RegistryView = "all" | "normal" | "locomotive" | "stock" | "service";

export const Route = createFileRoute("/members")({
  head: () => ({ meta: [{ title: "Members — Sauti Microfinance" }] }),
  component: MembersPage,
});

function MembersPage() {
  const { members, loans, addMember, updateMember, sharePrice, currentUser } = useStore();
  const [open, setOpen] = useState(false);
  const nextMemberNo = useMemo(
    () =>
      nextMembershipNumber(
        members.map((member) => member.id),
        1,
      ),
    [members],
  );

  const buildEmptyForm = (memberNo: string): MemberForm => ({
    memberNo,
    category: "member" as MemberCategory,
    memberTags: ["member"] as MemberCategory[],
    firstName: "",
    secondName: "",
    thirdName: "",
    dob: "",
    gender: "Male" as "Male" | "Female",
    phone: "",
    email: "",
    address: "",
    city: "",
    county: "",
    village: "",
    businessName: "",
    businessType: "",
    businessPermanence: "" as "" | BusinessPermanence,
    businessAddress: "",
    fieldOfficerId: "",
    shares: 0,
    savingsBalance: 0,
    investorContribution: 0,
    investorNotes: "",
  });
  const [form, setForm] = useState(() => buildEmptyForm(nextMemberNo));
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const isEditMode = Boolean(editingMemberId);
  const [q, setQ] = useState("");
  const [registryView, setRegistryView] = useState<RegistryView>("all");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [payDialog, setPayDialog] = useState<{ member: Member; mode: "member" | "officer" } | null>(
    null,
  );
  const nav = useNavigate();

  const buildFormFromMember = (member: Member): MemberForm => ({
    memberNo: member.id,
    category: member.category,
    memberTags: member.memberTags?.length ? member.memberTags : [member.category],
    firstName: member.firstName ?? "",
    secondName: member.secondName ?? "",
    thirdName: member.thirdName ?? "",
    dob: member.dob ?? "",
    gender: member.gender ?? "Male",
    phone: member.phone,
    email: member.email ?? "",
    address: member.address ?? "",
    city: member.city ?? "",
    county: member.county ?? "",
    village: member.village ?? "",
    businessName: member.businessName ?? "",
    businessType: member.businessType ?? "",
    businessPermanence: member.businessPermanence ?? "",
    businessAddress: member.businessAddress ?? "",
    fieldOfficerId: member.fieldOfficerId ?? "",
    shares: member.shares,
    savingsBalance: member.savingsBalance,
    investorContribution: 0,
    investorNotes: "",
  });
  const isOfficer =
    currentUser.role === "loan_officer" ||
    currentUser.role === "manager" ||
    currentUser.role === "director";
  const memberRegistry = useMemo(
    () =>
      members.filter(
        (member) => !isInvestorOnlyCategory(member.category) && isMemberCategory(member.category),
      ),
    [members],
  );

  const filtered = memberRegistry.filter((m) => {
    const matchesSearch = m.name.toLowerCase().includes(q.toLowerCase()) || m.phone.includes(q);
    if (!matchesSearch) return false;
    if (registryView === "all") return true;
    if (registryView === "normal") {
      return (
        m.category === "member" ||
        m.category === "both" ||
        hasMemberTag(m.memberTags, "member", m.category)
      );
    }
    return hasMemberTag(m.memberTags, registryView, m.category);
  });
  const showMemberFields = !isInvestorOnlyCategory(form.category);
  const showInvestorFields = isInvestorCategory(form.category) || form.memberTags.includes("investor");

  return (
    <>
      <AppHeader
        title="Members"
        subtitle="Normal, locomotive, and service members in one clean registry, with full Member 360 on each row."
      />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="members" />
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", "All members"],
              ["normal", "Normal"],
              ["locomotive", "Locomotive"],
              ["stock", "Stock"],
              ["service", "Service"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setRegistryView(value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                registryView === value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex justify-between items-center gap-3">
          <input
            placeholder="Search by name or phone…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="bg-card border border-border rounded-md px-3 py-2 text-sm w-72"
          />
          <button
            onClick={() => {
              setEditingMemberId(null);
              setForm(buildEmptyForm(nextMemberNo));
              setOpen(true);
            }}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90"
          >
            + Register member
          </button>
        </div>

        <Section title={`Registry (${filtered.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3 text-left">Membership #</th>
                  <th className="px-5 py-3 text-left">Name</th>
                  <th className="px-5 py-3 text-left">Phone</th>
                  <th className="px-5 py-3 text-left">Joined</th>
                  <th className="px-5 py-3 text-right">Share No.</th>
                  <th className="px-5 py-3 text-right">Shares Value</th>
                  <th className="px-5 py-3 text-right">Savings</th>
                  <th className="px-5 py-3 text-right">Loans</th>
                  <th className="px-5 py-3 text-left">Category</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((m) => {
                  const memberLoans = loans.filter((l) => l.memberId === m.id);
                  const active = memberLoans.filter((l) => l.status === "active").length;
                  return (
                    <tr
                      key={m.id}
                      className="hover:bg-muted/30"
                      title="Click row to open Member 360"
                    >
                      <td
                        className="px-5 py-3 font-mono text-xs cursor-pointer"
                        onClick={() => setHistoryId(m.id)}
                      >
                        {formatMembershipNumber(m.id)}
                      </td>
                      <td
                        className="px-5 py-3 font-medium cursor-pointer"
                        onClick={() => setHistoryId(m.id)}
                      >
                        {m.name}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{m.phone}</td>
                      <td className="px-5 py-3 text-muted-foreground">{m.joinedAt}</td>
                      <td className="px-5 py-3 text-right">{m.shares}</td>
                      <td className="px-5 py-3 text-right">{fmtKES(m.shares * sharePrice)}</td>
                      <td className="px-5 py-3 text-right">{fmtKES(m.savingsBalance)}</td>
                      <td className="px-5 py-3 text-right">
                        {active}/{memberLoans.length}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={m.category === "both" ? "accent" : "default"}>
                          {memberCategoryLabel(m.category)}
                        </Badge>
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={m.status === "active" ? "success" : "muted"}>{m.status}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPayDialog({ member: m, mode: "member" });
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/20"
                            title="Member self-pay"
                          >
                            <Smartphone className="h-3 w-3" /> Pay
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingMemberId(m.id);
                              setForm(buildFormFromMember(m));
                              setOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-muted/10 text-foreground hover:bg-muted/20"
                            title="Edit member"
                          >
                            Edit
                          </button>
                          {isOfficer && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPayDialog({ member: m, mode: "officer" });
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-accent/20 text-accent-foreground hover:bg-accent/40"
                              title="Prompt member for upfront / fees"
                            >
                              <Send className="h-3 w-3" /> Prompt
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      </main>

      {payDialog && (
        <MemberPayDialog
          member={payDialog.member}
          mode={payDialog.mode}
          onClose={() => setPayDialog(null)}
        />
      )}

      {historyId && (
        <MemberLoanHistory
          memberId={historyId}
          onClose={() => setHistoryId(null)}
          onNewLoan={(id) => {
            setHistoryId(null);
            nav({ to: "/loans" });
            toast.success(`Switch to Loans → New / Repeat Application; member ${id} preselected`);
          }}
        />
      )}

      {open && (
        <div
          className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4 overflow-y-auto"
          onClick={() => {
            setOpen(false);
            setEditingMemberId(null);
          }}
        >
          <div
            className="bg-card rounded-xl border border-border w-full max-w-2xl p-6 my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-lg font-semibold mb-4">
              {isEditMode ? "Edit Member" : "Register Member"}
            </h3>

            <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
              {/* Applicant Details */}
              <section>
                <h4 className="font-display text-base font-semibold mb-3">Applicant Details</h4>
                <div className="space-y-3">
                  <Field label="Member No.">
                    <input
                      className="input"
                      value={form.memberNo}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          memberNo: e.target.value.toUpperCase().replace(/\s+/g, ""),
                        })
                      }
                      onBlur={() => {
                        const normalized = normalizeMembershipNumber(form.memberNo);
                        if (normalized) {
                          setForm((prev) => ({ ...prev, memberNo: normalized }));
                        }
                      }}
                    />
                  </Field>
                  <Field label="Primary Registration Category">
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { value: "member", label: "Member" },
                          { value: "investor", label: "Investor" },
                          { value: "both", label: "Both" },
                          { value: "locomotive", label: "Locomotive" },
                          { value: "stock", label: "Stock" },
                          { value: "service", label: "Service" },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setForm({ ...form, category: option.value })}
                          className={`rounded-md border px-3 py-2 text-sm font-medium ${
                            form.category === option.value
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border hover:bg-muted"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Member Roles">
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { value: "member", label: "Member" },
                          { value: "investor", label: "Investor" },
                          { value: "locomotive", label: "Locomotive" },
                          { value: "stock", label: "Stock" },
                          { value: "service", label: "Service" },
                        ] as const
                      ).map((option) => {
                        const checked = form.memberTags.includes(option.value);
                        return (
                          <label
                            key={option.value}
                            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                              checked
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border hover:bg-muted"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const next = event.target.checked
                                  ? [...new Set([...form.memberTags, option.value])]
                                  : form.memberTags.filter((tag) => tag !== option.value);
                                setForm({
                                  ...form,
                                  memberTags: next.length ? next : ["member"],
                                  category:
                                    form.category === "both"
                                      ? event.target.checked && option.value === "investor"
                                        ? "both"
                                        : form.category
                                      : form.category,
                                });
                              }}
                            />
                            {option.label}
                          </label>
                        );
                      })}
                    </div>
                  </Field>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="First Name">
                      <input
                        className="input"
                        value={form.firstName}
                        onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                      />
                    </Field>
                    <Field label="Second Name">
                      <input
                        className="input"
                        value={form.secondName}
                        onChange={(e) => setForm({ ...form, secondName: e.target.value })}
                      />
                    </Field>
                    <Field label="Third Name">
                      <input
                        className="input"
                        value={form.thirdName}
                        onChange={(e) => setForm({ ...form, thirdName: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label="Date of Birth">
                    <input
                      type="date"
                      className="input"
                      value={form.dob}
                      onChange={(e) => setForm({ ...form, dob: e.target.value })}
                    />
                  </Field>
                  <Field label="Gender">
                    <select
                      className="input"
                      value={form.gender}
                      onChange={(e) =>
                        setForm({ ...form, gender: e.target.value as "Male" | "Female" })
                      }
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </Field>
                  <Field label="Phone">
                    <input
                      className="input"
                      placeholder="07XXXXXXXX or 01XXXXXXXX"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      type="email"
                      className="input"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </Field>
                  <Field label="Address">
                    <textarea
                      rows={2}
                      className="input"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                    />
                  </Field>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="City">
                      <input
                        className="input"
                        value={form.city}
                        onChange={(e) => setForm({ ...form, city: e.target.value })}
                      />
                    </Field>
                    <Field label="County">
                      <input
                        className="input"
                        value={form.county}
                        onChange={(e) => setForm({ ...form, county: e.target.value })}
                      />
                    </Field>
                    <Field label="Village">
                      <input
                        className="input"
                        value={form.village}
                        onChange={(e) => setForm({ ...form, village: e.target.value })}
                      />
                    </Field>
                  </div>
                </div>
              </section>

              {/* Business Details */}
              <section>
                <h4 className="font-display text-base font-semibold mb-3">Business Details</h4>
                <div className="space-y-3">
                  <Field label="Business Name">
                    <input
                      className="input"
                      value={form.businessName}
                      onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                    />
                  </Field>
                  <Field label="Business Type">
                    <input
                      className="input"
                      value={form.businessType}
                      onChange={(e) => setForm({ ...form, businessType: e.target.value })}
                    />
                  </Field>
                  <Field label="Business Setup">
                    <select
                      className="input"
                      value={form.businessPermanence}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          businessPermanence: e.target.value as "" | BusinessPermanence,
                        })
                      }
                    >
                      <option value="">Select business setup</option>
                      <option value="permanent">Permanent</option>
                      <option value="semi">Semi-permanent</option>
                    </select>
                  </Field>
                  <p className="text-xs text-muted-foreground">
                    Permanent businesses attract the sticker fee. Semi-permanent businesses do not.
                  </p>
                  <Field label="Business Address">
                    <textarea
                      rows={2}
                      className="input"
                      value={form.businessAddress}
                      onChange={(e) => setForm({ ...form, businessAddress: e.target.value })}
                    />
                  </Field>
                  <Field label="Field Officer ID">
                    <input
                      className="input"
                      value={form.fieldOfficerId}
                      onChange={(e) => setForm({ ...form, fieldOfficerId: e.target.value })}
                    />
                  </Field>
                </div>
              </section>

              {/* Initial balances */}
              {showMemberFields && (
                <section>
                  <h4 className="font-display text-base font-semibold mb-3">Initial Balances</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Initial Shares">
                      <input
                        type="number"
                        className="input"
                        value={form.shares}
                        onChange={(e) => setForm({ ...form, shares: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Initial Savings (KSh)">
                      <input
                        type="number"
                        className="input"
                        value={form.savingsBalance}
                        onChange={(e) =>
                          setForm({ ...form, savingsBalance: Number(e.target.value) })
                        }
                      />
                    </Field>
                  </div>
                </section>
              )}

              {/* Investor option */}
              {showInvestorFields && (
                <section className="border-t border-border pt-4">
                  <p className="text-sm font-medium">
                    {isInvestorOnlyCategory(form.category)
                      ? "Investor account"
                      : "Member-investor details"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Investor-only accounts route Paybill payments to investments. For Both, normal
                    member payment logic takes priority, and investment top-ups should be recorded
                    from the Investors page.
                  </p>
                  <div className="space-y-2 mt-3">
                    <input
                      type="number"
                      placeholder="Initial investment (KSh)"
                      className="input"
                      value={form.investorContribution}
                      onChange={(e) =>
                        setForm({ ...form, investorContribution: Number(e.target.value) })
                      }
                    />
                    <textarea
                      placeholder="Investor notes (optional)"
                      rows={2}
                      className="input"
                      value={form.investorNotes}
                      onChange={(e) => setForm({ ...form, investorNotes: e.target.value })}
                    />
                  </div>
                </section>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => {
                  setOpen(false);
                  setEditingMemberId(null);
                }}
                className="px-3 py-1.5 text-sm rounded-md hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const normalizedMemberNo = normalizeMembershipNumber(form.memberNo);
                  const fullName = [form.firstName, form.secondName, form.thirdName]
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                  if (!normalizedMemberNo) {
                    toast.error("Membership number must follow the SBC0001K format.");
                    return;
                  }
                  if (!form.firstName.trim()) {
                    toast.error("First name is required");
                    return;
                  }
                  if (!form.phone) {
                    toast.error("Phone number is required");
                    return;
                  }
                  const phone = form.phone.replace(/\s+/g, "");
                  if (!/^0(1|7)\d{8}$/.test(phone)) {
                    toast.error("Use a local phone number starting with 07 or 01.");
                    return;
                  }
                  if (
                    (form.businessName || form.businessType || form.businessAddress) &&
                    !form.businessPermanence
                  ) {
                    toast.error("Select whether the business is permanent or semi-permanent.");
                    return;
                  }
                  try {
                    if (isEditMode && editingMemberId) {
                      await updateMember({
                        memberId: editingMemberId,
                        nextMemberId:
                          normalizedMemberNo !== editingMemberId ? normalizedMemberNo : undefined,
                        name: fullName,
                        phone,
                        status: "active",
                        shares: form.shares,
                        savingsBalance: form.savingsBalance,
                        category: form.category,
                        memberTags: form.memberTags,
                        firstName: form.firstName || undefined,
                        secondName: form.secondName || undefined,
                        thirdName: form.thirdName || undefined,
                        dob: form.dob || undefined,
                        gender: form.gender,
                        email: form.email || undefined,
                        address: form.address || undefined,
                        city: form.city || undefined,
                        county: form.county || undefined,
                        village: form.village || undefined,
                        businessName: form.businessName || undefined,
                        businessType: form.businessType || undefined,
                        businessPermanence: form.businessPermanence || undefined,
                        businessAddress: form.businessAddress || undefined,
                        fieldOfficerId: form.fieldOfficerId || undefined,
                      });
                      toast.success("Member updated");
                    } else {
                      await addMember({
                        memberId: normalizedMemberNo,
                        name: fullName,
                        phone,
                        status: "active",
                        shares: form.shares,
                        savingsBalance: form.savingsBalance,
                        joinedAt: new Date().toISOString().slice(0, 10),
                        firstName: form.firstName || undefined,
                        secondName: form.secondName || undefined,
                        thirdName: form.thirdName || undefined,
                        dob: form.dob || undefined,
                        gender: form.gender,
                        email: form.email || undefined,
                        address: form.address || undefined,
                        city: form.city || undefined,
                        county: form.county || undefined,
                        village: form.village || undefined,
                        businessName: form.businessName || undefined,
                        businessType: form.businessType || undefined,
                        businessPermanence: form.businessPermanence || undefined,
                        businessAddress: form.businessAddress || undefined,
                        fieldOfficerId: form.fieldOfficerId || undefined,
                        category: form.category,
                        memberTags: form.memberTags,
                        investorContribution: showInvestorFields
                          ? form.investorContribution
                          : undefined,
                        investorNotes: showInvestorFields ? form.investorNotes : undefined,
                      });
                      toast.success(
                        isInvestorOnlyCategory(form.category)
                          ? "Investor registered"
                          : isInvestorCategory(form.category)
                            ? "Member-investor registered"
                            : "Member registered",
                      );
                    }
                    setOpen(false);
                    setEditingMemberId(null);
                    setForm(buildEmptyForm(nextMemberNo));
                  } catch (error: unknown) {
                    toast.error(error instanceof Error ? error.message : "Failed to save member");
                  }
                }}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <div className="mt-1 [&_.input]:w-full [&_.input]:bg-card [&_.input]:border [&_.input]:border-border [&_.input]:rounded-md [&_.input]:px-3 [&_.input]:py-2 [&_.input]:text-sm [&_.input]:focus:outline-none [&_.input]:focus:ring-2 [&_.input]:focus:ring-primary/40">
        {children}
      </div>
    </label>
  );
}
