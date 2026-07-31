export interface User { name:string; email:string; initials:string; phone?:string; avatarUrl?:string; role?:string; kycStatus?:string; }
export interface Price { price:number; change24h:number; }
export interface Holding { symbol:string; amount:number; price:number; change24h:number; value:number; }
export interface Portfolio { cashBalance:number; totalPortfolioValue:number; totalValue:number; holdings:Holding[]; }
export interface Tx { id:number; type:string; symbol:string; amount:number; price:number; total:number; created_at:string; status:string; }
