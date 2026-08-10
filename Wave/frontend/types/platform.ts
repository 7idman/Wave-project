export interface ChartPt { t:number; v:number; }
export interface AppSettings { notifications:boolean; currency:string; theme:string; language:string; }
export interface SiteUpdate { id:number|string; title:string; body:string; created_at:string; }
export interface LoginEvent { id:number|string; device:string; ip?:string; login_at:string; logout_at?:string|null; current?:boolean; trusted?:boolean; }
export interface Activity { id:number|string; type:string; label:string; amount:number; created_at:string; }
