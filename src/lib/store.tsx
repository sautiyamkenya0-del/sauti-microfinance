import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  applyMpesaPaymentRecord,
  createAppraisalRecord,
  createFieldVisitRecord,
  createFollowupRecord,
  createInvestorRecord,
  createLoanRecord,
  createMemberRecord,
  updateMemberRecord,
  createPettyCashRecord,
  createStaffMessageRecord,
  createStaffRecord,
  createTransactionRecord,
  deleteStaffRecord,
  loadAppData,
  loadAppDataIfChanged,
  reviewLoanRecord,
  settlePenaltyFromPoolRecord,
  updateStaffRecord,
  upsertAttendanceRecord,
} from "@/lib/app-data.functions";
import { signInMember, signInStaff, signOutSession } from "@/lib/auth.functions";
import {
  formatMembershipNumber,
  isInvestorCategory,
  isMemberCategory,
  isInvestorOnlyCategory,
  isSpecialMemberCategory,
  nextMembershipNumber,
  membershipIdCandidates,
  membershipSequenceValue,
  memberCategoryLabel,
  normalizeMembershipNumber,
  resolveMemberCategory,
  type MemberCategory,
} from "@/lib/membership";
import { normalizeFeePolicies, type FeePolicy } from "@/lib/fees-policy";
import {
  DEFAULT_POLICY_SETTINGS,
  getActivePolicySettings,
  normalizePolicyTermDays,
  policyInterestRateForTerm,
  setActivePolicySettings,
  transactionFeeForAmount,
  type PolicyLoanType,
  type PolicySettings,
} from "@/lib/policy-settings";
import { listStaffMessages } from "@/lib/runtime-data.functions";

export type Role = "director" | "manager" | "loan_officer";

export type MandatoryFees = {
  membership: boolean; // registration fee settled
  card: boolean; // membership card settled
  hasShop: boolean; // sticker only required if member has a physical shop
  sticker: boolean; // sticker settled when a shop / permanent business applies
  firstUpfrontPaid: boolean; // first-installment / loan upfront already settled manually
};

export type BusinessPermanence = "permanent" | "semi";

export type Member = {
  id: string;
  name: string;
  phone: string;
  joinedAt: string;
  status: "active" | "dormant";
  shares: number;
  shareReserveBalance?: number;
  savingsBalance: number;
  fees: MandatoryFees;
  category: MemberCategory;
  isInvestor?: boolean;
  investorId?: string;
  // Extended applicant profile (per SBC registration form)
  firstName?: string;
  secondName?: string;
  thirdName?: string;
  /** @deprecated kept for back-compat with old data; prefer secondName/thirdName */
  lastName?: string;
  dob?: string;
  gender?: "Male" | "Female";
  email?: string;
  address?: string;
  city?: string;
  county?: string;
  village?: string;
  savingsOnly?: boolean;
  oldSystemId?: string;
  // Business details
  businessName?: string;
  businessType?: string;
  businessPermanence?: BusinessPermanence;
  businessAddress?: string;
  fieldOfficerId?: string;
};

/** SBC policy: loan terms are fixed-day buckets, not months. */
export type LoanTermDays = 7 | 14 | 30 | 60 | 90;
export type LoanChargeMode = "upfront" | "financed";
export type LoanProductType = PolicyLoanType;
export type LoanKind = "financial" | "fuel" | "stock" | "service";

export type LoanFixedFeeModes = {
  membershipFeeAmount?: number;
  membershipFeeMode?: LoanChargeMode;
  cardFeeAmount?: number;
  cardFeeMode?: LoanChargeMode;
  stickerFeeAmount?: number;
  stickerFeeMode?: LoanChargeMode;
};

export type Loan = {
  id: string;
  memberId: string;
  principal: number; // requested / planned NET disbursement
  approvedAmount?: number; // approved NET disbursement
  financedPrincipalAmount?: number; // financed balance used for pricing and repayment
  rate: number; // % per month (legacy field — kept for old seed loans)
  termMonths: number; // legacy field, kept for back-compat
  termDays?: LoanTermDays; // new: SBC fixed term (7/14/30/60/90)
  startDate: string;
  status: "pending" | "active" | "closed" | "defaulted" | "rejected";
  officerId: string;
  paid: number;
  netDisbursedAmount?: number;
  processingFeeAmount?: number;
  insuranceFeeAmount?: number;
  transactionFeeAmount?: number;
  processingFeeMode?: LoanChargeMode;
  insuranceFeeMode?: LoanChargeMode;
  disbursementStatus?: "not_requested" | "requested" | "paid" | "failed" | "timeout";
  purpose?: string;
  loanKind?: LoanKind;
  supplierPayload?: Record<string, unknown>;
  supplierId?: string;
  supplierRequestStatus?: string;
  reviewedBy?: string;
  reviewNote?: string;
};

export type Transaction = {
  id: string;
  date: string;
  createdAt?: string;
  type:
    | "deposit"
    | "withdrawal"
    | "loan_disbursement"
    | "loan_repayment"
    | "share_purchase"
    | "petty_cash"
    | "investor_contribution"
    | "fee_payment"
    | "mpesa_unallocated"
    | "staff_payroll";
  account?: string; // M-Pesa Paybill account = membership number
  payerName?: string; // payer name as read from Daraja
  amount: number;
  memberId?: string;
  loanId?: string;
  ref?: string;
  by: string;
  note?: string;
};

export type PettyCashEntry = {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  by: string;
  time?: string;
  type?: "payment" | "topup";
  payee?: string;
  contact?: string;
  mode?: "cash" | "mpesa" | "bank";
  reference?: string;
  txnCost?: number;
  openingBalance?: number;
};

export type StaffMessageAttachment = {
  name: string;
  type: string;
  size: number;
  data: string;
};

export type StaffMessage = {
  id: string;
  senderId: string;
  receiverId: string;
  senderName: string;
  content?: string;
  attachment?: StaffMessageAttachment;
  createdAt: string;
};

export type Investor = {
  id: string;
  name: string;
  contributed: number;
  sharePct: number;
  joinedAt: string;
  phone?: string;
  notes?: string;
  memberId?: string;
};

export type Attendance = {
  id: string;
  staffId: string;
  date: string;
  status: "present" | "absent" | "late" | "signed_out" | "permission";
  checkIn?: string;
  checkOut?: string;
};

export type Staff = {
  id: string;
  name: string;
  role: Role;
  firstName?: string;
  secondName?: string;
  thirdName?: string;
  email?: string;
  phone?: string;
  nationalId?: string;
  address?: string;
  notes?: string;
  photo?: string;
  tempPassword?: string;
  /** Director-granted capability — can check OTHER staff in/out on the Attendance page. */
  canMarkAttendance?: boolean;
  fingerprintEnrolled?: boolean;
};

/** Build a display name from up-to-three name fields, falling back to legacy fields. */
export function joinName(parts: {
  firstName?: string;
  secondName?: string;
  thirdName?: string;
  lastName?: string;
  name?: string;
}) {
  const three = [parts.firstName, parts.secondName, parts.thirdName]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (three) return three;
  const two = [parts.firstName, parts.lastName].filter(Boolean).join(" ").trim();
  return two || parts.name || "";
}

export function businessPermanenceLabel(value?: BusinessPermanence) {
  if (value === "permanent") return "Permanent";
  if (value === "semi") return "Semi-permanent";
  return "";
}

export function memberNeedsSticker(member: Pick<Member, "businessPermanence" | "fees">) {
  if (member.businessPermanence) return member.businessPermanence === "permanent";
  return !!member.fees.hasShop;
}

export type Appraisal = {
  id: string;
  memberId: string;
  loanId?: string;
  date: string;
  officerId: string;
  goodDay: number;
  averageDay: number;
  badDay: number;
  operatingExpenses: number;
  nonEarningDays: number;
  existingDebt: number;
  monthlyDebtRepayment: number;
  crbStatus: "Positive" | "Negative" | "Unknown" | "No Record";
  reschedulesLast12: number;
  dti: number;
  dicr: number;
  bdsr: number;
  lsr: number;
  savingsBuffer: number;
  scoreDICR: number;
  scoreBDSR: number;
  scoreSavings: number;
  scoreCRB: number;
  scoreBurden: number;
  scoreDocs: number;
  scoreCoop: number;
  totalScore: number;
  decision: "Approve" | "Approve with Adjustments" | "Refer / Downsize" | "Reject";
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "VERY HIGH";
  approvedAmount: number;
  approvedTerm: string;
  specialConditions: string;
  notes: string;
};

export type FieldVisit = {
  id: string;
  memberId: string;
  date: string;
  type: "business" | "home" | "live";
  lat?: number;
  lng?: number;
  locationNotes: string;
  photos?: string[];
  photoLabels?: string[];
  by: string;
};

export type FollowupNote = {
  id: string;
  loanId: string;
  memberId: string;
  date: string;
  note: string;
  outcome: "promised" | "paid" | "no-show" | "dispute" | "other";
  by: string;
};

export type Penalty = {
  id: string;
  memberId: string;
  loanId?: string;
  date: string;
  amount: number;
  reason: string;
  status: "outstanding" | "paid" | "waived";
  paidFrom?: "round_off_pool" | "direct" | "mpesa" | "waiver";
};

export type RoundOffEntry = {
  id: string;
  memberId: string;
  date: string;
  amount: number;
  source: "loan_repayment" | "savings_deposit" | "share_purchase" | "manual";
  ref?: string;
};

export type MpesaAllocation = {
  matched: boolean;
  memberId?: string;
  account: string;
  transactionId?: string;
  primary?: { type: Transaction["type"]; amount: number; loanId?: string; note?: string };
  toRoundOff?: number;
  penaltiesCleared?: { id: string; amount: number }[];
  notes: string[];
};

const SHARE_PRICE = 100;
export const STANDARD_LOAN_TERMS: LoanTermDays[] = [7, 14, 30];
export const PREMIUM_LOAN_TERMS: LoanTermDays[] = [14, 30, 60, 90];
export const SBC_LOAN_TERMS: LoanTermDays[] = [7, 14, 30, 60, 90];

/**
 * SBC mandatory thresholds before extra savings can spill into the purpose pool.
 * Sourced from SBC policy upfront table — minimum 1,000/= savings to even apply.
 */
export const MANDATORY_SAVINGS_THRESHOLD =
  DEFAULT_POLICY_SETTINGS.percentages.mandatorySavingsThreshold;
export const MANDATORY_SHARES_THRESHOLD =
  DEFAULT_POLICY_SETTINGS.percentages.mandatorySharesThreshold;
export const ROUNDING_BASE = 1; // always round UP to next whole shilling — the surplus
// added to the round-off pool is therefore always positive (≥0).

/**
 * Seed data has been cleared. The system bootstraps with a single director
 * account (so the login screen has at least one valid staff). Everything
 * else — members, loans, transactions, petty cash, investors, attendance,
 * penalties, round-off — starts empty and is built up by real activity.
 */
const seedStaff: Staff[] = [
  {
    id: "S1",
    name: "System Admin",
    role: "director",
    canMarkAttendance: true,
  },
];

export const DEFAULT_FEES: MandatoryFees = {
  membership: false,
  card: false,
  hasShop: false,
  sticker: false,
  firstUpfrontPaid: false,
};

const seedMembers: Member[] = [];
const seedLoans: Loan[] = [];
const seedTx: Transaction[] = [];
const seedPenalties: Penalty[] = [];
const seedRoundOff: RoundOffEntry[] = [];
const seedPetty: PettyCashEntry[] = [];
const seedInvestors: Investor[] = [];
const seedAttendance: Attendance[] = [];

export type { MemberCategory } from "@/lib/membership";
export {
  formatMembershipNumber,
  isInvestorCategory,
  isMemberCategory,
  isInvestorOnlyCategory,
  isSpecialMemberCategory,
  nextMembershipNumber,
  membershipSequenceValue,
  memberCategoryLabel,
  normalizeMembershipNumber,
  resolveMemberCategory,
} from "@/lib/membership";

type Store = {
  isAuthenticated: boolean;
  isHydrated: boolean;
  authMode: "staff" | "member";
  portalMemberId: string;
  setPortalMemberId: (next: string) => void;
  setAuthenticated: (next: boolean) => void;
  currentUser: Staff;
  setCurrentUser: (s: Staff) => void;
  staff: Staff[];
  members: Member[];
  loans: Loan[];
  transactions: Transaction[];
  pettyCash: PettyCashEntry[];
  investors: Investor[];
  attendance: Attendance[];
  appraisals: Appraisal[];
  fieldVisits: FieldVisit[];
  followups: FollowupNote[];
  penalties: Penalty[];
  roundOff: RoundOffEntry[];
  staffMessages: StaffMessage[];
  feePolicies: FeePolicy[];
  policySettings: PolicySettings;
  sharePrice: number;
  /** Member/supplier auth — membership No. + phone number. Returns the matched member and portal. */
  loginMember: (
    memberNo: string,
    phone: string,
  ) => Promise<{ member: Member | null; portal: "member" | "supplier" }>;
  /** Staff auth — email + temp password. */
  loginStaff: (email: string, password: string) => Promise<Staff | null>;
  /** Logout — clears the server session and resets local state. */
  logout: () => Promise<void>;
  addMember: (
    m: Omit<Member, "id" | "fees" | "isInvestor" | "investorId"> & {
      memberId?: string;
      fees?: MandatoryFees;
      investorContribution?: number;
      investorNotes?: string;
    },
  ) => Promise<string>;
  updateMember: (m: {
    memberId: string;
    nextMemberId?: string;
    name: string;
    phone: string;
    status: "active" | "dormant";
    shares: number;
    savingsBalance: number;
    category: MemberCategory;
    firstName?: string;
    secondName?: string;
    thirdName?: string;
    dob?: string;
    gender?: "Male" | "Female";
    email?: string;
    address?: string;
    city?: string;
    county?: string;
    village?: string;
    oldSystemId?: string;
    businessName?: string;
    businessType?: string;
    businessPermanence?: BusinessPermanence;
    businessAddress?: string;
    fieldOfficerId?: string;
  }) => Promise<string>;
  addStaff: (s: Omit<Staff, "id">) => Promise<string>;
  updateStaff: (id: string, patch: Partial<Staff>) => Promise<void>;
  removeStaff: (id: string) => Promise<void>;
  addLoan: (
    l: Omit<Loan, "id" | "paid" | "status"> & { status?: Loan["status"] },
  ) => Promise<string>;
  approveLoan: (loanId: string, approvedAmount: number, by: string, note?: string) => Promise<void>;
  rejectLoan: (loanId: string, by: string, note?: string) => Promise<void>;
  recordTransaction: (
    t: Omit<Transaction, "id" | "date"> & { date?: string; allowOverdraw?: boolean },
  ) => Promise<string>;
  addPetty: (p: Omit<PettyCashEntry, "id" | "date"> & { date?: string }) => Promise<string>;
  addAppraisal: (a: Omit<Appraisal, "id" | "date">) => Promise<string>;
  addInvestor: (i: Omit<Investor, "id" | "joinedAt"> & { joinedAt?: string }) => Promise<string>;
  addFieldVisit: (v: Omit<FieldVisit, "id" | "date"> & { date?: string }) => Promise<string>;
  addFollowup: (n: Omit<FollowupNote, "id" | "date"> & { date?: string }) => Promise<string>;
  addStaffMessage: (m: {
    senderId: string;
    receiverId: string;
    senderName: string;
    content?: string;
    attachment?: StaffMessageAttachment;
  }) => Promise<string>;
  reloadStaffMessages: () => Promise<void>;
  /** Mark another staff present/absent (caller must be director or canMarkAttendance). */
  markAttendance: (
    staffId: string,
    status: Attendance["status"],
    when?: "in" | "out",
  ) => Promise<void>;
  memberLoanCount: (memberId: string) => number;
  roundOffBalance: (memberId: string) => number;
  settlePenaltyFromPool: (penaltyId: string) => Promise<boolean>;
  resolveMpesaAccount: (account: string) => Member | undefined;
  applyMpesaPayment: (
    account: string,
    amount: number,
    payerName?: string,
    mpesaRef?: string,
    eventId?: string,
  ) => Promise<MpesaAllocation>;
  reloadAppData: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const load = useServerFn(loadAppData);
  const loadIfChanged = useServerFn(loadAppDataIfChanged);
  const loadStaffMessages = useServerFn(listStaffMessages);
  const authenticateMember = useServerFn(signInMember);
  const authenticateStaff = useServerFn(signInStaff);
  const signOut = useServerFn(signOutSession);
  const applyMpesaPaymentServer = useServerFn(applyMpesaPaymentRecord);
  const createAppraisal = useServerFn(createAppraisalRecord);
  const createMember = useServerFn(createMemberRecord);
  const createFollowup = useServerFn(createFollowupRecord);
  const createFieldVisit = useServerFn(createFieldVisitRecord);
  const createInvestor = useServerFn(createInvestorRecord);
  const createLoan = useServerFn(createLoanRecord);
  const createPetty = useServerFn(createPettyCashRecord);
  const createStaffMessage = useServerFn(createStaffMessageRecord);
  const createStaff = useServerFn(createStaffRecord);
  const createTransaction = useServerFn(createTransactionRecord);
  const saveStaff = useServerFn(updateStaffRecord);
  const deleteStaff = useServerFn(deleteStaffRecord);
  const reviewLoan = useServerFn(reviewLoanRecord);
  const saveAttendance = useServerFn(upsertAttendanceRecord);
  const settlePenaltyFromPoolServer = useServerFn(settlePenaltyFromPoolRecord);
  const [isHydrated, setIsHydrated] = useState(false);
  const [staff, setStaff] = useState<Staff[]>(seedStaff);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentUser, setCurrentUserState] = useState<Staff>(seedStaff[0]);
  const [members, setMembers] = useState<Member[]>(seedMembers);
  const [authMode, setAuthMode] = useState<"staff" | "member">("staff");
  const [portalMemberId, setPortalMemberIdState] = useState<string>("");
  const [loans, setLoans] = useState<Loan[]>(seedLoans);
  const [transactions, setTransactions] = useState<Transaction[]>(seedTx);
  const [pettyCash, setPettyCash] = useState<PettyCashEntry[]>(seedPetty);
  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [investors, setInvestors] = useState<Investor[]>(seedInvestors);
  const [fieldVisits, setFieldVisits] = useState<FieldVisit[]>([]);
  const [followups, setFollowups] = useState<FollowupNote[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>(seedPenalties);
  const [roundOff, setRoundOff] = useState<RoundOffEntry[]>(seedRoundOff);
  const [staffMessages, setStaffMessages] = useState<StaffMessage[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>(seedAttendance);
  const [feePolicies, setFeePolicies] = useState<FeePolicy[]>(normalizeFeePolicies([]));
  const [policySettings, setPolicySettingsState] =
    useState<PolicySettings>(DEFAULT_POLICY_SETTINGS);
  const dataVersionRef = useRef("");
  const fullRefreshRef = useRef<Promise<any> | null>(null);
  const changeRefreshRef = useRef<Promise<any> | null>(null);
  const refreshGenerationRef = useRef(0);

  function applyDatabaseState(data: any) {
    dataVersionRef.current = data.dataVersion ?? dataVersionRef.current;
    setIsAuthenticated(!!data.isAuthenticated);
    setAuthMode(data.authMode ?? "staff");
    setPortalMemberIdState(data.portalMemberId ?? "");
    if (data.currentUser) {
      setCurrentUserState(data.currentUser);
    } else if (!data.isAuthenticated || data.authMode !== "staff") {
      setCurrentUserState(seedStaff[0]);
    }
    setStaff(data.staff);
    setMembers(data.members);
    setLoans(data.loans);
    setTransactions(data.transactions);
    setPettyCash(data.pettyCash);
    setInvestors(data.investors);
    setAttendance(data.attendance);
    setAppraisals(data.appraisals);
    setFieldVisits(data.fieldVisits);
    setFollowups(data.followups);
    setPenalties(data.penalties);
    setRoundOff(data.roundOff);
    setStaffMessages(data.staffMessages ?? []);
    setFeePolicies(normalizeFeePolicies(data.feePolicies ?? []));
    setPolicySettingsState(data.policySettings ?? DEFAULT_POLICY_SETTINGS);
    setActivePolicySettings(data.policySettings ?? DEFAULT_POLICY_SETTINGS);
  }

  async function refreshFromDatabase(options?: { force?: boolean }) {
    if (fullRefreshRef.current && !options?.force) return fullRefreshRef.current;
    const generation = options?.force
      ? ++refreshGenerationRef.current
      : refreshGenerationRef.current;
    fullRefreshRef.current = (async () => {
      try {
        const data = await load();
        if (generation === refreshGenerationRef.current) {
          applyDatabaseState(data);
        }
        return data;
      } finally {
        setIsHydrated(true);
        if (generation === refreshGenerationRef.current) {
          fullRefreshRef.current = null;
        }
      }
    })();
    return fullRefreshRef.current;
  }

  async function refreshIfDatabaseChanged() {
    if (fullRefreshRef.current) return fullRefreshRef.current;
    if (changeRefreshRef.current) return changeRefreshRef.current;
    changeRefreshRef.current = (async () => {
      try {
        const result = await loadIfChanged({
          data: { knownVersion: dataVersionRef.current },
        });
        if (result.changed && result.data) {
          applyDatabaseState(result.data);
        } else if (result.version) {
          dataVersionRef.current = result.version;
        }
        return result;
      } finally {
        setIsHydrated(true);
        changeRefreshRef.current = null;
      }
    })();
    return changeRefreshRef.current;
  }

  function refreshInBackground(fallbackMessage: string, full = false) {
    const task = full ? refreshFromDatabase({ force: true }) : refreshIfDatabaseChanged();
    void task.catch((error: any) => {
      toast.error(error?.message ?? fallbackMessage);
    });
  }

  async function refreshAfterAuth() {
    const refresh = refreshFromDatabase({ force: true });
    const timeout = new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), 5000);
    });
    return Promise.race([refresh, timeout]);
  }

  useEffect(() => {
    let active = true;
    const hydrationGuard = window.setTimeout(() => {
      if (active) setIsHydrated(true);
    }, 1500);

    refreshFromDatabase()
      .catch((error: any) => {
        toast.error(error?.message ?? "Failed to load database state.");
      })
      .finally(() => {
        window.clearTimeout(hydrationGuard);
      });

    return () => {
      active = false;
      window.clearTimeout(hydrationGuard);
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const syncIfVisible = () => {
      if (!document.hidden) refreshInBackground("Auto-sync failed.");
    };
    const interval = window.setInterval(syncIfVisible, authMode === "staff" ? 15000 : 30000);
    window.addEventListener("focus", syncIfVisible);
    document.addEventListener("visibilitychange", syncIfVisible);
    window.addEventListener("sauti:data-changed", syncIfVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", syncIfVisible);
      document.removeEventListener("visibilitychange", syncIfVisible);
      window.removeEventListener("sauti:data-changed", syncIfVisible);
    };
  }, [authMode, isAuthenticated]);

  useEffect(() => {
    if (!staff.length || authMode !== "staff") return;
    setCurrentUserState((prev) => {
      return staff.find((member) => member.id === prev.id) ?? staff[0];
    });
  }, [authMode, staff]);

  useEffect(() => {
    setActivePolicySettings(policySettings);
  }, [policySettings]);

  const setAuthenticated = (next: boolean) => {
    setIsAuthenticated(next);
  };

  const setCurrentUser = (next: Staff) => {
    setCurrentUserState(next);
  };

  const setPortalMemberId = (next: string) => {
    setPortalMemberIdState(next);
  };

  const value = useMemo<Store>(
    () => ({
      isAuthenticated,
      isHydrated,
      authMode,
      portalMemberId,
      setPortalMemberId,
      setAuthenticated,
      currentUser,
      setCurrentUser,
      staff,
      members,
      loans,
      transactions,
      pettyCash,
      investors,
      attendance,
      appraisals,
      fieldVisits,
      followups,
      sharePrice: SHARE_PRICE,
      penalties,
      roundOff,
      staffMessages,
      feePolicies,
      policySettings,
      addMember: async (m) => {
        const result = await createMember({
          data: {
            memberId: (m as any).memberId,
            name: m.name,
            phone: m.phone,
            joinedAt: m.joinedAt,
            status: m.status,
            shares: m.shares,
            savingsBalance: m.savingsBalance,
            firstName: m.firstName,
            secondName: m.secondName,
            thirdName: m.thirdName,
            dob: m.dob,
            gender: m.gender,
            email: m.email,
            address: m.address,
            city: m.city,
            county: m.county,
            village: m.village,
            oldSystemId: m.oldSystemId,
            businessName: m.businessName,
            businessType: m.businessType,
            businessPermanence: m.businessPermanence,
            businessAddress: m.businessAddress,
            fieldOfficerId: m.fieldOfficerId || currentUser.id,
            category: m.category,
            investorContribution: (m as any).investorContribution,
            investorNotes: (m as any).investorNotes,
          },
        });
        await refreshFromDatabase();
        return result.id;
      },
      updateMember: async (m) => {
        const result = await updateMemberRecord({
          data: {
            memberId: m.memberId,
            nextMemberId: m.nextMemberId,
            name: m.name,
            phone: m.phone,
            status: m.status,
            shares: m.shares,
            savingsBalance: m.savingsBalance,
            firstName: m.firstName,
            secondName: m.secondName,
            thirdName: m.thirdName,
            dob: m.dob,
            gender: m.gender,
            email: m.email,
            address: m.address,
            city: m.city,
            county: m.county,
            village: m.village,
            oldSystemId: m.oldSystemId,
            businessName: m.businessName,
            businessType: m.businessType,
            businessPermanence: m.businessPermanence,
            businessAddress: m.businessAddress,
            fieldOfficerId: m.fieldOfficerId,
            category: m.category,
          },
        });
        await refreshFromDatabase();
        return result.id;
      },
      addLoan: async (l) => {
        const status = l.status ?? "pending";
        const termDays = normalizeLoanTermDays(l.termDays ?? (l.termMonths || 1) * 30);
        const termMonths = termPeriodsFromDays(termDays);
        const rate = l.rate > 0 ? l.rate : loanRateForTerm(termDays);
        const result = await createLoan({
          data: {
            memberId: l.memberId,
            principal: l.principal,
            approvedAmount: l.approvedAmount,
            financedPrincipalAmount: l.financedPrincipalAmount,
            netDisbursedAmount: l.netDisbursedAmount,
            processingFeeAmount: l.processingFeeAmount,
            insuranceFeeAmount: l.insuranceFeeAmount,
            transactionFeeAmount: l.transactionFeeAmount,
            processingFeeMode: l.processingFeeMode,
            insuranceFeeMode: l.insuranceFeeMode,
            disbursementStatus: l.disbursementStatus,
            rate,
            termDays,
            termMonths,
            startDate: l.startDate,
            status,
            officerId: l.officerId,
            purpose: l.purpose,
            loanKind: l.loanKind,
            supplierPayload: l.supplierPayload,
          },
        });
        await refreshFromDatabase();
        return result.id;
      },
      approveLoan: async (loanId, approvedAmount, by, note) => {
        await reviewLoan({
          data: {
            loanId,
            decision: "approved",
            approvedAmount,
            reviewedBy: by,
            note,
          },
        });
        await refreshFromDatabase();
      },
      rejectLoan: async (loanId, by, note) => {
        await reviewLoan({
          data: {
            loanId,
            decision: "rejected",
            reviewedBy: by,
            note,
          },
        });
        await refreshFromDatabase();
      },
      recordTransaction: async (t) => {
        const result = await createTransaction({
          data: {
            date: t.date,
            type: t.type,
            account: t.account,
            payerName: t.payerName,
            amount: t.amount,
            memberId: t.memberId,
            loanId: t.loanId,
            ref: t.ref,
            by: t.by,
            note: t.note,
            allowOverdraw: t.allowOverdraw,
          },
        });
        await refreshFromDatabase();
        return result.id;
      },
      addPetty: async (p) => {
        const result = await createPetty({
          data: {
            date: p.date,
            description: p.description,
            amount: p.amount,
            category: p.category,
            by: p.by,
            time: p.time,
            type: p.type,
            payee: p.payee,
            contact: p.contact,
            mode: p.mode,
            reference: p.reference,
            txnCost: p.txnCost,
            openingBalance: p.openingBalance,
          },
        });
        await refreshFromDatabase();
        return result.id;
      },
      addAppraisal: async (a) => {
        const result = await createAppraisal({ data: a as any });
        await refreshFromDatabase();
        return result.id;
      },
      addInvestor: async (i) => {
        const result = await createInvestor({
          data: {
            name: i.name,
            contributed: i.contributed,
            sharePct: i.sharePct,
            joinedAt: i.joinedAt,
            phone: i.phone,
            notes: i.notes,
            memberId: i.memberId,
            byStaff: currentUser.id,
          },
        });
        await refreshFromDatabase();
        return result.id;
      },
      addFieldVisit: async (visit) => {
        const result = await createFieldVisit({
          data: {
            memberId: visit.memberId,
            type: visit.type,
            locationNotes: visit.locationNotes,
            lat: visit.lat,
            lng: visit.lng,
            photos: visit.photos,
            byStaff: visit.by,
            date: visit.date,
          },
        });
        if (result.visit) {
          setFieldVisits((current) => [
            result.visit,
            ...current.filter((existingVisit) => existingVisit.id !== result.visit.id),
          ]);
        }
        refreshInBackground("Saved the field visit, but background sync failed.");
        return result.id;
      },
      addFollowup: async (n) => {
        const result = await createFollowup({
          data: {
            loanId: n.loanId,
            memberId: n.memberId,
            date: n.date,
            note: n.note,
            outcome: n.outcome,
            by: n.by,
          },
        });
        if (result.followup) {
          setFollowups((current) => [
            result.followup,
            ...current.filter((existingFollowup) => existingFollowup.id !== result.followup.id),
          ]);
        }
        refreshInBackground("Saved the follow-up, but background sync failed.");
        return result.id;
      },
      addStaffMessage: async (message) => {
        const result = await createStaffMessage({
          data: {
            senderId: message.senderId,
            receiverId: message.receiverId,
            senderName: message.senderName,
            content: message.content,
            attachment: message.attachment,
          },
        });
        setStaffMessages(await loadStaffMessages());
        return result.id;
      },
      reloadStaffMessages: async () => {
        setStaffMessages(await loadStaffMessages());
      },
      loginMember: async (memberNo, phone) => {
        const result = await authenticateMember({
          data: { memberNo, phone },
        });
        setIsAuthenticated(true);
        setAuthMode("member");
        setPortalMemberIdState(result.member.id);
        const data = await refreshAfterAuth();
        if (!data) {
          refreshInBackground("Signed in, but the first data sync is still running.", true);
        }
        return {
          member:
            data?.members.find((member) => member.id === result.member.id) ??
            ({
              id: result.member.id,
              name: result.member.name,
              phone: "",
              joinedAt: new Date().toISOString().slice(0, 10),
              status: "active",
              shares: 0,
              savingsBalance: 0,
              fees: DEFAULT_FEES,
              category: "member",
            } satisfies Member),
          portal: result.portal === "supplier" ? "supplier" : "member",
        };
      },
      loginStaff: async (email, password) => {
        const result = await authenticateStaff({
          data: { email, password },
        });
        const signedInStaff = {
          id: result.user.id,
          name: result.user.name,
          role: result.user.role,
          canMarkAttendance: result.user.role === "director",
        } satisfies Staff;
        setIsAuthenticated(true);
        setAuthMode("staff");
        setCurrentUserState(signedInStaff);
        const data = await refreshAfterAuth();
        if (!data) {
          refreshInBackground("Signed in, but the first data sync is still running.", true);
        }
        return data?.staff.find((member) => member.id === result.user.id) ?? signedInStaff;
      },
      logout: async () => {
        await signOut();
        await refreshFromDatabase();
        setAuthMode("staff");
        setPortalMemberId("");
        setAuthenticated(false);
        setCurrentUserState(seedStaff[0]);
      },
      addStaff: async (s) => {
        const result = await createStaff({
          data: {
            name: s.name,
            role: s.role,
            firstName: s.firstName,
            secondName: s.secondName,
            thirdName: s.thirdName,
            email: s.email,
            phone: s.phone,
            nationalId: s.nationalId,
            address: s.address,
            notes: s.notes,
            photo: s.photo,
            tempPassword: s.tempPassword,
            canMarkAttendance: s.canMarkAttendance,
            fingerprintEnrolled: s.fingerprintEnrolled,
          },
        });
        await refreshFromDatabase();
        return result.id;
      },
      updateStaff: async (id, patch) => {
        await saveStaff({
          data: {
            id,
            patch: {
              name: patch.name,
              role: patch.role,
              firstName: patch.firstName,
              secondName: patch.secondName,
              thirdName: patch.thirdName,
              email: patch.email,
              phone: patch.phone,
              nationalId: patch.nationalId,
              address: patch.address,
              notes: patch.notes,
              photo: patch.photo,
              tempPassword: patch.tempPassword,
              canMarkAttendance: patch.canMarkAttendance,
              fingerprintEnrolled: patch.fingerprintEnrolled,
            },
          },
        });
        await refreshFromDatabase();
      },
      removeStaff: async (id) => {
        await deleteStaff({ data: { id } });
        await refreshFromDatabase();
      },
      markAttendance: async (staffId, status, when = "in") => {
        await saveAttendance({
          data: {
            staffId,
            status:
              status === "late"
                ? "present"
                : (status as "present" | "signed_out" | "permission" | "absent"),
            when,
          },
        });
        await refreshFromDatabase();
      },
      memberLoanCount: (memberId: string) =>
        loans.filter((l) => l.memberId === memberId && l.status !== "rejected").length,
      roundOffBalance: (memberId: string) => {
        const credits = roundOff
          .filter((r) => r.memberId === memberId)
          .reduce((s, r) => s + r.amount, 0);
        const debits = penalties
          .filter(
            (p) =>
              p.memberId === memberId && p.status === "paid" && p.paidFrom === "round_off_pool",
          )
          .reduce((s, p) => s + p.amount, 0);
        return Math.max(0, credits - debits);
      },
      settlePenaltyFromPool: async (penaltyId: string) => {
        const result = await settlePenaltyFromPoolServer({
          data: { penaltyId },
        });
        if (result.ok) await refreshFromDatabase();
        return result.ok;
      },
      resolveMpesaAccount: (account: string) => {
        const candidates = membershipIdCandidates(account);
        return candidates
          .map((candidate) => members.find((mb) => mb.id === candidate))
          .find(Boolean);
      },
      applyMpesaPayment: async (account, amount, payerName, mpesaRef, eventId) => {
        const result = await applyMpesaPaymentServer({
          data: {
            eventId,
            account,
            amount,
            payerName,
            mpesaRef,
          },
        });
        await refreshFromDatabase();
        return result as MpesaAllocation;
      },
      reloadAppData: async () => {
        await refreshFromDatabase();
      },
    }),
    [
      isAuthenticated,
      isHydrated,
      authMode,
      portalMemberId,
      currentUser,
      staff,
      members,
      loans,
      transactions,
      pettyCash,
      appraisals,
      investors,
      fieldVisits,
      followups,
      penalties,
      roundOff,
      attendance,
      staffMessages,
      feePolicies,
      policySettings,
      applyMpesaPaymentServer,
      createAppraisal,
      createFieldVisit,
      createFollowup,
      createInvestor,
      createLoan,
      createMember,
      createPetty,
      createStaff,
      createStaffMessage,
      createTransaction,
      deleteStaff,
      load,
      reviewLoan,
      saveAttendance,
      saveStaff,
      signOut,
      settlePenaltyFromPoolServer,
      authenticateMember,
      authenticateStaff,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used within StoreProvider");
  return v;
}

export const fmtKES = (n: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);

/** Round any KES amount UP to the nearest `step` (default 5/=). */
export function roundUpKES(amount: number, step: number = ROUNDING_BASE) {
  if (amount <= 0) return 0;
  const configuredStep =
    Number.isFinite(step) && step > 0
      ? step
      : getActivePolicySettings().percentages.roundOffStep || ROUNDING_BASE;
  return Math.ceil(amount / configuredStep) * configuredStep;
}

export function normalizeLoanTermDays(termDays?: number): LoanTermDays {
  return normalizePolicyTermDays(termDays);
}

export function normalizeLoanTermDaysForType(termDays?: number, loanType?: LoanProductType) {
  return normalizePolicyTermDays(termDays, loanType);
}

export function termPeriodsFromDays(termDays?: number, loanType?: LoanProductType) {
  return Math.max(1, Math.ceil(normalizeLoanTermDaysForType(termDays, loanType) / 30));
}

export function loanProductTypeForAmount(amount: number): LoanProductType {
  return Number(amount ?? 0) > 5000 ? "premium" : "standard";
}

export function loanRateForTerm(termDays?: number, loanType?: LoanProductType, amount?: number) {
  const resolvedLoanType = loanType ?? loanProductTypeForAmount(Number(amount ?? 0));
  return policyInterestRateForTerm(termDays, resolvedLoanType, getActivePolicySettings());
}

export function loanTermDaysOf(loan: Pick<Loan, "termDays" | "termMonths">) {
  if (loan.termDays) return normalizeLoanTermDays(loan.termDays);
  return normalizeLoanTermDays((loan.termMonths || 1) * 30);
}

export function loanScheduleTotal(principal: number, monthlyRatePct: number, months: number) {
  const periods = Number.isFinite(months) && months > 0 ? months : 1;
  const interest = principal * (monthlyRatePct / 100) * periods;
  const total = principal + interest;
  return { interest, total, monthly: total / periods };
}

export function shareValueForUnits(units: number) {
  return Number(units ?? 0) * SHARE_PRICE;
}

export function summarizeLoanFixedFees(options?: LoanFixedFeeModes) {
  const membershipFeeAmount = Math.max(0, Number(options?.membershipFeeAmount ?? 0));
  const cardFeeAmount = Math.max(0, Number(options?.cardFeeAmount ?? 0));
  const stickerFeeAmount = Math.max(0, Number(options?.stickerFeeAmount ?? 0));
  const membershipFeeMode = options?.membershipFeeMode === "financed" ? "financed" : "upfront";
  const cardFeeMode = options?.cardFeeMode === "financed" ? "financed" : "upfront";
  const stickerFeeMode = options?.stickerFeeMode === "financed" ? "financed" : "upfront";

  const rows = [
    {
      key: "membership",
      label: "Registration fee",
      amount: membershipFeeAmount,
      mode: membershipFeeMode,
    },
    {
      key: "card",
      label: "Membership card",
      amount: cardFeeAmount,
      mode: cardFeeMode,
    },
    {
      key: "sticker",
      label: "Sticker fee",
      amount: stickerFeeAmount,
      mode: stickerFeeMode,
    },
  ] as const;

  return {
    rows,
    membershipFee: rows[0],
    cardFee: rows[1],
    stickerFee: rows[2],
    totalUpfront: rows.reduce((sum, row) => sum + (row.mode === "upfront" ? row.amount : 0), 0),
    totalFinanced: rows.reduce((sum, row) => sum + (row.mode === "financed" ? row.amount : 0), 0),
  };
}

export function loanDailySavingsAmount(approvedAmount: number) {
  return Number(approvedAmount ?? 0) <= 5000 ? 50 : 100;
}

export function transactionFeeAmountForLoan(amount: number) {
  const fixedFee = transactionFeeForAmount(amount, getActivePolicySettings());
  if (fixedFee > 0) return fixedFee;
  return amount * (SBC_FEES.transactionCostPct / 100);
}

export function loanPricingPreview(args: {
  netAmount: number;
  termDays?: number;
  ratePct?: number;
  loanType?: LoanProductType;
  loanKind?: LoanKind;
  processingFeeMode?: LoanChargeMode;
  insuranceFeeMode?: LoanChargeMode;
  dailySavingsAmount?: number;
  fixedFees?: LoanFixedFeeModes;
}) {
  const netAmount = Math.max(0, Number(args.netAmount ?? 0));
  const supplierBacked =
    args.loanKind === "fuel" || args.loanKind === "stock" || args.loanKind === "service";
  const resolvedLoanType = args.loanType ?? loanProductTypeForAmount(netAmount);
  const termDays = normalizeLoanTermDaysForType(args.termDays, resolvedLoanType);
  const ratePct = supplierBacked
    ? 0
    : Number(args.ratePct ?? loanRateForTerm(termDays, resolvedLoanType, netAmount));
  const deductions = supplierBacked
    ? {
        processing: 0,
        insurance: 0,
        transactionCost: 0,
        processingUpfront: 0,
        insuranceUpfront: 0,
        financedProcessing: 0,
        financedInsurance: 0,
        totalUpfrontCharges: 0,
        totalFinancedCharges: 0,
        financedPrincipal: netAmount,
        netDisbursedAmount: netAmount,
        total: 0,
      }
    : sbcDeductions(netAmount, {
        processingMode: args.processingFeeMode,
        insuranceMode: args.insuranceFeeMode,
      });
  const fixedFees = summarizeLoanFixedFees(supplierBacked ? undefined : args.fixedFees);
  const financedPrincipal = deductions.financedPrincipal + fixedFees.totalFinanced;
  const periods = termPeriodsFromDays(termDays, resolvedLoanType);
  const schedule = loanScheduleTotal(financedPrincipal, ratePct, periods);
  const dailySavingsAmount = Math.max(
    0,
    Number(args.dailySavingsAmount ?? loanDailySavingsAmount(netAmount)),
  );
  const rawDailyInclusive =
    (schedule.total + dailySavingsAmount * termDays) / Math.max(1, termDays);
  const dailyInclusive = roundUpKES(rawDailyInclusive, 5);

  return {
    ratePct,
    termDays,
    loanType: resolvedLoanType,
    periods,
    deductions,
    netAmount,
    netDisbursedAmount: netAmount,
    financedPrincipal,
    interest: schedule.interest,
    totalRepayment: schedule.total,
    dailySavingsAmount,
    dailyLoanInstallment: schedule.total / Math.max(1, termDays),
    dailyInclusive,
    roundOff: Math.max(0, dailyInclusive - rawDailyInclusive),
    totalSavingsAccrued: dailySavingsAmount * termDays,
    grandTotalCollected: dailyInclusive * termDays,
    fixedFees,
    totalUpfrontCharges: deductions.totalUpfrontCharges + fixedFees.totalUpfront,
    totalFinancedCharges: deductions.totalFinancedCharges + fixedFees.totalFinanced,
  };
}

export function loanSummary(
  loan: Pick<
    Loan,
    | "principal"
    | "approvedAmount"
    | "financedPrincipalAmount"
    | "rate"
    | "termDays"
    | "termMonths"
    | "paid"
    | "startDate"
    | "status"
  >,
) {
  const approved = loan.approvedAmount ?? loan.principal;
  const termDays = loanTermDaysOf(loan);
  const periods = loan.termMonths > 0 ? loan.termMonths : termPeriodsFromDays(termDays);
  const financedPrincipal = loan.financedPrincipalAmount ?? approved;
  const schedule = loanScheduleTotal(financedPrincipal, loan.rate, periods);
  const balance = Math.max(0, schedule.total - loan.paid);
  const dailySavingsAmount = loanDailySavingsAmount(approved);
  const dueDate = new Date(loan.startDate);
  dueDate.setDate(dueDate.getDate() + termDays);
  return {
    approved,
    financedPrincipal,
    termDays,
    periods,
    interest: schedule.interest,
    total: schedule.total,
    balance,
    dueDate: dueDate.toISOString().slice(0, 10),
    dailyInstallment: schedule.total / termDays,
    dailySavingsAmount,
    dailyCollectionAmount: roundUpKES(
      (schedule.total + dailySavingsAmount * termDays) / termDays,
      5,
    ),
    isSettled: balance <= 0,
    isOverdue: loan.status === "active" && balance > 0 && dueDate.getTime() < Date.now(),
  };
}

export const SBC_FEES = {
  get processingPct() {
    return getActivePolicySettings().percentages.processingPct;
  },
  get insurancePct() {
    return getActivePolicySettings().percentages.insurancePct;
  },
  get transactionCostPct() {
    return getActivePolicySettings().percentages.transactionCostPct;
  },
  get penaltyDailyPct() {
    return getActivePolicySettings().percentages.penaltyDailyPct;
  },
  get defaultPenaltyPct() {
    return getActivePolicySettings().percentages.defaultPenaltyPct;
  },
  get firstUpfrontAmount() {
    return getActivePolicySettings().percentages.firstUpfrontAmount;
  },
};

export function sbcDeductions(
  netDisbursedAmount: number,
  options?: {
    processingMode?: LoanChargeMode;
    insuranceMode?: LoanChargeMode;
    transactionFeeAmount?: number;
  },
) {
  const processing = netDisbursedAmount * (SBC_FEES.processingPct / 100);
  const insurance = netDisbursedAmount * (SBC_FEES.insurancePct / 100);
  const transactionCost = Math.max(
    0,
    Number(options?.transactionFeeAmount ?? transactionFeeAmountForLoan(netDisbursedAmount)),
  );
  const processingMode = options?.processingMode ?? "financed";
  const insuranceMode = options?.insuranceMode ?? "financed";
  const processingUpfront = processingMode === "upfront" ? processing : 0;
  const insuranceUpfront = insuranceMode === "upfront" ? insurance : 0;
  const financedProcessing = processing - processingUpfront;
  const financedInsurance = insurance - insuranceUpfront;
  return {
    processing,
    insurance,
    transactionCost,
    processingUpfront,
    insuranceUpfront,
    financedProcessing,
    financedInsurance,
    totalUpfrontCharges: processingUpfront + insuranceUpfront,
    totalFinancedCharges: financedProcessing + financedInsurance + transactionCost,
    financedPrincipal:
      Math.max(0, Number(netDisbursedAmount ?? 0)) +
      financedProcessing +
      financedInsurance +
      transactionCost,
    netDisbursedAmount: Math.max(0, Number(netDisbursedAmount ?? 0)),
    total: processing + insurance + transactionCost,
  };
}

export type SbcUpfrontTier = {
  range: string;
  min: number;
  max: number;
  minShares: number;
  sharesPct: number;
  minSavings: number;
  savingsPct: number;
  notes: string;
};

export const SBC_UPFRONT_TABLE: SbcUpfrontTier[] = [
  {
    range: "5,000 – 10,000",
    min: 5000,
    max: 10000,
    minShares: 900,
    sharesPct: 30,
    minSavings: 1000,
    savingsPct: 20,
    notes: "Minimum upfront",
  },
  {
    range: "10,001 – 20,000",
    min: 10001,
    max: 20000,
    minShares: 1500,
    sharesPct: 50,
    minSavings: 2500,
    savingsPct: 50,
    notes: "Larger upfront",
  },
  {
    range: "20,001 – 30,000",
    min: 20001,
    max: 30000,
    minShares: 2100,
    sharesPct: 70,
    minSavings: 3500,
    savingsPct: 70,
    notes: "Larger commitment",
  },
  {
    range: "30,001 – 40,000",
    min: 30001,
    max: 40000,
    minShares: 3000,
    sharesPct: 100,
    minSavings: 4000,
    savingsPct: 80,
    notes: "Almost full",
  },
  {
    range: "40,001 – 50,000",
    min: 40001,
    max: 50000,
    minShares: 3000,
    sharesPct: 100,
    minSavings: 5000,
    savingsPct: 100,
    notes: "Full mandatory payment",
  },
];

export function upfrontTierForAmount(amount: number) {
  const normalized = Number(amount ?? 0);
  if (normalized <= 0) return undefined;
  const directMatch = SBC_UPFRONT_TABLE.find(
    (tier) => normalized >= tier.min && normalized <= tier.max,
  );
  if (directMatch) return directMatch;
  const highestTier = SBC_UPFRONT_TABLE[SBC_UPFRONT_TABLE.length - 1];
  if (highestTier && normalized >= highestTier.min) return highestTier;
  return undefined;
}

export function upfrontRequirementForAmount(amount: number) {
  const tier = upfrontTierForAmount(amount);
  const sharesAmount = tier?.minShares ?? 0;
  const savingsAmount = tier?.minSavings ?? 0;
  return {
    tier,
    sharesAmount,
    savingsAmount,
    total: sharesAmount + savingsAmount,
  };
}

export function upfrontRequirementForMemberAmount(
  amount: number,
  member?: Pick<Member, "savingsBalance" | "shares" | "shareReserveBalance"> | null,
) {
  const base = upfrontRequirementForAmount(amount);
  const currentSavings = Math.max(0, Number(member?.savingsBalance ?? 0));
  const currentSharesValue =
    Math.max(0, Number(member?.shares ?? 0)) * SHARE_PRICE +
    Math.max(0, Number(member?.shareReserveBalance ?? 0));
  const savingsGap = Math.max(0, base.savingsAmount - currentSavings);
  const sharesGap = Math.max(0, base.sharesAmount - currentSharesValue);

  return {
    ...base,
    currentSavings,
    currentSharesValue,
    savingsGap,
    sharesGap,
    total: savingsGap + sharesGap,
    originalTotal: base.total,
  };
}

export function upfrontTotalsForAmount(
  amount: number,
  options?: {
    membershipFeeAmount?: number;
    cardFeeAmount?: number;
    stickerFeeAmount?: number;
    includeSticker?: boolean;
  },
) {
  const requirement = upfrontRequirementForAmount(amount);
  const membershipFeeAmount = Math.max(0, Number(options?.membershipFeeAmount ?? 0));
  const cardFeeAmount = Math.max(0, Number(options?.cardFeeAmount ?? 0));
  const stickerFeeAmount = options?.includeSticker
    ? Math.max(0, Number(options?.stickerFeeAmount ?? 0))
    : 0;
  const mandatoryFeesTotal = membershipFeeAmount + cardFeeAmount + stickerFeeAmount;

  return {
    ...requirement,
    membershipFeeAmount,
    cardFeeAmount,
    stickerFeeAmount,
    mandatoryFeesTotal,
    totalUpfrontNow: requirement.total + mandatoryFeesTotal,
  };
}

/** Base navigation per role. Additional director-only pages are filtered in `navForUser`. */
export const ROLE_NAV: Record<Role, string[]> = {
  director: [
    "dashboard",
    "loans",
    "approvals",
    "members",
    "savings",
    "shares",
    "transactions",
    "suppliers",
    "stock",
    "pettycash",
    "investors",
    "attendance",
    "reports",
    "policies",
    "payroll",
    "fees",
    "staffmgmt",
    "staff",
    "memos",
    "supportinbox",
    "ai",
    "portal",
  ],
  manager: [
    "dashboard",
    "loans",
    "approvals",
    "members",
    "savings",
    "shares",
    "transactions",
    "suppliers",
    "stock",
    "pettycash",
    "attendance",
    "policies",
    "staff",
    "memos",
    "supportinbox",
    "ai",
    "portal",
  ],
  loan_officer: [
    "dashboard",
    "loans",
    "approvals",
    "members",
    "savings",
    "transactions",
    "suppliers",
    "stock",
    "attendance",
    "policies",
    "staff",
    "memos",
    "supportinbox",
    "ai",
    "portal",
  ],
};

const DIRECTOR_ONLY = new Set(["staffmgmt", "investors", "fees"]);

/** Filter ROLE_NAV based on role-only restrictions. Staff chat remains visible to every staff member. */
export function navForUser(user: Staff): string[] {
  const base = ROLE_NAV[user.role] ?? [];
  if (user.role === "director") return base;
  return base.filter((k) => !DIRECTOR_ONLY.has(k));
}

export function scoreLoan(inputs: {
  dicr: number;
  bdsr: number;
  savingsConsistency: "Good" | "Average" | "Poor";
  crbStatus: "Positive" | "Negative" | "No Record" | "Unknown";
  existingBurden: "Manageable" | "Moderate" | "Overburdened";
  documentation: "Strong" | "Partial" | "Weak";
  cooperation: "Strong" | "Moderate" | "Poor";
}) {
  const sDICR = inputs.dicr >= 2.0 ? 25 : inputs.dicr >= 1.5 ? 15 : 6;
  const sBDSR = inputs.bdsr >= 1.2 ? 15 : inputs.bdsr >= 1.0 ? 8 : 0;
  const sSav =
    inputs.savingsConsistency === "Good" ? 10 : inputs.savingsConsistency === "Average" ? 5 : 0;
  const sCRB = inputs.crbStatus === "Positive" ? 15 : inputs.crbStatus === "No Record" ? 8 : 0;
  const sBurden =
    inputs.existingBurden === "Manageable" ? 10 : inputs.existingBurden === "Moderate" ? 5 : 0;
  const sDocs = inputs.documentation === "Strong" ? 5 : inputs.documentation === "Partial" ? 3 : 0;
  const sCoop = inputs.cooperation === "Strong" ? 5 : inputs.cooperation === "Moderate" ? 3 : 0;
  const total = sDICR + sBDSR + sSav + sCRB + sBurden + sDocs + sCoop;
  const decision: "Approve" | "Approve with Adjustments" | "Refer / Downsize" | "Reject" =
    total >= 75
      ? "Approve"
      : total >= 55
        ? "Approve with Adjustments"
        : total >= 40
          ? "Refer / Downsize"
          : "Reject";
  const riskLevel: "LOW" | "MODERATE" | "HIGH" | "VERY HIGH" =
    total >= 75 ? "LOW" : total >= 55 ? "MODERATE" : total >= 40 ? "HIGH" : "VERY HIGH";
  return { sDICR, sBDSR, sSav, sCRB, sBurden, sDocs, sCoop, total, decision, riskLevel };
}

export const roleLabel = (r: Role) =>
  r === "director" ? "Director" : r === "manager" ? "Manager" : "Loan Officer";
