import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Role = "director" | "manager" | "loan_officer";

export type MandatoryFees = {
  membership: boolean; // 500/=
  card: boolean; // 500/=
  hasShop: boolean; // sticker only required if member has a physical shop
  sticker: boolean; // 500/= when hasShop
  firstUpfrontPaid: boolean; // first-installment / loan upfront already settled manually
};

export type Member = {
  id: string;
  name: string;
  phone: string;
  joinedAt: string;
  status: "active" | "dormant";
  shares: number;
  savingsBalance: number;
  fees: MandatoryFees;
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
  businessAddress?: string;
  fieldOfficerId?: string;
};

/** SBC policy: loan terms are fixed-day buckets, not months. */
export type LoanTermDays = 7 | 14 | 30;

export type Loan = {
  id: string;
  memberId: string;
  principal: number; // amount applied for / disbursed
  approvedAmount?: number; // amount approved by manager/director (may be lower)
  rate: number; // % per month (legacy field — kept for old seed loans)
  termMonths: number; // legacy field, kept for back-compat
  termDays?: LoanTermDays; // new: SBC fixed term (7/14/30)
  startDate: string;
  status: "pending" | "active" | "closed" | "defaulted" | "rejected";
  officerId: string;
  paid: number;
  purpose?: string;
  reviewedBy?: string;
  reviewNote?: string;
};

export type Transaction = {
  id: string;
  date: string;
  type:
    | "deposit"
    | "withdrawal"
    | "loan_disbursement"
    | "loan_repayment"
    | "share_purchase"
    | "petty_cash"
    | "investor_contribution"
    | "fee_payment";
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
  status: "present" | "absent" | "late";
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
  status: "outstanding" | "paid";
  paidFrom?: "round_off_pool" | "direct" | "mpesa";
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
  primary?: { type: Transaction["type"]; amount: number; loanId?: string; note?: string };
  toRoundOff?: number;
  penaltiesCleared?: { id: string; amount: number }[];
  notes: string[];
};

const SHARE_PRICE = 500;
export const SBC_LOAN_TERMS: LoanTermDays[] = [7, 14, 30];
export const SBC_TERM_RATE_PCT_BY_DAYS: Record<LoanTermDays, number> = {
  7: 10,
  14: 15,
  30: 20,
};

/**
 * SBC mandatory savings threshold (per member, before they qualify for a loan).
 * Sourced from SBC policy upfront table — minimum 1,000/= savings to even apply.
 */
export const MANDATORY_SAVINGS_THRESHOLD = 1000;
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
    email: "admin@sauti.co.ke",
    tempPassword: "Sauti1234",
    canMarkAttendance: true,
  },
  {
    id: "S2",
    name: "Grace Wanjiku",
    role: "manager",
    email: "grace@sauti.co.ke",
    phone: "+254722000002",
    tempPassword: "Sauti1234",
    canMarkAttendance: true,
  },
  {
    id: "S3",
    name: "Peter Otieno",
    role: "loan_officer",
    email: "peter@sauti.co.ke",
    phone: "+254722000003",
    tempPassword: "Sauti1234",
  },
  {
    id: "S4",
    name: "Mary Achieng",
    role: "loan_officer",
    email: "mary@sauti.co.ke",
    phone: "+254722000004",
    tempPassword: "Sauti1234",
  },
];

export const DEFAULT_FEES: MandatoryFees = {
  membership: false,
  card: false,
  hasShop: false,
  sticker: false,
  firstUpfrontPaid: false,
};

const PAID_FEES: MandatoryFees = {
  membership: true,
  card: true,
  hasShop: true,
  sticker: true,
  firstUpfrontPaid: true,
};
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const seedMembers: Member[] = [
  {
    id: "M101",
    name: "John Kamau",
    firstName: "John",
    lastName: "Kamau",
    phone: "+254722000101",
    joinedAt: daysAgo(120),
    status: "active",
    shares: 10,
    savingsBalance: 8500,
    fees: PAID_FEES,
    gender: "Male",
    county: "Nairobi",
    village: "Kawangware",
    businessName: "Kamau Hardware",
    businessType: "Retail",
    fieldOfficerId: "S3",
  },
  {
    id: "M102",
    name: "Jane Njeri",
    firstName: "Jane",
    lastName: "Njeri",
    phone: "+254722000102",
    joinedAt: daysAgo(95),
    status: "active",
    shares: 6,
    savingsBalance: 5200,
    fees: PAID_FEES,
    gender: "Female",
    county: "Kiambu",
    village: "Ruiru",
    businessName: "Njeri Salon",
    businessType: "Services",
    fieldOfficerId: "S3",
  },
  {
    id: "M103",
    name: "Samuel Mwangi",
    firstName: "Samuel",
    lastName: "Mwangi",
    phone: "+254722000103",
    joinedAt: daysAgo(80),
    status: "active",
    shares: 4,
    savingsBalance: 3000,
    fees: PAID_FEES,
    gender: "Male",
    county: "Nakuru",
    village: "Naka",
    businessName: "Mwangi Boda",
    businessType: "Transport",
    fieldOfficerId: "S4",
  },
  {
    id: "M104",
    name: "Esther Wambui",
    firstName: "Esther",
    lastName: "Wambui",
    phone: "+254722000104",
    joinedAt: daysAgo(70),
    status: "active",
    shares: 8,
    savingsBalance: 6800,
    fees: PAID_FEES,
    gender: "Female",
    county: "Nyeri",
    village: "Ruring'u",
    businessName: "Wambui Greens",
    businessType: "Mama Mboga",
    fieldOfficerId: "S4",
  },
  {
    id: "M105",
    name: "Daniel Ouma",
    firstName: "Daniel",
    lastName: "Ouma",
    phone: "+254722000105",
    joinedAt: daysAgo(55),
    status: "active",
    shares: 5,
    savingsBalance: 4100,
    fees: PAID_FEES,
    gender: "Male",
    county: "Kisumu",
    village: "Kondele",
    businessName: "Ouma Electronics",
    businessType: "Retail",
    fieldOfficerId: "S3",
  },
  {
    id: "M106",
    name: "Lucy Akinyi",
    firstName: "Lucy",
    lastName: "Akinyi",
    phone: "+254722000106",
    joinedAt: daysAgo(40),
    status: "active",
    shares: 3,
    savingsBalance: 2400,
    fees: PAID_FEES,
    gender: "Female",
    county: "Mombasa",
    village: "Likoni",
    businessName: "Akinyi Tailoring",
    businessType: "Services",
    fieldOfficerId: "S4",
  },
  {
    id: "M107",
    name: "Patrick Kiprono",
    firstName: "Patrick",
    lastName: "Kiprono",
    phone: "+254722000107",
    joinedAt: daysAgo(25),
    status: "active",
    shares: 2,
    savingsBalance: 1500,
    fees: { ...PAID_FEES, firstUpfrontPaid: false },
    gender: "Male",
    county: "Eldoret",
    village: "Langas",
    businessName: "Kiprono Cyber",
    businessType: "Services",
    fieldOfficerId: "S3",
  },
  {
    id: "M108",
    name: "Beatrice Mutiso",
    firstName: "Beatrice",
    lastName: "Mutiso",
    phone: "+254722000108",
    joinedAt: daysAgo(10),
    status: "active",
    shares: 12,
    savingsBalance: 12000,
    fees: PAID_FEES,
    isInvestor: true,
    investorId: "I1",
    gender: "Female",
    county: "Machakos",
    village: "Athi River",
    businessName: "Mutiso Wholesalers",
    businessType: "Wholesale",
    fieldOfficerId: "S4",
  },
];

const seedLoans: Loan[] = [
  {
    id: "L1001",
    memberId: "M101",
    principal: 20000,
    approvedAmount: 20000,
    rate: 20,
    termMonths: 1,
    termDays: 30,
    startDate: daysAgo(60),
    status: "active",
    officerId: "S3",
    paid: 12000,
    purpose: "Stock purchase",
    reviewedBy: "S2",
  },
  {
    id: "L1002",
    memberId: "M102",
    principal: 10000,
    approvedAmount: 10000,
    rate: 15,
    termMonths: 1,
    termDays: 14,
    startDate: daysAgo(40),
    status: "closed",
    officerId: "S3",
    paid: 11500,
    purpose: "Salon supplies",
    reviewedBy: "S2",
  },
  {
    id: "L1003",
    memberId: "M103",
    principal: 15000,
    approvedAmount: 15000,
    rate: 20,
    termMonths: 1,
    termDays: 30,
    startDate: daysAgo(35),
    status: "active",
    officerId: "S4",
    paid: 5000,
    purpose: "Boda spares",
    reviewedBy: "S2",
  },
  {
    id: "L1004",
    memberId: "M104",
    principal: 8000,
    approvedAmount: 8000,
    rate: 10,
    termMonths: 1,
    termDays: 7,
    startDate: daysAgo(20),
    status: "defaulted",
    officerId: "S4",
    paid: 2000,
    purpose: "Restocking",
    reviewedBy: "S2",
  },
  {
    id: "L1005",
    memberId: "M105",
    principal: 25000,
    approvedAmount: 0,
    rate: 20,
    termMonths: 1,
    termDays: 30,
    startDate: today(),
    status: "pending",
    officerId: "S3",
    paid: 0,
    purpose: "Expansion",
  },
  {
    id: "L1006",
    memberId: "M108",
    principal: 30000,
    approvedAmount: 30000,
    rate: 20,
    termMonths: 1,
    termDays: 30,
    startDate: daysAgo(15),
    status: "active",
    officerId: "S4",
    paid: 10000,
    purpose: "Wholesale stock",
    reviewedBy: "S2",
  },
];

const seedTx: Transaction[] = [
  {
    id: "T1",
    date: daysAgo(60),
    type: "loan_disbursement",
    amount: 20000,
    memberId: "M101",
    loanId: "L1001",
    by: "S3",
    ref: "DISB-1001",
  },
  {
    id: "T2",
    date: daysAgo(45),
    type: "loan_repayment",
    amount: 6000,
    memberId: "M101",
    loanId: "L1001",
    by: "S3",
    ref: "MPESA-RA1",
  },
  {
    id: "T3",
    date: daysAgo(25),
    type: "loan_repayment",
    amount: 6000,
    memberId: "M101",
    loanId: "L1001",
    by: "S3",
    ref: "MPESA-RA2",
  },
  {
    id: "T4",
    date: daysAgo(40),
    type: "loan_disbursement",
    amount: 10000,
    memberId: "M102",
    loanId: "L1002",
    by: "S3",
    ref: "DISB-1002",
  },
  {
    id: "T5",
    date: daysAgo(20),
    type: "loan_repayment",
    amount: 11000,
    memberId: "M102",
    loanId: "L1002",
    by: "S3",
    ref: "MPESA-RB1",
  },
  {
    id: "T6",
    date: daysAgo(35),
    type: "loan_disbursement",
    amount: 15000,
    memberId: "M103",
    loanId: "L1003",
    by: "S4",
    ref: "DISB-1003",
  },
  {
    id: "T7",
    date: daysAgo(10),
    type: "loan_repayment",
    amount: 5000,
    memberId: "M103",
    loanId: "L1003",
    by: "S4",
    ref: "MPESA-RC1",
  },
  {
    id: "T8",
    date: daysAgo(20),
    type: "loan_disbursement",
    amount: 8000,
    memberId: "M104",
    loanId: "L1004",
    by: "S4",
    ref: "DISB-1004",
  },
  {
    id: "T9",
    date: daysAgo(12),
    type: "loan_repayment",
    amount: 2000,
    memberId: "M104",
    loanId: "L1004",
    by: "S4",
    ref: "MPESA-RD1",
  },
  {
    id: "T10",
    date: daysAgo(15),
    type: "loan_disbursement",
    amount: 30000,
    memberId: "M108",
    loanId: "L1006",
    by: "S4",
    ref: "DISB-1006",
  },
  {
    id: "T11",
    date: daysAgo(5),
    type: "loan_repayment",
    amount: 10000,
    memberId: "M108",
    loanId: "L1006",
    by: "S4",
    ref: "MPESA-RE1",
  },
  {
    id: "T12",
    date: daysAgo(80),
    type: "deposit",
    amount: 5000,
    memberId: "M101",
    by: "S3",
    note: "Savings deposit",
  },
  {
    id: "T13",
    date: daysAgo(60),
    type: "deposit",
    amount: 3500,
    memberId: "M102",
    by: "S3",
    note: "Savings deposit",
  },
  {
    id: "T14",
    date: daysAgo(50),
    type: "share_purchase",
    amount: 5000,
    memberId: "M101",
    by: "S3",
    note: "10 shares",
  },
  {
    id: "T15",
    date: daysAgo(70),
    type: "share_purchase",
    amount: 6000,
    memberId: "M108",
    by: "S4",
    note: "12 shares",
  },
  {
    id: "T16",
    date: daysAgo(30),
    type: "fee_payment",
    amount: 1000,
    memberId: "M106",
    by: "S4",
    note: "Membership + card",
  },
  {
    id: "T17",
    date: daysAgo(8),
    type: "investor_contribution",
    amount: 50000,
    memberId: "M108",
    by: "S2",
    note: "Investor I1 top-up",
    ref: "INV-I1",
  },
  {
    id: "T18",
    date: daysAgo(3),
    type: "petty_cash",
    amount: 1500,
    by: "S2",
    note: "Office supplies",
  },
];

const seedPenalties: Penalty[] = [
  {
    id: "P1",
    memberId: "M104",
    loanId: "L1004",
    date: daysAgo(8),
    amount: 500,
    reason: "Late repayment",
    status: "outstanding",
  },
  {
    id: "P2",
    memberId: "M101",
    loanId: "L1001",
    date: daysAgo(20),
    amount: 200,
    reason: "Missed installment",
    status: "paid",
    paidFrom: "round_off_pool",
  },
];

const seedRoundOff: RoundOffEntry[] = [
  {
    id: "R1",
    memberId: "M101",
    date: daysAgo(45),
    amount: 4,
    source: "loan_repayment",
    ref: "MPESA-RA1",
  },
  {
    id: "R2",
    memberId: "M108",
    date: daysAgo(5),
    amount: 3,
    source: "loan_repayment",
    ref: "MPESA-RE1",
  },
];

const seedPetty: PettyCashEntry[] = [
  {
    id: "PC1",
    date: daysAgo(20),
    description: "Topup from bank",
    amount: 20000,
    category: "topup",
    by: "S2",
    type: "topup",
    mode: "bank",
    openingBalance: 0,
  },
  {
    id: "PC2",
    date: daysAgo(15),
    description: "Airtime",
    amount: 500,
    category: "office",
    by: "S2",
    type: "payment",
    mode: "cash",
    payee: "Safaricom",
  },
  {
    id: "PC3",
    date: daysAgo(7),
    description: "Office tea",
    amount: 350,
    category: "office",
    by: "S2",
    type: "payment",
    mode: "cash",
    payee: "Local shop",
  },
  {
    id: "PC4",
    date: daysAgo(3),
    description: "Office supplies",
    amount: 1500,
    category: "office",
    by: "S2",
    type: "payment",
    mode: "cash",
    payee: "Stationers",
  },
];

const seedInvestors: Investor[] = [
  {
    id: "I1",
    name: "Beatrice Mutiso",
    contributed: 100000,
    sharePct: 60,
    joinedAt: daysAgo(90),
    phone: "+254722000108",
    memberId: "M108",
    notes: "Founding investor",
  },
  {
    id: "I2",
    name: "Daniel Mbugua",
    contributed: 75000,
    sharePct: 40,
    joinedAt: daysAgo(60),
    phone: "+254722000999",
    notes: "External investor",
  },
];

const seedAttendance: Attendance[] = [
  {
    id: "A1",
    staffId: "S2",
    date: daysAgo(2),
    status: "present",
    checkIn: "08:05",
    checkOut: "17:10",
  },
  {
    id: "A2",
    staffId: "S3",
    date: daysAgo(2),
    status: "present",
    checkIn: "08:15",
    checkOut: "17:00",
  },
  {
    id: "A3",
    staffId: "S4",
    date: daysAgo(2),
    status: "late",
    checkIn: "09:20",
    checkOut: "17:05",
  },
  {
    id: "A4",
    staffId: "S2",
    date: daysAgo(1),
    status: "present",
    checkIn: "08:00",
    checkOut: "17:00",
  },
  {
    id: "A5",
    staffId: "S3",
    date: daysAgo(1),
    status: "present",
    checkIn: "08:10",
    checkOut: "17:00",
  },
  { id: "A6", staffId: "S4", date: daysAgo(1), status: "absent" },
  { id: "A7", staffId: "S2", date: today(), status: "present", checkIn: "08:02" },
  { id: "A8", staffId: "S3", date: today(), status: "present", checkIn: "08:20" },
];
type Store = {
  isAuthenticated: boolean;
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
  sharePrice: number;
  /** Member auth — membership No. + phone number. Returns the matched member or null. */
  loginMember: (memberNo: string, phone: string) => Member | null;
  /** Staff auth — email + temp password. */
  loginStaff: (email: string, password: string) => Staff | null;
  /** Logout — resets currentUser to default seed director (demo only). */
  logout: () => void;
  addMember: (
    m: Omit<Member, "id" | "fees" | "isInvestor" | "investorId"> & {
      fees?: MandatoryFees;
      investorContribution?: number;
      investorNotes?: string;
    },
  ) => string;
  addStaff: (s: Omit<Staff, "id">) => string;
  updateStaff: (id: string, patch: Partial<Staff>) => void;
  removeStaff: (id: string) => void;
  addLoan: (l: Omit<Loan, "id" | "paid" | "status"> & { status?: Loan["status"] }) => string;
  approveLoan: (loanId: string, approvedAmount: number, by: string, note?: string) => void;
  rejectLoan: (loanId: string, by: string, note?: string) => void;
  recordTransaction: (t: Omit<Transaction, "id" | "date"> & { date?: string }) => void;
  addPetty: (p: Omit<PettyCashEntry, "id" | "date"> & { date?: string }) => void;
  addAppraisal: (a: Omit<Appraisal, "id" | "date">) => void;
  addInvestor: (i: Omit<Investor, "id" | "joinedAt"> & { joinedAt?: string }) => void;
  addFieldVisit: (v: Omit<FieldVisit, "id" | "date"> & { date?: string }) => void;
  addFollowup: (n: Omit<FollowupNote, "id" | "date"> & { date?: string }) => void;
  /** Mark another staff present/absent (caller must be director or canMarkAttendance). */
  markAttendance: (staffId: string, status: Attendance["status"], when?: "in" | "out") => void;
  memberLoanCount: (memberId: string) => number;
  roundOffBalance: (memberId: string) => number;
  settlePenaltyFromPool: (penaltyId: string) => boolean;
  resolveMpesaAccount: (account: string) => Member | undefined;
  applyMpesaPayment: (
    account: string,
    amount: number,
    payerName?: string,
    mpesaRef?: string,
  ) => MpesaAllocation;
};

const Ctx = createContext<Store | null>(null);

const STAFF_KEY = "sauti_staff_v3";
const ATT_KEY = "sauti_attendance_v3";
const AUTH_KEY = "sauti_auth_v1";
const AUTH_STAFF_KEY = "sauti_auth_staff_v1";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<Staff[]>(() => {
    try {
      const s = localStorage.getItem(STAFF_KEY);
      if (s) return JSON.parse(s);
    } catch {}
    return seedStaff;
  });
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTH_KEY) === "1";
    } catch {}
    return false;
  });
  const [currentUser, setCurrentUserState] = useState<Staff>(() => {
    try {
      const savedId = localStorage.getItem(AUTH_STAFF_KEY);
      if (savedId) {
        const savedStaff = staff.find((member) => member.id === savedId);
        if (savedStaff) return savedStaff;
      }
    } catch {}
    return staff[0] ?? seedStaff[0];
  });
  const [members, setMembers] = useState<Member[]>(seedMembers);
  const [loans, setLoans] = useState<Loan[]>(seedLoans);
  const [transactions, setTransactions] = useState<Transaction[]>(seedTx);
  const [pettyCash, setPettyCash] = useState<PettyCashEntry[]>(seedPetty);
  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [investors, setInvestors] = useState<Investor[]>(seedInvestors);
  const [fieldVisits, setFieldVisits] = useState<FieldVisit[]>([]);
  const [followups, setFollowups] = useState<FollowupNote[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>(seedPenalties);
  const [roundOff, setRoundOff] = useState<RoundOffEntry[]>(seedRoundOff);
  const [attendance, setAttendance] = useState<Attendance[]>(() => {
    try {
      const s = localStorage.getItem(ATT_KEY);
      if (s) return JSON.parse(s);
    } catch {}
    return seedAttendance;
  });

  const setAuthenticated = (next: boolean) => {
    setIsAuthenticated(next);
    try {
      if (next) {
        localStorage.setItem(AUTH_KEY, "1");
      } else {
        localStorage.removeItem(AUTH_KEY);
        localStorage.removeItem(AUTH_STAFF_KEY);
      }
    } catch {}
  };

  const setCurrentUser = (next: Staff) => {
    setCurrentUserState(next);
    try {
      localStorage.setItem(AUTH_STAFF_KEY, next.id);
    } catch {}
  };

  const value = useMemo<Store>(
    () => ({
      isAuthenticated,
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
      addMember: (m) => {
        const id = `M${String(100 + members.length + 1).padStart(3, "0")}`;
        let investorId: string | undefined;
        if ((m as any).investorContribution && (m as any).investorContribution > 0) {
          investorId = `I${investors.length + 1}`;
          const inv: Investor = {
            id: investorId,
            name: m.name,
            contributed: (m as any).investorContribution,
            sharePct: 0,
            joinedAt: new Date().toISOString().slice(0, 10),
            phone: m.phone,
            notes: (m as any).investorNotes,
            memberId: id,
          };
          setInvestors((prev) => [...prev, inv]);
          setTransactions((prev) => [
            {
              id: `T${prev.length + 1}`,
              date: inv.joinedAt,
              type: "investor_contribution",
              amount: inv.contributed,
              memberId: id,
              by: currentUser.id,
              note: `Member-investor onboarding: ${m.name}`,
            },
            ...prev,
          ]);
        }
        setMembers((prev) => [
          ...prev,
          { ...m, id, fees: m.fees ?? { ...DEFAULT_FEES }, isInvestor: !!investorId, investorId },
        ]);
        return id;
      },
      addLoan: (l) => {
        const id = `L${1000 + loans.length + 1}`;
        const status = l.status ?? "pending";
        const termDays = normalizeLoanTermDays(l.termDays ?? (l.termMonths || 1) * 30);
        const termMonths = termPeriodsFromDays(termDays);
        const rate = l.rate > 0 ? l.rate : loanRateForTerm(termDays);
        setLoans((prev) => [...prev, { ...l, id, rate, termDays, termMonths, paid: 0, status }]);
        // Only record disbursement if directly active
        if (status === "active") {
          setTransactions((prev) => [
            {
              id: `T${prev.length + 1}`,
              date: new Date().toISOString().slice(0, 10),
              type: "loan_disbursement",
              amount: l.principal,
              memberId: l.memberId,
              loanId: id,
              by: currentUser.id,
            },
            ...prev,
          ]);
        }
        return id;
      },
      approveLoan: (loanId, approvedAmount, by, note) => {
        setLoans((prev) =>
          prev.map((ln) => {
            if (ln.id !== loanId) return ln;
            return {
              ...ln,
              principal: approvedAmount,
              approvedAmount,
              status: "active",
              reviewedBy: by,
              reviewNote: note,
            };
          }),
        );
        const ln = loans.find((x) => x.id === loanId);
        if (ln) {
          setTransactions((prev) => [
            {
              id: `T${prev.length + 1}`,
              date: new Date().toISOString().slice(0, 10),
              type: "loan_disbursement",
              amount: approvedAmount,
              memberId: ln.memberId,
              loanId,
              by,
              note: note ?? "Approved",
            },
            ...prev,
          ]);
        }
      },
      rejectLoan: (loanId, by, note) => {
        setLoans((prev) =>
          prev.map((ln) =>
            ln.id === loanId ? { ...ln, status: "rejected", reviewedBy: by, reviewNote: note } : ln,
          ),
        );
      },
      recordTransaction: (t) => {
        const id = `T${transactions.length + 1}`;
        const date = t.date ?? new Date().toISOString().slice(0, 10);
        setTransactions((prev) => [{ ...t, id, date }, ...prev]);
        if (t.memberId) {
          setMembers((prev) =>
            prev.map((m) => {
              if (m.id !== t.memberId) return m;
              if (t.type === "deposit")
                return { ...m, savingsBalance: m.savingsBalance + t.amount };
              if (t.type === "withdrawal")
                return { ...m, savingsBalance: Math.max(0, m.savingsBalance - t.amount) };
              if (t.type === "share_purchase")
                return { ...m, shares: m.shares + Math.floor(t.amount / SHARE_PRICE) };
              return m;
            }),
          );
        }
        if (t.loanId && t.type === "loan_repayment") {
          setLoans((prev) =>
            prev.map((ln) => {
              if (ln.id !== t.loanId) return ln;
              const nextPaid = ln.paid + t.amount;
              const next = { ...ln, paid: nextPaid };
              return loanSummary(next).isSettled ? { ...next, status: "closed" } : next;
            }),
          );
        }
      },
      addPetty: (p) => {
        const id = `P${pettyCash.length + 1}`;
        const date = p.date ?? new Date().toISOString().slice(0, 10);
        setPettyCash((prev) => [{ ...p, id, date }, ...prev]);
        // Petty cash is its own ledger — NOT linked to the paybill / transactions ledger.
      },
      addAppraisal: (a) => {
        const id = `AP${appraisals.length + 1}`;
        const date = new Date().toISOString().slice(0, 10);
        setAppraisals((prev) => [{ ...a, id, date }, ...prev]);
      },
      addInvestor: (i) => {
        const id = `I${investors.length + 1}`;
        const joinedAt = i.joinedAt ?? new Date().toISOString().slice(0, 10);
        setInvestors((prev) => [...prev, { ...i, id, joinedAt }]);
        setTransactions((prev) => [
          {
            id: `T${prev.length + 1}`,
            date: joinedAt,
            type: "investor_contribution",
            amount: i.contributed,
            by: currentUser.id,
            note: `Investor: ${i.name}`,
          },
          ...prev,
        ]);
      },
      addFieldVisit: (v) => {
        const id = `FV${fieldVisits.length + 1}`;
        const date = v.date ?? new Date().toISOString().slice(0, 10);
        setFieldVisits((prev) => [{ ...v, id, date }, ...prev]);
      },
      addFollowup: (n) => {
        const id = `FU${followups.length + 1}`;
        const date = n.date ?? new Date().toISOString().slice(0, 10);
        setFollowups((prev) => [{ ...n, id, date }, ...prev]);
      },
      loginMember: (memberNo, phone) => {
        const norm = memberNo.trim().toUpperCase();
        // Accept both raw IDs (M001) and SBC-prefixed (SBC0475K) — match the trailing digits
        const m = norm.match(/(\d{1,4})/);
        if (!m) return null;
        const memberNum = m[1].padStart(3, "0");
        const cleanPhone = phone.replace(/\D/g, "").replace(/^0/, "254");
        const target = members.find((mb) => mb.id === `M${memberNum}`);
        if (!target) return null;
        const targetPhone = target.phone.replace(/\D/g, "");
        if (targetPhone.endsWith(cleanPhone) || cleanPhone.endsWith(targetPhone.slice(-9)))
          return target;
        return null;
      },
      loginStaff: (email, password) => {
        const e = email.trim().toLowerCase();
        const found = staff.find(
          (s) => (s.email ?? "").toLowerCase() === e && (s.tempPassword ?? "") === password,
        );
        if (found) {
          setCurrentUser(found);
          setAuthenticated(true);
          return found;
        }
        return null;
      },
      logout: () => {
        setAuthenticated(false);
        try {
          sessionStorage.removeItem("sauti_splash");
        } catch {}
        setCurrentUserState(seedStaff[0]);
      },
      addStaff: (s) => {
        const id = `S${100 + staff.length + 1}`;
        const next = [...staff, { ...s, id }];
        setStaff(next);
        try {
          localStorage.setItem(STAFF_KEY, JSON.stringify(next));
        } catch {}
        return id;
      },
      updateStaff: (id, patch) => {
        const next = staff.map((s) => (s.id === id ? { ...s, ...patch } : s));
        setStaff(next);
        try {
          localStorage.setItem(STAFF_KEY, JSON.stringify(next));
        } catch {}
        if (currentUser.id === id) setCurrentUser({ ...currentUser, ...patch });
      },
      removeStaff: (id) => {
        const next = staff.filter((s) => s.id !== id);
        setStaff(next);
        try {
          localStorage.setItem(STAFF_KEY, JSON.stringify(next));
        } catch {}
      },
      markAttendance: (staffId, status, when = "in") => {
        const today = new Date().toISOString().slice(0, 10);
        const time = new Date().toTimeString().slice(0, 5);
        const existing = attendance.find((a) => a.staffId === staffId && a.date === today);
        let next: Attendance[];
        if (existing) {
          next = attendance.map((a) =>
            a.id === existing.id
              ? { ...a, status, ...(when === "in" ? { checkIn: time } : { checkOut: time }) }
              : a,
          );
        } else {
          next = [
            {
              id: `A-${today}-${staffId}`,
              staffId,
              date: today,
              status,
              ...(when === "in" ? { checkIn: time } : { checkOut: time }),
            },
            ...attendance,
          ];
        }
        setAttendance(next);
        try {
          localStorage.setItem(ATT_KEY, JSON.stringify(next));
        } catch {}
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
      settlePenaltyFromPool: (penaltyId: string) => {
        const pen = penalties.find((p) => p.id === penaltyId);
        if (!pen || pen.status !== "outstanding") return false;
        const credits = roundOff
          .filter((r) => r.memberId === pen.memberId)
          .reduce((s, r) => s + r.amount, 0);
        const debits = penalties
          .filter(
            (p) =>
              p.memberId === pen.memberId && p.status === "paid" && p.paidFrom === "round_off_pool",
          )
          .reduce((s, p) => s + p.amount, 0);
        const bal = credits - debits;
        if (bal < pen.amount) return false;
        setPenalties((prev) =>
          prev.map((p) =>
            p.id === penaltyId ? { ...p, status: "paid", paidFrom: "round_off_pool" } : p,
          ),
        );
        return true;
      },
      resolveMpesaAccount: (account: string) => {
        const norm = account.trim().toUpperCase();
        // Convention: SBC<NNN>[suffix] — last 3+ digits = member numeric ID
        const m = norm.match(/SBC0*(\d{1,4})/);
        if (!m) return undefined;
        const memberNum = m[1].padStart(3, "0");
        return members.find((mb) => mb.id === `M${memberNum}`);
      },
      applyMpesaPayment: (account, amount, payerName, mpesaRef) => {
        const norm = account.trim().toUpperCase();
        const notes: string[] = [];
        const m = norm.match(/SBC0*(\d{1,4})/);
        if (!m) {
          notes.push(`Account "${account}" did not match SBC member pattern.`);
          return { matched: false, account: norm, notes };
        }
        const memberNum = m[1].padStart(3, "0");
        const memberId = `M${memberNum}`;
        const member = members.find((mb) => mb.id === memberId);
        if (!member) {
          notes.push(`No member with ID ${memberId}. Holding as suspense.`);
          return { matched: false, account: norm, notes };
        }

        let remaining = amount;
        const today = new Date().toISOString().slice(0, 10);
        const txBatch: Transaction[] = [];
        const penaltiesCleared: { id: string; amount: number }[] = [];
        let primary: MpesaAllocation["primary"];
        let toRoundOff = 0;
        const feeUpdates: Partial<MandatoryFees> = {};

        // 0) Member-investor short-circuit: any payment goes straight to the investment pool.
        if (member.isInvestor && member.investorId) {
          setInvestors((prev) =>
            prev.map((inv) =>
              inv.id === member.investorId
                ? { ...inv, contributed: inv.contributed + amount }
                : inv,
            ),
          );
          const tx: Transaction = {
            id: "",
            date: today,
            type: "investor_contribution",
            amount,
            memberId,
            by: "MPESA",
            ref: mpesaRef,
            account: norm,
            payerName,
            note: `Investment top-up via Paybill ${norm}`,
          };
          setTransactions((prev) => [{ ...tx, id: `T${prev.length + 1}` }, ...prev]);
          notes.push(`Routed ${amount}/= to investment pool for member-investor ${member.name}.`);
          primary = {
            type: "investor_contribution",
            amount,
            note: `Investment via Paybill ${norm}`,
          };
          return {
            matched: true,
            memberId,
            account: norm,
            primary,
            toRoundOff: 0,
            penaltiesCleared: [],
            notes,
          };
        }

        // 1) Mandatory fees first: membership 500, card 500, sticker 500 (only if hasShop)
        const FEE_QUEUE: {
          key: keyof MandatoryFees;
          label: string;
          amount: number;
          required: boolean;
        }[] = [
          { key: "membership", label: "Membership fee", amount: 500, required: true },
          { key: "card", label: "Membership card", amount: 500, required: true },
          { key: "sticker", label: "Sticker fee", amount: 500, required: member.fees.hasShop },
        ];
        for (const fee of FEE_QUEUE) {
          if (!fee.required) continue;
          if (member.fees[fee.key]) continue;
          if (remaining < fee.amount) break;
          remaining -= fee.amount;
          (feeUpdates as any)[fee.key] = true;
          txBatch.push({
            id: "",
            date: today,
            type: "fee_payment",
            amount: fee.amount,
            memberId,
            by: "MPESA",
            ref: mpesaRef,
            account: norm,
            payerName,
            note: `${fee.label} (auto)`,
          });
          notes.push(`Paid ${fee.label} — ${fee.amount}/=.`);
        }
        if (Object.keys(feeUpdates).length) {
          setMembers((prev) =>
            prev.map((mb) =>
              mb.id === memberId ? { ...mb, fees: { ...mb.fees, ...feeUpdates } } : mb,
            ),
          );
        }

        // 2) Clear outstanding penalties
        const outstanding = penalties.filter(
          (p) => p.memberId === memberId && p.status === "outstanding",
        );
        for (const pen of outstanding) {
          if (remaining >= pen.amount) {
            remaining -= pen.amount;
            penaltiesCleared.push({ id: pen.id, amount: pen.amount });
            notes.push(`Cleared penalty ${pen.id} (${pen.reason}) — ${pen.amount}/=.`);
          }
        }
        if (penaltiesCleared.length) {
          setPenalties((prev) =>
            prev.map((p) =>
              penaltiesCleared.find((c) => c.id === p.id)
                ? { ...p, status: "paid", paidFrom: "mpesa" }
                : p,
            ),
          );
        }

        // 3) Active loan repayment (oldest first)
        const activeLoan = loans
          .filter((l) => l.memberId === memberId && l.status === "active")
          .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
        if (activeLoan && remaining > 0) {
          const balance = loanSummary(activeLoan).balance;
          const applied = Math.min(remaining, balance);
          const rounded = roundUpKES(applied, ROUNDING_BASE);
          const surplus = Math.max(0, rounded - applied);
          if (remaining >= rounded) {
            remaining -= rounded;
            if (surplus > 0) toRoundOff += surplus;
          } else {
            remaining = 0;
          }
          primary = {
            type: "loan_repayment",
            amount: applied,
            loanId: activeLoan.id,
            note: `M-Pesa ${mpesaRef ?? ""} from ${payerName ?? "—"}`,
          };
          txBatch.push({
            id: "",
            date: today,
            type: "loan_repayment",
            amount: applied,
            memberId,
            loanId: activeLoan.id,
            by: "MPESA",
            ref: mpesaRef,
            account: norm,
            payerName,
            note: `Paybill ${norm} · ${payerName ?? ""}`,
          });
          setLoans((prev) =>
            prev.map((ln) => {
              if (ln.id !== activeLoan.id) return ln;
              const nextPaid = ln.paid + applied;
              const next = { ...ln, paid: nextPaid };
              return loanSummary(next).isSettled ? { ...next, status: "closed" } : next;
            }),
          );
          if (!member.fees.firstUpfrontPaid) {
            setMembers((prev) =>
              prev.map((mb) =>
                mb.id === memberId ? { ...mb, fees: { ...mb.fees, firstUpfrontPaid: true } } : mb,
              ),
            );
          }
          notes.push(
            `Applied ${applied}/= to loan ${activeLoan.id}; rounded up to ${rounded}/=, surplus ${surplus}/= → round-off pool.`,
          );
        }

        // 3) Anything left → savings deposit (also rounded)
        if (remaining > 0) {
          const rounded = roundUpKES(remaining, ROUNDING_BASE);
          const surplus = Math.max(0, rounded - remaining);
          const applied = remaining;
          if (!primary)
            primary = {
              type: "deposit",
              amount: applied,
              note: `M-Pesa ${mpesaRef ?? ""} from ${payerName ?? "—"}`,
            };
          txBatch.push({
            id: "",
            date: today,
            type: "deposit",
            amount: applied,
            memberId,
            by: "MPESA",
            ref: mpesaRef,
            account: norm,
            payerName,
            note: `Paybill ${norm} · ${payerName ?? ""}`,
          });
          setMembers((prev) =>
            prev.map((mb) =>
              mb.id === memberId ? { ...mb, savingsBalance: mb.savingsBalance + applied } : mb,
            ),
          );
          if (surplus > 0) toRoundOff += surplus;
          if (member.savingsBalance + applied < MANDATORY_SAVINGS_THRESHOLD) {
            notes.push(
              `Member is still below the mandatory savings threshold of ${MANDATORY_SAVINGS_THRESHOLD}/=.`,
            );
          } else {
            notes.push(`Member meets mandatory savings threshold.`);
          }
          remaining = 0;
        }

        // Persist transactions + round-off pool entries
        if (txBatch.length) {
          setTransactions((prev) => {
            const out = [...prev];
            txBatch.forEach((t, i) => out.unshift({ ...t, id: `T${prev.length + i + 1}` }));
            return out;
          });
        }
        if (toRoundOff > 0) {
          setRoundOff((prev) => [
            {
              id: `RO${prev.length + 1}`,
              memberId,
              date: today,
              amount: toRoundOff,
              source: "loan_repayment",
              ref: mpesaRef,
            },
            ...prev,
          ]);
        }

        return {
          matched: true,
          memberId,
          account: norm,
          primary,
          toRoundOff,
          penaltiesCleared,
          notes,
        };
      },
    }),
    [
      isAuthenticated,
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
  return Math.ceil(amount / step) * step;
}

export function normalizeLoanTermDays(termDays?: number): LoanTermDays {
  if (termDays === 7 || termDays === 14 || termDays === 30) return termDays;
  if ((termDays ?? 0) <= 10) return 7;
  if ((termDays ?? 0) <= 21) return 14;
  return 30;
}

export function termPeriodsFromDays(termDays?: number) {
  return Math.max(1, Math.ceil(normalizeLoanTermDays(termDays) / 30));
}

export function loanRateForTerm(termDays?: number) {
  return SBC_TERM_RATE_PCT_BY_DAYS[normalizeLoanTermDays(termDays)];
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

export function loanSummary(
  loan: Pick<
    Loan,
    | "principal"
    | "approvedAmount"
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
  const schedule = loanScheduleTotal(approved, loan.rate, periods);
  const balance = Math.max(0, schedule.total - loan.paid);
  const dueDate = new Date(loan.startDate);
  dueDate.setDate(dueDate.getDate() + termDays);
  return {
    approved,
    termDays,
    periods,
    interest: schedule.interest,
    total: schedule.total,
    balance,
    dueDate: dueDate.toISOString().slice(0, 10),
    dailyInstallment: schedule.total / termDays,
    isSettled: balance <= 0,
    isOverdue: loan.status === "active" && balance > 0 && dueDate.getTime() < Date.now(),
  };
}

export const SBC_FEES = {
  processingPct: 2,
  insurancePct: 1.5,
  penaltyDailyPct: 5,
  defaultPenaltyPct: 2,
};

export function sbcDeductions(principal: number) {
  const processing = principal * (SBC_FEES.processingPct / 100);
  const insurance = principal * (SBC_FEES.insurancePct / 100);
  return { processing, insurance, total: processing + insurance };
}

export const SBC_UPFRONT_TABLE = [
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

/** Base navigation per role. Visibility of "staff", "staffmgmt", "attendance"
 *  is further filtered by `canMarkAttendance` for non-directors — see `navForUser`. */
export const ROLE_NAV: Record<Role, string[]> = {
  director: [
    "dashboard",
    "loans",
    "approvals",
    "members",
    "savings",
    "shares",
    "transactions",
    "pettycash",
    "investors",
    "attendance",
    "reports",
    "policies",
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
const ATTENDANCE_GATED = new Set(["staff", "attendance"]);

/** Filter ROLE_NAV based on the user's attendance capability. Without it,
 *  non-director staff cannot see other staff (chat or attendance roster). */
export function navForUser(user: Staff): string[] {
  const base = ROLE_NAV[user.role] ?? [];
  if (user.role === "director") return base;
  return base.filter((k) => {
    if (DIRECTOR_ONLY.has(k)) return false;
    if (ATTENDANCE_GATED.has(k) && !user.canMarkAttendance) return false;
    return true;
  });
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
