import { Expense } from './expense.entity';
import { Group } from './group.entity';
import { GroupMember } from './group-member.entity';
import { Profile } from './profile.entity';
import { User } from './user.entity';

export type PublicUser = Pick<
  User,
  | 'id'
  | 'email'
  | 'username'
  | 'phoneNumber'
  | 'displayName'
  | 'status'
  | 'lastLoginAt'
  | 'createdAt'
  | 'updatedAt'
>;

export interface JwtPayload {
  userId: string;
  email?: string;
  refreshId?: string;
  iat?: number;
  exp?: number;
}

export interface LoginResponse {
  accessToken: string;
  /** Absent/ignored on web once the client reads the HttpOnly cookie instead (AU-6). */
  refreshToken?: string;
  /** Present only when `auth.dualTransport` is ON — echoed back on the next refresh. */
  csrfToken?: string;
  user: PublicUser;
}

export interface RefreshTokenResponse {
  accessToken: string;
  /** Omitted on the cookie-transport refresh response — the rotated cookie carries it instead. */
  refreshToken?: string;
  csrfToken?: string;
}

export interface CurrentUserResponse {
  user: PublicUser;
  profile: Profile;
}

export type RegisterResponse = PublicUser;

export interface PaginationMeta {
  totalItems: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta?: PaginationMeta;
}

export interface ErrorResponse {
  statusCode: number;
  errorCode?: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  timestamp?: string;
  path?: string;
}

export type GetExpensesResponse = PaginatedResponse<Expense>;

export interface ExpenseAnalyticsPoint {
  month: string;
  category: string;
  total: number;
  currency: string;
}

export type MonthlyAnalyticsPoint = Omit<ExpenseAnalyticsPoint, 'category'>;

export type CategoryAnalyticsPoint = Omit<ExpenseAnalyticsPoint, 'month'>;

export interface BalanceEntry {
  userId: string;
  currency: string;
  netBalance: number;
}

export interface SuggestedSettlementResponse {
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
}

export interface GroupBalancesResponse {
  balances: BalanceEntry[];
  suggestedSettlements: SuggestedSettlementResponse[];
}

export interface GroupAuditLogEntry {
  id: string;
  action: string;
  actorDisplayName?: string;
  metadata?: {
    title?: string;
    newTitle?: string;
    amountTotal?: number;
    currency?: string;
  };
  createdAt: string | Date;
}

export type GroupAuditLogResponse = PaginatedResponse<GroupAuditLogEntry>;

export interface InviteDetailsResponse {
  id: string;
  name: string;
  description?: string;
  ownerName: string;
  groupType: Group['groupType'];
  currency: string;
  wrappedGroupKey?: string | null;
  members?: Array<{
    email?: string;
    phoneNumber?: string;
    displayName?: string;
    role: GroupMember['role'];
  }>;
}

export interface PendingInvitationResponse extends InviteDetailsResponse {
  membershipId: string;
}

export interface CarryForwardBalance {
  groupMemberId: string;
  /** Null for a pending (Contact-backed) member — they have no User account. */
  userId: string | null;
  displayName: string | null;
  paid: number;
  expected: number;
  netBalance: number;
  percentage: number;
  currency: string;
  /** This month's own activity (paid − expected), excluding carried-in balance. */
  currentMonthNet: number;
  /**
   * Net from materialized `isCarryForward` rollover expenses. Retained for
   * reference; the running-balance breakdown uses `openingBalance` instead.
   */
  carryForwardNet: number;
  /** Running balance carried in from all prior months (this period's Opening). */
  openingBalance: number;
  /** openingBalance + currentMonthNet — the balance through this period. */
  closingBalance: number;
  /** Full-history running balance, independent of the selected month (Overall). */
  overallBalance: number;
}

export interface GroupContributionResponse {
  memberId: string;
  userId?: string;
  displayName?: string;
  role?: GroupMember['role'];
  percentage: number;
  amount?: number;
}

export interface FriendCurrencyDetail {
  groupId: string;
  groupName: string;
  amount: number;
  currency: string;
}

export interface FriendBalanceResponse {
  friendId: string;
  displayName: string;
  email: string;
  netBalance: number;
  currencyDetails: FriendCurrencyDetail[];
  isExpanded?: boolean;
}

/**
 * One person the caller has a financial relationship with, for the People
 * dashboard/list. `netBalance > 0` → they owe the caller; `< 0` → the caller
 * owes them; `0` → settled. Amounts are per currency.
 */
export interface PersonSummaryResponse {
  counterpartyUserId: string;
  displayName: string;
  email: string;
  currency: string;
  netBalance: number;
  direction: 'owes_you' | 'you_owe' | 'settled';
}

/** Aggregate People-dashboard payload: totals + top people. */
export interface PeopleOverviewResponse {
  /** The dominant currency the headline totals are reported in. */
  currency: string;
  totalYouAreOwed: number;
  totalYouOwe: number;
  /**
   * True when relationships span more than one currency. The totals report only
   * `currency`; the client should surface a caveat so mixed-currency balances
   * are never silently rolled into one misleading number.
   */
  hasMultipleCurrencies: boolean;
  people: PersonSummaryResponse[];
}

/**
 * Decomposition of the net balance with one person (per currency), for the
 * person-detail header breakdown. `net = groupObligations + directLending
 * + settlements` where settlements are negative.
 */
export interface PersonBalanceBreakdown {
  currency: string;
  groupObligations: number;
  directLending: number;
  settlements: number;
  net: number;
}

/** One line in a person's chronological relationship history. */
export interface PersonHistoryItem {
  id: string;
  source: 'group_expense' | 'direct' | 'settlement';
  entryType?: 'lend' | 'borrow' | 'settlement';
  /** Signed from the caller's perspective: `> 0` increases what they owe you. */
  amount: number;
  currency: string;
  date: string;
  note?: string;
  /** Set when `source === 'group_expense'`. */
  groupId?: string;
  groupName?: string;
  expenseId?: string;
  /** Expense title — E2EE ciphertext; decrypt client-side via the group key. */
  title?: string;
  /** Decryption hints so the client can reuse the standard expense decryptor. */
  encryptionScope?: 'personal' | 'group' | 'direct_shared';
  groupKeyVersionId?: string;
}

/** Full person-detail payload: header + breakdown + paginated history. */
export interface PersonDetailResponse {
  counterpartyUserId: string;
  displayName: string;
  email: string;
  currency: string;
  netBalance: number;
  direction: 'owes_you' | 'you_owe' | 'settled';
  breakdown: PersonBalanceBreakdown[];
  history: PersonHistoryItem[];
}

export interface UpdateContributionsPayload {
  ledgerMonth: string;
  contributions: Array<{
    memberId: string;
    percentage: number;
  }>;
}

export interface UserSearchResult {
  id: string;
  email: string;
  username?: string;
  phoneNumber?: string;
  displayName?: string;
}
