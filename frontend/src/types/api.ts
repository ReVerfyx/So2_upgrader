/** Типы ответов API. Совпадают с DTO бэкенда. */

/** Сумма во внутренней валюте: монеты (1 монета = 1 ₽). */
export interface Money {
  /** Копейки целым числом строкой. */
  minor: string;
  /** Монеты строкой («1234.50»). */
  coins: string;
  formatted: string;
  currency: 'COIN';
}

/** Сумма в TON — используется только при пополнении. */
export interface TonMoney {
  nano: string;
  ton: string;
  formatted: string;
  currency: 'TON';
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'arcane' | 'contraband';
export type Condition = 'factory_new' | 'minimal_wear' | 'field_tested' | 'well_worn' | 'battle_scarred';

export interface Item {
  id: string;
  slug: string;
  name: string;
  weapon: string;
  rarity: Rarity;
  condition: Condition;
  imageUrl: string;
  price: Money;
  priceMinor: string;
  isActive: boolean;
  isWithdrawable: boolean;
  description: string | null;
}

export interface TargetItem extends Item {
  chancePercent: number;
  multiplier: number;
}

export type InventoryStatus = 'available' | 'locked' | 'consumed' | 'withdrawn';

export interface InventoryItem {
  id: string;
  itemId: string;
  name: string;
  slug: string;
  weapon: string;
  rarity: Rarity;
  condition: Condition;
  imageUrl: string;
  status: InventoryStatus;
  price: Money;
  priceMinor: string;
  currentPrice: Money;
  acquiredFrom: string;
  isWithdrawable: boolean;
  createdAt: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: 'user' | 'admin';
  avatarUrl: string | null;
  gameNickname: string | null;
  contact: string | null;
  createdAt: string;
}

export interface UserStats {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  bestWin: Money;
  wagered: Money;
}

export interface Fairness {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export interface Me {
  user: User;
  balance: Money;
  locked: Money;
  inventory: { count: number; value: Money };
  stats: UserStats;
  fairness: Fairness;
  csrfToken?: string;
}

export interface UpgradeQuote {
  sourceType: 'item' | 'balance';
  sourceName: string;
  sourcePrice: Money;
  sourcePriceMinor: string;
  target: Item;
  chancePpm: number;
  chancePercent: number;
  multiplier: number;
  multiplierBp: number;
  profit: Money;
  potentialWin: Money;
}

export interface UpgradeResult {
  id: string;
  success: boolean;
  chancePpm: number;
  chancePercent: number;
  rollPpm: number;
  rollPercent: number;
  multiplier: number;
  target: Item;
  sourceName: string;
  sourcePrice: Money;
  wonInventoryId: string | null;
  balanceAfter: Money;
  fairness: Fairness & { serverSeed: string | null };
  createdAt: string;
}

export interface UpgradeHistoryEntry {
  id: string;
  sourceType: 'item' | 'balance';
  sourceName: string;
  sourcePrice: Money;
  targetName: string;
  targetImage: string;
  targetRarity: Rarity;
  targetPrice: Money;
  chancePercent: number;
  rollPercent: number;
  multiplier: number;
  success: boolean;
  createdAt: string;
  fairness: Fairness & { serverSeed: string | null };
  user?: { username: string; displayName: string; avatarUrl: string | null };
}

export type DepositStatus = 'pending' | 'confirmed' | 'failed' | 'expired';

export interface Deposit {
  id: string;
  paymentId: string;
  walletAddress: string;
  /** Сумма к оплате в TON. */
  amount: TonMoney;
  amountTon: string;
  /** Фактически полученная сумма в TON. */
  received: TonMoney;
  /** Зачислено на баланс в монетах. */
  credited: Money;
  /** Курс: монет за 1 TON. */
  coinsPerTon: string;
  /** Сколько монет будет зачислено при полной оплате. */
  expectedCoins: Money;
  status: DepositStatus;
  txHash: string | null;
  confirmations: number;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  secondsLeft: number;
  paymentUrl: string;
  qrCode?: string;
}

export type WithdrawalStatus = 'pending' | 'processing' | 'completed' | 'rejected';

export interface Withdrawal {
  id: string;
  itemId: string;
  itemName: string;
  imageUrl: string | null;
  rarity: Rarity | null;
  price: Money;
  gameNickname: string;
  contact: string | null;
  status: WithdrawalStatus;
  statusLabel: string;
  adminComment: string | null;
  txHash: string | null;
  createdAt: string;
  processedAt: string | null;
  queuePosition?: number;
  user?: { id: string; username: string; displayName: string };
}

export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'upgrade_stake'
  | 'upgrade_win'
  | 'upgrade_loss'
  | 'item_sell'
  | 'admin_adjust'
  | 'refund'
  | 'bonus'
  | 'test_credit';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  status: string;
  referenceType: string | null;
  referenceId: string | null;
  txHash: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface AppConfig {
  testMode: boolean;
  minDepositTon: number;
  depositTtlMinutes: number;
  tonConfigured: boolean;
  googleAuthEnabled: boolean;
  maintenance: boolean;
  announcement: string;
}

export interface UpgradeSettings {
  houseEdgePercent: number;
  minChancePercent: number;
  maxChancePercent: number;
  maxMultiplier: number;
  minStake: Money;
}

/* ------------------------------ Админка ---------------------------------- */

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: 'user' | 'admin';
  isBlocked: boolean;
  blockReason: string | null;
  balance: Money;
  inventoryCount: number;
  upgradesCount: number;
  depositedTotal: Money;
  authProvider: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminStats {
  users: { total: number; blocked: number; newToday: number };
  balance: { totalNano: Money };
  deposits: { pending: number; confirmedTotal: Money; today: Money };
  withdrawals: { pending: number; processing: number; completed: number };
  upgrades: { total: number; today: number; winRate: number };
  errors: { last24h: number };
}

export interface AdminDeposit {
  id: string;
  paymentId: string;
  status: DepositStatus;
  amountTon: TonMoney;
  receivedTon: TonMoney;
  credited: Money;
  txHash: string | null;
  username: string;
  userId: string;
  createdAt: string;
  confirmedAt: string | null;
  expiresAt: string;
}

export interface AdminUpgrade {
  id: string;
  createdAt: string;
  username: string;
  targetName: string;
  sourceType: 'item' | 'balance';
  success: boolean;
  chancePercent: number;
  rollPercent: number;
  multiplier: number;
  sourcePrice: Money;
  targetPrice: Money;
}

export interface AdminLog {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  created_at: string;
  admin_username: string | null;
}

export interface ErrorLog {
  id: string;
  level: string;
  code: string | null;
  message: string;
  context: Record<string, unknown>;
  request_id: string | null;
  user_id: string | null;
  created_at: string;
}

/** Состояние курса TON → монеты. */
export interface RateInfo {
  coinsPerTon: string;
  marketRubPerTon: number | null;
  spreadPercent: number;
  auto: boolean;
  source: string;
  updatedAt: string | null;
  ageMinutes: number | null;
  stale: boolean;
}
