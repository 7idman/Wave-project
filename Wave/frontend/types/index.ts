export interface User { name:string; email:string; id:number; initials:string; firstName?:string|null; lastName?:string|null; emailVerified?:boolean; phone?:string; avatarUrl?:string; role?:string; kycStatus?:string;permissions?: Record<string, boolean>; totpEnabled?:boolean; }
export interface Price { price:number; change24h:number; assetType?:string; }
export interface Holding { symbol:string; amount:number; price:number; change24h:number; value:number; }
export interface Portfolio { cashBalance:number; totalPortfolioValue:number; totalValue:number; holdings:Holding[]; }
export interface Tx { id:number; type:string; symbol:string; amount:number; price:number; fee?:number; total:number; created_at:string; status:string; reference_id?:string; }
export interface Strategy { id:number; name:string; description:string; fee:number; status:string; }
export interface CopierHolding { symbol:string; amount:number; price:number; value:number; }
export interface CopierTrade { symbol:string; side:string; amount:number; price:number; value:number; createdAt:string; }
export interface CopierPortfolio { portfolioId:number; strategyId:number; strategyName:string; fee:number; cashBalance:number; holdingsValue:number; totalValue:number; holdings:CopierHolding[]; contributed:number; unrealizedPnl:number; trades:CopierTrade[]; }
export interface ManagedAllocation { symbol:string; value:number; pct:number; }
export interface ManagedPortfolio { portfolioId:number; createdAt:string; cashBalance:number; holdingsValue:number; totalValue:number; allocation:ManagedAllocation[]; }
export interface TierInfo { lifetimeDeposits:number; tier:string|null; tierName:string; next:{tier:string;tierName:string;min:number;remaining:number}|null; lockedBonus:number; bonusGrants:{amount:number;unlock_at:string}[]; }
export interface BalancePoint { date:string; balance:number; }
export interface WalletAnalytics { totalDeposited:number; depositCount:number; largestDeposit:number; averageDeposit:number; totalWithdrawn:number; withdrawalCount:number; failedWithdrawalAttempts:number; totalBonusEarned:number; netFlow:number; }
