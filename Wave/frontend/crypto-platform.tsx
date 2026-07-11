import { useState, useEffect, useCallback, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

/* ── Fonts ── */
const _fl = document.createElement("link");
_fl.rel = "stylesheet";
_fl.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800;900&display=swap";
document.head.appendChild(_fl);

/* ── Types ── */
interface CoinMeta    { name:string; color:string; symbol:string; }
interface Price       { price:number; change24h:number; }
interface Holding     { symbol:string; amount:number; price:number; change24h:number; value:number; }
interface Portfolio   { cashBalance:number; totalPortfolioValue:number; totalValue:number; holdings:Holding[]; }
interface Tx          { id:number; type:string; symbol:string; amount:number; price:number; total:number; created_at:string; status:string; }
interface User        { name:string; email:string; initials:string; phone?:string; avatarUrl?:string; }
interface ChartPt     { t:number; v:number; }
interface AppSettings { twoFA:boolean; notifications:boolean; currency:string; theme:string; language:string; }

/* ── Language translations ── */
const LANG:Record<string,Record<string,string>>={
  English:{dashboard:"Dashboard",trade:"Trade",portfolio:"Portfolio",history:"Transaction History",settings:"Settings",privacy:"Privacy Policy",home:"Home",totalBalance:"Total Balance",portfolioValue:"Portfolio Value",cashBalance:"Cash Balance",available:"Available",invested:"Invested",liveMarkets:"Live Markets",myHoldings:"My Holdings",viewAll:"View all →",asset:"Asset",amount:"Amount",marketPrice:"Market Price",fee:"Fee",totalCost:"Total Cost",youReceive:"You Receive",buy:"Buy",sell:"Sell",deposit:"Deposit",withdraw:"Withdraw",processing:"Processing…",availableCash:"Available cash",balance:"Balance",paymentMethod:"Payment Method",withdrawTo:"Withdraw To",signOut:"Sign Out",editProfile:"Edit Profile",changePassword:"Change Password",security:"Security",preferences:"Preferences",kyc:"KYC Verification",account:"Account",morning:"morning",afternoon:"afternoon",evening:"evening"},
  French:{dashboard:"Tableau de bord",trade:"Trader",portfolio:"Portefeuille",history:"Historique",settings:"Paramètres",privacy:"Politique de confidentialité",home:"Accueil",totalBalance:"Solde total",portfolioValue:"Valeur du portefeuille",cashBalance:"Solde en espèces",available:"Disponible",invested:"Investi",liveMarkets:"Marchés en direct",myHoldings:"Mes actifs",viewAll:"Voir tout →",asset:"Actif",amount:"Montant",marketPrice:"Prix du marché",fee:"Frais",totalCost:"Coût total",youReceive:"Vous recevez",buy:"Acheter",sell:"Vendre",deposit:"Dépôt",withdraw:"Retrait",processing:"Traitement…",availableCash:"Espèces disponibles",balance:"Solde",paymentMethod:"Mode de paiement",withdrawTo:"Retirer vers",signOut:"Déconnexion",editProfile:"Modifier le profil",changePassword:"Changer le mot de passe",security:"Sécurité",preferences:"Préférences",kyc:"Vérification KYC",account:"Compte",morning:"matin",afternoon:"après-midi",evening:"soir"},
  Spanish:{dashboard:"Panel",trade:"Operar",portfolio:"Cartera",history:"Historial",settings:"Configuración",privacy:"Política de privacidad",home:"Inicio",totalBalance:"Saldo total",portfolioValue:"Valor del portafolio",cashBalance:"Saldo en efectivo",available:"Disponible",invested:"Invertido",liveMarkets:"Mercados en vivo",myHoldings:"Mis activos",viewAll:"Ver todo →",asset:"Activo",amount:"Monto",marketPrice:"Precio de mercado",fee:"Tarifa",totalCost:"Costo total",youReceive:"Recibes",buy:"Comprar",sell:"Vender",deposit:"Depositar",withdraw:"Retirar",processing:"Procesando…",availableCash:"Efectivo disponible",balance:"Saldo",paymentMethod:"Método de pago",withdrawTo:"Retirar a",signOut:"Cerrar sesión",editProfile:"Editar perfil",changePassword:"Cambiar contraseña",security:"Seguridad",preferences:"Preferencias",kyc:"Verificación KYC",account:"Cuenta",morning:"mañana",afternoon:"tarde",evening:"noche"},
  Portuguese:{dashboard:"Painel",trade:"Negociar",portfolio:"Carteira",history:"Histórico",settings:"Configurações",privacy:"Política de privacidade",home:"Início",totalBalance:"Saldo total",portfolioValue:"Valor do portfólio",cashBalance:"Saldo em dinheiro",available:"Disponível",invested:"Investido",liveMarkets:"Mercados ao vivo",myHoldings:"Meus ativos",viewAll:"Ver tudo →",asset:"Ativo",amount:"Valor",marketPrice:"Preço de mercado",fee:"Taxa",totalCost:"Custo total",youReceive:"Você recebe",buy:"Comprar",sell:"Vender",deposit:"Depositar",withdraw:"Sacar",processing:"Processando…",availableCash:"Dinheiro disponível",balance:"Saldo",paymentMethod:"Método de pagamento",withdrawTo:"Sacar para",signOut:"Sair",editProfile:"Editar perfil",changePassword:"Alterar senha",security:"Segurança",preferences:"Preferências",kyc:"Verificação KYC",account:"Conta",morning:"manhã",afternoon:"tarde",evening:"noite"},
};

/* ── API ── */
// Uses Vite proxy (/api → http://localhost:4000/api) — no CORS issues
const API_BASE =  import.meta.env.VITE_API_URL || "/api";
let _access:string|null = localStorage.getItem("wave_access")  || null;
let _refresh:string|null = localStorage.getItem("wave_refresh") || null;
const api = {
  setTokens(a:string,r:string){ _access=a; _refresh=r; localStorage.setItem("wave_access",a); localStorage.setItem("wave_refresh",r); },
  clearTokens(){ _access=null; _refresh=null; localStorage.removeItem("wave_access"); localStorage.removeItem("wave_refresh"); },
  async request(path:string, opts:RequestInit={}):Promise<any>{
    const h:Record<string,string>={"Content-Type":"application/json",...(opts.headers as Record<string,string>||{})};
    if(_access) h["Authorization"]=`Bearer ${_access}`;
    let res=await fetch(`${API_BASE}${path}`,{...opts,headers:h});
    if(res.status===401&&_refresh){
      const r=await fetch(`${API_BASE}/auth/refresh`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({refreshToken:_refresh})});
      if(r.ok){const d=await r.json();_access=d.accessToken;h["Authorization"]=`Bearer ${_access}`;res=await fetch(`${API_BASE}${path}`,{...opts,headers:h});}
    }
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||"Something went wrong");
    return data;
  },
  get:(p:string)=>api.request(p),
  post:(p:string,b:any)=>api.request(p,{method:"POST",body:JSON.stringify(b)}),
  patch:(p:string,b:any)=>api.request(p,{method:"PATCH",body:JSON.stringify(b)}),
};

/* ── Coins ── */
const COINS:Record<string,CoinMeta>={
  BTC:{name:"Bitcoin",  color:"#F7931A",symbol:"BTC"},
  ETH:{name:"Ethereum", color:"#627EEA",symbol:"ETH"},
  SOL:{name:"Solana",   color:"#9945FF",symbol:"SOL"},
  ADA:{name:"Cardano",  color:"#0D3B9A",symbol:"ADA"},
  LINK:{name:"Chainlink",color:"#2A5ADA",symbol:"LINK"},
};

/* ── Chart data per time range ── */
type Range = "1H"|"1D"|"1W"|"1M";
const RANGE_POINTS:Record<Range,number>={
  "1H":20,"1D":40,"1W":80,"1M":120,
};
const RANGE_VOL:Record<Range,number>={
  "1H":.003,"1D":.008,"1W":.018,"1M":.035,
};

/* ── Fallback data ── */
const FB_PRICES:Record<string,Price>={BTC:{price:67420.50,change24h:2.34},ETH:{price:3521.80,change24h:-1.12},SOL:{price:178.40,change24h:5.67},ADA:{price:0.612,change24h:-0.45},LINK:{price:18.92,change24h:3.21}};
const FB_PORT:Portfolio={cashBalance:12450,totalPortfolioValue:18621,totalValue:31071,holdings:[{symbol:"BTC",amount:0.12,price:67420.50,change24h:2.34,value:8090},{symbol:"ETH",amount:1.5,price:3521.80,change24h:-1.12,value:5282},{symbol:"SOL",amount:20,price:178.40,change24h:5.67,value:3568}]};
const FB_TXS:Tx[]=[{id:1,type:"buy",symbol:"BTC",amount:0.05,price:65200,total:3263,created_at:"2025-03-28",status:"completed"},{id:2,type:"sell",symbol:"ETH",amount:0.8,price:3400,total:2697,created_at:"2025-03-25",status:"completed"},{id:3,type:"buy",symbol:"SOL",amount:10,price:165,total:1651,created_at:"2025-03-20",status:"completed"},{id:4,type:"buy",symbol:"ETH",amount:0.5,price:3510,total:1756,created_at:"2025-03-15",status:"completed"}];

const genChart=(base:number,n:number,vol:number):ChartPt[]=>
  Array.from({length:n},(_,i)=>{base*=1+(Math.random()-.49)*vol;return{t:i,v:parseFloat(base.toFixed(2))};});

/* ── Market stats per coin ── */
const COIN_STATS:Record<string,{cap:string;vol:string;supply:string}>={
  BTC:{cap:"$1.32T",vol:"$48.2B",supply:"19.7M"},
  ETH:{cap:"$423B", vol:"$22.1B",supply:"120.2M"},
  SOL:{cap:"$82B",  vol:"$5.4B", supply:"445M"},
  ADA:{cap:"$22B",  vol:"$1.1B", supply:"35.2B"},
  LINK:{cap:"$11B", vol:"$720M", supply:"587M"},
};

/* ── Coin SVG Icons ── */
const CoinIcon=({symbol,size=32}:{symbol:string;size?:number})=>{
  const icons:Record<string,JSX.Element>={
    BTC:<svg width={size} height={size} viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#F7931A"/><path d="M21.5 14.2c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.6-.4-.6 2.6-1.3-.3.6-2.6-1.7-.4-.7 2.7-1-.3-2.2-.5-.4 1.7s1.2.3 1.2.3c.7.2.8.6.8.9l-.8 3.4c0 .1.1.1.1.1h-.2l-.9 3.6c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.8 2.1.5 1.1.3-.7 2.8 1.7.4.7-2.8 1.3.3-.7 2.8 1.7.4.7-2.8c2.8.5 4.8.3 5.7-2.2.7-2-.1-3.1-1.5-3.8.9-.4 1.7-1 1.9-2.2zm-3.4 4.8c-.5 2-3.9 1-5 .7l.9-3.5c1.1.3 4.6.9 4.1 2.8zm.5-4.8c-.5 1.8-3.3 1-4.2.7l.8-3.2c.9.2 3.8.7 3.4 2.5z" fill="#fff"/></svg>,
    ETH:<svg width={size} height={size} viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path d="M16 5.6l-.1.4v13.4l.1.1 6.3-3.7L16 5.6z" fill="#fff" opacity=".6"/><path d="M16 5.6L9.7 15.8l6.3 3.7V5.6z" fill="#fff"/><path d="M16 21.3l-.1.1v5l.1.2 6.3-8.9-6.3 3.6z" fill="#fff" opacity=".6"/><path d="M16 26.6v-5.3l-6.3-3.6 6.3 8.9z" fill="#fff"/></svg>,
    SOL:<svg width={size} height={size} viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#9945FF"/><path d="M9.5 21.5h13a.5.5 0 0 1 .35.85l-2 2a.5.5 0 0 1-.35.15h-13a.5.5 0 0 1-.35-.85l2-2a.5.5 0 0 1 .35-.15zm13-6.5h-13a.5.5 0 0 0-.35.15l-2 2a.5.5 0 0 0 .35.85h13a.5.5 0 0 0 .35-.15l2-2a.5.5 0 0 0-.35-.85zm-13-4h13a.5.5 0 0 0 .35-.15l2-2a.5.5 0 0 0-.35-.85h-13a.5.5 0 0 0-.35.15l-2 2a.5.5 0 0 0 .35.85z" fill="url(#sg)"/><defs><linearGradient id="sg" x1="7" y1="7" x2="25" y2="25" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#00FFA3"/><stop offset="100%" stopColor="#DC1FFF"/></linearGradient></defs></svg>,
    ADA:<svg width={size} height={size} viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#0D3B9A"/><circle cx="16" cy="9" r="1.8" fill="#fff"/><circle cx="16" cy="23" r="1.8" fill="#fff"/><circle cx="10" cy="12.5" r="1.8" fill="#fff"/><circle cx="22" cy="12.5" r="1.8" fill="#fff"/><circle cx="10" cy="19.5" r="1.8" fill="#fff"/><circle cx="22" cy="19.5" r="1.8" fill="#fff"/><circle cx="16" cy="16" r="2.5" fill="#fff" opacity=".4"/></svg>,
    LINK:<svg width={size} height={size} viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#2A5ADA"/><path d="M16 6l-2 1.2-5.8 3.3-2 1.2v8.6l2 1.2 5.8 3.3 2 1.2 2-1.2 5.8-3.3 2-1.2v-8.6l-2-1.2-5.8-3.3L16 6zm0 3.5l4.3 2.5v5L16 19.5l-4.3-2.5v-5L16 9.5z" fill="#fff"/></svg>,
  };
  if(icons[symbol]) return icons[symbol];
  const c=COINS[symbol];
  return <div style={{width:size,height:size,borderRadius:"50%",background:c?.color||"#333",display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*.35,fontWeight:800,color:"#fff",flexShrink:0}}>{symbol[0]}</div>;
};

/* ── Wave Logo ── */
const WaveLogo=({size=28}:{size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <rect x="7" y="14" width="4" height="11" rx="2" fill="#818CF8" opacity="0.7"/>
    <rect x="14" y="9" width="4" height="16" rx="2" fill="#6366F1"/>
    <rect x="21" y="6" width="4" height="19" rx="2" fill="#818CF8" opacity="0.85"/>
  </svg>
);

const useWW=():number=>{const[w,setW]=useState(window.innerWidth);useEffect(()=>{const h=()=>setW(window.innerWidth);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);return w;};
const CT=({active,payload}:any)=>active&&payload?.length?<div style={{background:"rgba(15,17,26,.95)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,padding:"7px 12px",fontSize:12,color:"#fff",fontWeight:600}}>${payload[0].value.toLocaleString()}</div>:null;
const Toggle=({on,onToggle}:{on:boolean;onToggle:()=>void})=>(
  <button onClick={onToggle} aria-pressed={on} style={{width:46,height:26,borderRadius:13,position:"relative",cursor:"pointer",border:"none",outline:"none",background:on?"linear-gradient(135deg,#818CF8,#6366F1)":"rgba(255,255,255,.08)",transition:"background .2s",flexShrink:0}}>
    <div style={{position:"absolute",top:3,left:on?23:3,width:20,height:20,borderRadius:"50%",background:"white",transition:"left .2s",boxShadow:"0 2px 6px rgba(0,0,0,.3)"}}/>
  </button>
);

/* ── Modal ── */
const Modal=({open,onClose,title,children}:{open:boolean;onClose:()=>void;title:string;children:React.ReactNode})=>{
  if(!open) return null;
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(6px)"}} onClick={onClose}>
      <div style={{background:"#161822",border:"1px solid rgba(255,255,255,.1)",borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:460,position:"relative",boxShadow:"0 24px 60px rgba(0,0,0,.5)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <span style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:800,fontSize:18,color:"#F1F2F8"}}>{title}</span>
          <button onClick={onClose} style={{width:30,height:30,borderRadius:"50%",background:"rgba(255,255,255,.08)",border:"none",cursor:"pointer",color:"#9496A8",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};

/* ── CSS ── */
const css=`
  :root{--bg:#0F1117;--bg2:#161822;--bg3:#1C1E2E;--surface:rgba(255,255,255,.04);--surface2:rgba(255,255,255,.07);--border:rgba(255,255,255,.08);--border2:rgba(255,255,255,.13);--text:#F1F2F8;--text2:#9496A8;--text3:#5C5E72;--indigo:#6366F1;--indigo2:#818CF8;--green:#10B981;--red:#EF4444;--yellow:#F59E0B;--purple:#8B5CF6;--r:18px;--r2:12px;}
  /* ── LIGHT THEME ── */
  .theme-light{--bg:#F5F5F7;--bg2:#FFFFFF;--bg3:#F0F0F2;--surface:rgba(0,0,0,.03);--surface2:rgba(0,0,0,.05);--border:rgba(0,0,0,.06);--border2:rgba(0,0,0,.1);--text:#0A0A0B;--text2:#5C5E68;--text3:#8B8D96;--indigo:#111114;--indigo2:#111114;--r:22px;--r2:16px;}
  /* Cards: soft white surface, subtle shadow instead of a hard border — matches the airy reference look */
  .theme-light .gcard{background:#FFFFFF;box-shadow:0 2px 16px rgba(0,0,0,.05);}
  .theme-light .gcard::before{display:none;}
  .theme-light .stat{background:#FFFFFF;box-shadow:0 2px 16px rgba(0,0,0,.05);}
  .theme-light .stat::before{display:none;}
  .theme-light .sidebar{background:#FFFFFF;border-right-color:rgba(0,0,0,.06);}
  .theme-light .mtop,.theme-light .bnav{background:#FFFFFF;border-color:rgba(0,0,0,.06);}
  .theme-light .mitem,.theme-light .txc,.theme-light .hi{background:#FFFFFF;}
  .theme-light .hi::before{display:none;}
  /* Primary accent is black, not indigo — matches the reference's black "+" button and dark text emphasis */
  .theme-light .btn-primary{background:#111114;box-shadow:0 4px 16px rgba(0,0,0,.18);}
  .theme-light .btn-primary:hover{box-shadow:0 8px 24px rgba(0,0,0,.25);}
  .theme-light .btn-ghost{background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.08);color:#0A0A0B;}
  .theme-light .btn-ghost:hover{background:rgba(0,0,0,.07);}
  .theme-light select option{background:#FFFFFF;color:#0A0A0B;}
  .theme-light .chip{border-color:rgba(0,0,0,.1);color:#5C5E68;}
  .theme-light .chip.active{background:#111114;border-color:#111114;color:#fff;}
  .theme-light .inp,.theme-light .sel,.theme-light .tinp{background:#F7F7F8;border-color:rgba(0,0,0,.08);color:#0A0A0B;}
  .theme-light .sitem{color:#5C5E68;}
  .theme-light .sitem:hover{background:rgba(0,0,0,.04);color:#0A0A0B;}
  /* Active sidebar/nav item: soft indigo-tinted background but keep it subtle — brand touch without overpowering the black/white base */
  .theme-light .sitem.active{background:rgba(99,102,241,.08);color:#4F46E5;}
  .theme-light .mchip{background:#111114;border-color:#111114;color:#fff;}
  .theme-light .tchip{background:rgba(99,102,241,.08);border-color:rgba(99,102,241,.2);color:#4F46E5;}
  /* Slightly more breathing room on desktop only — mobile grid spacing left untouched to avoid layout shifts */
  @media(min-width:641px){
    .theme-light .stats{gap:18px;}
    .theme-light .crow{gap:20px;}
    .theme-light .hgrid{gap:18px;}
    .theme-light .gcard{padding:28px;}
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html{-webkit-text-size-adjust:100%;}
  html,body{background:var(--bg);overflow-x:hidden;}
  .app{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-font-smoothing:antialiased;}
  .gcard{position:relative;border-radius:var(--r);background:var(--bg2);padding:24px;}
  .gcard::before{content:'';position:absolute;inset:0;border-radius:var(--r);padding:1px;background:linear-gradient(135deg,rgba(99,102,241,.4),rgba(139,92,246,.2),rgba(255,255,255,.05));-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:none;cursor:pointer;font-family:'Inter',sans-serif;font-weight:600;border-radius:100px;transition:all .18s;-webkit-tap-highlight-color:transparent;white-space:nowrap;}
  .btn-primary{background:linear-gradient(135deg,#6366F1,#8B5CF6);color:white;padding:13px 24px;font-size:14px;box-shadow:0 4px 20px rgba(99,102,241,.35);}
  .btn-primary:hover{box-shadow:0 8px 30px rgba(99,102,241,.5);transform:translateY(-1px);}
  .btn-primary:disabled{opacity:.5;transform:none;cursor:not-allowed;}
  .btn-ghost{background:var(--surface2);color:var(--text);padding:11px 20px;font-size:13px;border:1px solid var(--border2);}
  .btn-ghost:hover{background:var(--surface);border-color:var(--indigo2);}
  .btn-sm{padding:8px 16px;font-size:12px;}
  .btn-lg{padding:15px 28px;font-size:15px;}
  .btn-danger{background:rgba(239,68,68,.1);color:var(--red);border:1px solid rgba(239,68,68,.2);padding:10px 18px;font-size:13px;}
  .btn-danger:hover{background:var(--red);color:#fff;}
  .btn-action{background:rgba(99,102,241,.1);color:var(--indigo2);border:1px solid rgba(99,102,241,.2);padding:10px 18px;font-size:13px;}
  .btn-action:hover{background:var(--indigo);color:#fff;}
  .stat{border-radius:var(--r);background:var(--bg2);padding:22px;position:relative;overflow:hidden;}
  .stat::before{content:'';position:absolute;inset:0;border-radius:var(--r);padding:1px;background:linear-gradient(135deg,rgba(99,102,241,.3),rgba(255,255,255,.04));-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;}
  .stat-glow{position:absolute;top:-20px;right:-20px;width:80px;height:80px;border-radius:50%;filter:blur(30px);opacity:.4;}
  .stat-label{font-size:11px;font-weight:600;color:var(--text2);letter-spacing:.6px;text-transform:uppercase;margin-bottom:10px;}
  .stat-value{font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:26px;color:var(--text);line-height:1;}
  .stat-sub{font-size:12px;font-weight:600;margin-top:8px;display:flex;align-items:center;gap:4px;}
  .badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:100px;font-size:10px;font-weight:700;}
  .badge-green{background:rgba(16,185,129,.12);color:#10B981;border:1px solid rgba(16,185,129,.2);}
  .badge-red{background:rgba(239,68,68,.1);color:#EF4444;border:1px solid rgba(239,68,68,.2);}
  .badge-blue{background:rgba(99,102,241,.12);color:#818CF8;border:1px solid rgba(99,102,241,.2);}
  .badge-purple{background:rgba(139,92,246,.1);color:#A78BFA;border:1px solid rgba(139,92,246,.2);}
  .badge-gray{background:rgba(255,255,255,.06);color:var(--text2);border:1px solid var(--border);}
  .inp{width:100%;padding:13px 16px;background:var(--surface);border:1px solid var(--border2);border-radius:var(--r2);color:var(--text);font-size:16px;font-weight:500;outline:none;-webkit-appearance:none;transition:all .18s;font-family:'Inter',sans-serif;}
  .inp:focus{border-color:var(--indigo2);box-shadow:0 0 0 3px rgba(99,102,241,.15);background:var(--bg3);}
  .inp::placeholder{color:var(--text3);}
  .sel{width:100%;padding:13px 16px;background:var(--surface);border:1px solid var(--border2);border-radius:var(--r2);color:var(--text);font-size:15px;font-weight:500;outline:none;-webkit-appearance:none;cursor:pointer;transition:all .18s;font-family:'Inter',sans-serif;}
  .sel:focus{border-color:var(--indigo2);box-shadow:0 0 0 3px rgba(99,102,241,.15);}
  select option{background:#1C1E2E;color:var(--text);}
  .chip{padding:6px 14px;border-radius:100px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text2);transition:all .15s;-webkit-tap-highlight-color:transparent;white-space:nowrap;}
  .chip.active{background:var(--indigo);border-color:var(--indigo);color:#fff;box-shadow:0 4px 14px rgba(99,102,241,.3);}
  .chip:hover:not(.active){border-color:var(--border2);color:var(--text);}
  .sidebar{width:240px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:24px 0;position:fixed;left:0;top:0;bottom:0;z-index:300;transition:transform .25s cubic-bezier(.4,0,.2,1);}
  .shead{display:flex;align-items:center;gap:12px;padding:22px 22px 20px;border-bottom:1px solid var(--border);margin-bottom:8px;}
  .slogo{font-family:'Plus Jakarta Sans',sans-serif;font-weight:900;font-size:21px;background:linear-gradient(135deg,#818CF8,#6366F1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-.3px;}
  .ssec{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);padding:0 22px 8px;margin-top:8px;}
  .sitem{display:flex;align-items:center;gap:11px;padding:11px 22px;color:var(--text2);font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;-webkit-tap-highlight-color:transparent;margin:1px 10px;border-radius:10px;}
  .sitem:hover{color:var(--text);background:var(--surface2);}
  .sitem.active{color:#fff;background:linear-gradient(135deg,rgba(99,102,241,.25),rgba(139,92,246,.15));}
  .sicon{font-size:17px;width:22px;text-align:center;}
  .sbot{margin-top:auto;padding:16px;border-top:1px solid var(--border);max-height:80px;margin-bottom:20px;}
  .suser{display:flex;align-items:center;gap:10px;padding:12px;border-radius:12px;cursor:pointer;border:1px solid var(--border);transition:all .15s;background:var(--surface);margin-top:20px;}
  .suser:hover{border-color:var(--indigo2);background:rgba(99,102,241,.08);}
  .av{border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;flex-shrink:0;background:linear-gradient(135deg,#6366F1,#8B5CF6);color:white;overflow:hidden;}
  .suname{font-size:12px;color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .suemail{font-size:10px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .logbtn{font-size:15px;color:var(--text3);cursor:pointer;padding:4px;flex-shrink:0;margin-left:auto;transition:color .15s;}
  .logbtn:hover{color:var(--red);}
  .overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:299;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);}
  .bnav{display:none;position:fixed;bottom:0;left:0;right:0;background:var(--bg2);border-top:1px solid var(--border);z-index:200;padding-bottom:env(safe-area-inset-bottom,20px);box-shadow:0 -4px 24px rgba(0,0,0,.3);}
  .bnavr{display:flex;width:100%;align-items:center;}
  /* Floating center action button — opens Trade page directly, reuses existing nav() function */
  .bnav-fab{width:54px;height:54px;border-radius:50%;background:#111114;display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;font-weight:300;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,.35);margin-top:-26px;flex-shrink:0;-webkit-tap-highlight-color:transparent;transition:transform .15s;}
  .bnav-fab:active{transform:scale(.92);}
  .theme-light .bnav-fab{box-shadow:0 8px 20px rgba(0,0,0,.22);}
  .bni{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:12px 4px 10px;cursor:pointer;color:var(--text3);font-size:9px;font-weight:600;border-top:2px solid transparent;-webkit-tap-highlight-color:transparent;transition:all .15s;min-width:0;}
  .bni.active{color:var(--indigo2);border-top-color:var(--indigo2);}
  .bni-icon{font-size:22px;line-height:1;}
  .mtop{display:none;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top,0px) + 12px) calc(16px + env(safe-area-inset-right,0px)) 12px calc(16px + env(safe-area-inset-left,0px));background:var(--bg2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100;margin:0;}
  .mtop::before{content:'';display:block;position:fixed;top:0;left:0;right:0;height:env(safe-area-inset-top,0px);background:var(--bg2);z-index:101;}
  .mlogo-row{display:flex;align-items:center;gap:8px;}
  .mlogo{font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:17px;color:var(--text);}
  .mmenu{width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text2);-webkit-tap-highlight-color:transparent;background:none;border:none;padding:0;}
  .mchip{padding:7px 14px;border-radius:100px;background:linear-gradient(135deg,rgba(99,102,241,.2),rgba(139,92,246,.15));border:1px solid rgba(99,102,241,.3);color:var(--indigo2);font-size:11px;font-weight:700;}
  /* coin + range pills — 2-row grid on mobile so they don't overflow */
  .coin-pills{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;}
  .range-pills{display:flex;gap:4px;}
  @media(max-width:640px){
    .coin-pills{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;width:100%;}
    .coin-pills .chip{justify-content:center;padding:6px 4px;font-size:10px;text-align:center;}
    .range-pills{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;width:100%;}
    .range-pills .chip{justify-content:center;padding:5px 2px;font-size:10px;}
  }
  .main{margin-left:240px;flex:1;padding:36px;max-width:1240px;}
  .topbar{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:32px;}
  .ttl{font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:26px;color:var(--text);}
  .tdate{font-size:12px;color:var(--text3);margin-top:4px;}
  .tchip{padding:9px 20px;border-radius:100px;background:linear-gradient(135deg,rgba(99,102,241,.15),rgba(139,92,246,.1));border:1px solid rgba(99,102,241,.25);color:var(--indigo2);font-size:12px;font-weight:700;}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px;}
  .crow{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:24px;}
  .hgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
  .tgrid{display:grid;grid-template-columns:1fr 1.6fr;gap:16px;}
  .pbig{font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:32px;color:var(--text);}
  .pchg{font-size:13px;margin-top:5px;font-weight:600;display:flex;align-items:center;gap:5px;}
  .mlist{display:flex;flex-direction:column;gap:8px;}
  .mitem{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-radius:12px;background:var(--surface);border:1px solid var(--border);cursor:pointer;transition:all .15s;-webkit-tap-highlight-color:transparent;}
  .mitem:hover{border-color:var(--indigo2);background:rgba(99,102,241,.06);}
  .hi{padding:20px;border-radius:var(--r);background:var(--bg2);position:relative;overflow:hidden;transition:all .2s;cursor:pointer;}
  .hi::before{content:'';position:absolute;inset:0;border-radius:var(--r);padding:1px;background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.02));-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;}
  .hi:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(0,0,0,.35);}
  .hitop{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
  .hsym{font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:15px;color:var(--text);}
  .hnm{font-size:10px;color:var(--text3);font-weight:500;}
  .hamt{font-family:'Plus Jakarta Sans',sans-serif;font-size:22px;font-weight:800;color:var(--text);}
  .husd{font-size:12px;color:var(--text2);margin-top:3px;font-weight:500;}
  .hbar-bg{margin-top:14px;height:3px;background:rgba(255,255,255,.06);border-radius:2px;}
  .hbar{height:100%;border-radius:2px;}
  .tcrd{padding:26px;}
  .ttabs{display:flex;gap:4px;background:rgba(255,255,255,.04);border-radius:100px;padding:4px;margin-bottom:22px;border:1px solid var(--border);}
  .ttab{flex:1;padding:9px 4px;border-radius:100px;background:transparent;border:none;color:var(--text3);font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;white-space:nowrap;-webkit-tap-highlight-color:transparent;}
  .ttab.active.buy{background:rgba(16,185,129,.15);color:#10B981;}
  .ttab.active.sell{background:rgba(239,68,68,.12);color:#EF4444;}
  .ttab.active.deposit{background:rgba(99,102,241,.15);color:var(--indigo2);}
  .ttab.active.withdraw{background:rgba(139,92,246,.15);color:#A78BFA;}
  .tlab{font-size:11px;color:var(--text3);font-weight:600;letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px;}
  .tiwrap{position:relative;margin-bottom:12px;}
  .tinp{width:100%;padding:13px 56px 13px 16px;background:var(--surface);border:1px solid var(--border2);border-radius:var(--r2);color:var(--text);font-size:16px;font-weight:600;outline:none;-webkit-appearance:none;transition:all .18s;}
  .tinp:focus{border-color:var(--indigo2);box-shadow:0 0 0 3px rgba(99,102,241,.15);background:var(--bg3);}
  .tsfx{position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--text3);font-weight:700;pointer-events:none;}
  .tsum{background:var(--surface);border-radius:var(--r2);padding:14px;margin-bottom:18px;font-size:12px;border:1px solid var(--border);}
  .trow{display:flex;justify-content:space-between;margin-bottom:7px;}
  .trow:last-child{margin-bottom:0;border-top:1px solid var(--border);padding-top:9px;}
  .trl{color:var(--text3);font-weight:500;}.trv{color:var(--text2);font-weight:500;}.trt{color:var(--text);font-weight:700;}
  .tbal{font-size:11px;color:var(--text3);text-align:center;margin-top:12px;font-weight:500;}
  .tbal span{color:var(--indigo2);font-weight:700;}
  .qpill{padding:6px 14px;border-radius:100px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text2);transition:all .15s;}
  .qpill:hover,.qpill.act{border-color:var(--indigo2);background:rgba(99,102,241,.12);color:var(--indigo2);}
  .txwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}
  .txt{width:100%;border-collapse:collapse;min-width:580px;}
  .txt th{font-size:10px;color:var(--text3);font-weight:600;letter-spacing:1px;text-transform:uppercase;text-align:left;padding:0 18px 14px;white-space:nowrap;}
  .txt td{padding:14px 18px;font-size:13px;color:var(--text2);border-top:1px solid var(--border);white-space:nowrap;font-weight:500;}
  .txt tr:hover td{background:var(--surface);}
  .tbadge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:100px;font-size:10px;font-weight:700;}
  .txcards{display:none;flex-direction:column;gap:10px;}
  .txc{padding:16px;border-radius:var(--r2);background:var(--bg2);border:1px solid var(--border);}
  .txctop{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
  .txcsym{font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:15px;}
  .txcdate{font-size:10px;color:var(--text3);font-weight:500;}
  .txcbot{display:flex;align-items:center;justify-content:space-between;}
  .txcamt{font-size:12px;color:var(--text3);font-weight:500;}
  .txctot{font-size:14px;font-weight:800;}
  .settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;max-width:900px;margin:0 auto;}
  .setting-row{display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid var(--border);}
  .setting-row:last-child{border-bottom:none;}
  .setting-label{font-size:13px;font-weight:600;color:var(--text);}
  .setting-desc{font-size:11px;color:var(--text3);margin-top:2px;}
  .sel-input{padding:7px 12px;background:var(--surface);border:1px solid var(--border2);border-radius:100px;color:var(--text);font-size:12px;font-weight:600;outline:none;cursor:pointer;-webkit-appearance:none;padding-right:24px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239496A8' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;}
  .sel-input:focus{border-color:var(--indigo2);box-shadow:0 0 0 3px rgba(99,102,241,.15);}
  /* Rounded dropdowns in trade panel and profile */
  .sel{border-radius:100px !important;}
  .sel:focus{border-radius:100px !important;}
  .stitle{font-family:'Plus Jakarta Sans',sans-serif;font-weight:800;font-size:18px;color:var(--text);margin-bottom:16px;}
  .dbadge{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:100px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2);color:#F59E0B;font-size:10px;font-weight:700;}
  .ct-err{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:var(--r2);padding:11px 14px;font-size:13px;color:#EF4444;font-weight:600;margin-bottom:14px;}
  .avatar-ring{width:88px;height:88px;border-radius:50%;border:3px solid var(--indigo2);box-shadow:0 0 0 3px rgba(99,102,241,.2);cursor:pointer;position:relative;overflow:hidden;flex-shrink:0;}
  .avatar-ring:hover::after{content:'📷';position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:24px;}
  @media(max-width:900px){.sidebar{width:200px;}.main{margin-left:200px;padding:26px 22px;}.stats{grid-template-columns:repeat(2,1fr);}.crow{grid-template-columns:1fr;}.hgrid{grid-template-columns:repeat(2,1fr);}.tgrid{grid-template-columns:1fr;}.settings-grid{grid-template-columns:1fr;}.pbig{font-size:26px;}.stat-value{font-size:22px;}}
  @media(max-width:640px){.sidebar{transform:translateX(-100%);width:260px;}.sidebar.open{transform:translateX(0);}.overlay.open{display:block;}.bnav{display:flex;}.mtop{display:flex;}.main{margin-left:0;padding:0 14px calc(96px + env(safe-area-inset-bottom,16px));}.topbar{display:none;}.stats{grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px;}.crow{grid-template-columns:1fr;gap:12px;margin-bottom:14px;}.hgrid{grid-template-columns:repeat(2,1fr);gap:10px;}.tgrid{grid-template-columns:1fr;}.settings-grid{grid-template-columns:1fr;}.stat{padding:16px;}.stat-value{font-size:20px;}.gcard{padding:16px;}.hi{padding:14px;}.tcrd{padding:16px;}.pbig{font-size:24px;}.hamt{font-size:18px;}.stitle{font-size:16px;}.txwrap table{display:none;}.txcards{display:flex;}}
  @media(max-width:375px){.stat-value{font-size:18px;}.pbig{font-size:21px;}.hamt{font-size:16px;}.stats,.hgrid{gap:8px;}.bni{font-size:8px;padding:8px 2px 7px;}.bni-icon{font-size:17px;}}
  /* Extra bottom padding on non-dashboard pages on mobile */
  @media(max-width:640px){
    .page-wrap{padding-bottom:20px;}
  }
  ::-webkit-scrollbar{width:4px;height:4px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px;}
`;
const _se=document.createElement("style");_se.textContent=css;document.head.appendChild(_se);

/* ════════════════ APP ════════════════ */
export default function App(){
  const[user,setUser]         =useState<User|null>(null);
  const[authChecking,setAuthChecking]=useState(true);
  // On first load, if a saved token exists, verify it and restore the session —
  // this is what fixes "refresh logs me out". Runs once when the app mounts.
  useEffect(()=>{
    let cancelled=false;
    if(!_access){
      setAuthChecking(false);
      return;
    }
    api.get("/auth/me").then(d=>{
      if(cancelled) return;
      const u=d.user;
      const nm=u.name||"User";
      const initials=nm.trim().split(/\s+/).map((w:string)=>w[0]||"").join("").slice(0,2).toUpperCase()||"U";
      setUser({name:nm,email:u.email,initials,phone:u.phone||undefined,avatarUrl:u.avatarUrl||undefined});
    }).catch(()=>{
      api.clearTokens(); // token was invalid/expired — clear it so we don't keep retrying
    }).finally(()=>{
      if(!cancelled) setAuthChecking(false);
    });
    return()=>{cancelled=true;};
  },[]);
  const[page,setPage]         =useState("dashboard");
  const[authTab,setAuthTab]   =useState<"login"|"register">("login");
  // Registration form fields
  const[regName,setRegName]   =useState("");
  const[regEmail,setRegEmail] =useState("");
  const[regPw,setRegPw]       =useState("");
  const[regPw2,setRegPw2]     =useState("");
  const[regDob,setRegDob]     =useState("");
  const[regCountry,setRegCountry]=useState("");
  const[regAgree,setRegAgree] =useState(false);
  const[showTerms,setShowTerms]=useState<string>(""); // "terms"|"privacy"|"" — inline on login page
  const[prices,setPrices]     =useState<Record<string,Price>>(FB_PRICES);
  const[priceDir,setPriceDir] =useState<Record<string,boolean>>(Object.fromEntries(Object.keys(FB_PRICES).map(s=>[s,(FB_PRICES[s].change24h||0)>=0])));
  const[port,setPort]         =useState<Portfolio>(FB_PORT);
  const[txs,setTxs]           =useState<Tx[]>(FB_TXS);
  const[charts,setCharts]     =useState<Record<string,ChartPt[]>>({});
  const[selCoin,setSelCoin]   =useState("BTC");
  const[chartRange,setChartRange]=useState<Range>("1D");
  const[tradeRange,setTradeRange]=useState<Range>("1D");
  const[ttype,setTtype]       =useState("buy");
  const[tcoin,setTcoin]       =useState("BTC");
  const[tamt,setTamt]         =useState("");
  const[loading,setLoading]   =useState(false);
  const[toast,setToast]       =useState<{msg:string;icon:string;ok?:boolean}|null>(null);
  const[email,setEmail]       =useState("");
  const[pw,setPw]             =useState("");
  const[sbOpen,setSbOpen]     =useState(false);
  const[loginErr,setLoginErr] =useState("");
  const[appSettings,setAppSettings]=useState<AppSettings>(()=>{
    try{
      const saved=localStorage.getItem("wave_prefs");
      if(saved) return {...{twoFA:false,notifications:true,currency:"USD",theme:"Light",language:"English"},...JSON.parse(saved)};
    }catch{}
    return {twoFA:false,notifications:true,currency:"USD",theme:"Light",language:"English"};
  });
  // Persist preferences whenever they change
  useEffect(()=>{try{localStorage.setItem("wave_prefs",JSON.stringify(appSettings));}catch{}},[appSettings]);

  // Modal state
  const[editOpen,setEditOpen]     =useState(false);
  const[phoneOpen,setPhoneOpen]   =useState(false);
  const[idOpen,setIdOpen]         =useState(false);
  const[addrOpen,setAddrOpen]     =useState(false);
  const[pwOpen,setPwOpen]         =useState(false);
  const[deleteOpen,setDeleteOpen] =useState(false);

  // Edit profile form state
  const[editName,setEditName]     =useState("");
  const[editPhone,setEditPhone]   =useState("");
  const[avatarPreview,setAvatarPreview]=useState<string|null>(null);
  const[phoneInput,setPhoneInput] =useState("");
  const[idFile,setIdFile]         =useState<File|null>(null);
  const[addrFile,setAddrFile]     =useState<File|null>(null);
  const[pwCurrent,setPwCurrent]   =useState("");
  const[pwNew,setPwNew]           =useState("");
  const[pwConfirm,setPwConfirm]   =useState("");
  const[kycStatus,setKycStatus]   =useState({phone:"pending",id:"pending",address:"pending"});
  const[deleteConfirm,setDeleteConfirm]=useState("");

  const avatarInput=useRef<HTMLInputElement>(null);
  const idInput    =useRef<HTMLInputElement>(null);
  const addrInput  =useRef<HTMLInputElement>(null);


  /* Translation helper */
  const t=(key:string)=>LANG[appSettings.language]?.[key]||LANG.English[key]||key;


  const W=useWW(), mob=W<=640, tab=W<=900;

  // Build charts per range
  const buildCharts=(range:Range)=>{
    const d:Record<string,ChartPt[]>={};
    Object.keys(COINS).forEach(s=>{d[s]=genChart(prices[s]?.price||100,RANGE_POINTS[range],RANGE_VOL[range]);});
    return d;
  };

  useEffect(()=>{
    setCharts(buildCharts(chartRange));
    const iv=setInterval(()=>{
      setCharts(p=>{
        const n={...p};
        const dirs:Record<string,boolean>={};
        Object.keys(COINS).forEach(s=>{
          const l=p[s]?.[p[s].length-1]?.v||100;
          const v=parseFloat((l*(1+(Math.random()-.49)*.008)).toFixed(2));
          dirs[s]=v>=l; // true = went up (green), false = went down (red)
          n[s]=[...(p[s]||[]).slice(1),{t:Date.now(),v}];
        });
        setPriceDir(dirs);
        return n;
      });
    },3000);
    return()=>clearInterval(iv);
  },[chartRange]);

  // Trade chart is separate — regens on tradeRange change
  const[tradeCharts,setTradeCharts]=useState<Record<string,ChartPt[]>>({});
  useEffect(()=>{
    const d:Record<string,ChartPt[]>={};
    Object.keys(COINS).forEach(s=>{d[s]=genChart(prices[s]?.price||100,RANGE_POINTS[tradeRange],RANGE_VOL[tradeRange]);});
    setTradeCharts(d);
  },[tradeRange,tcoin]);

  useEffect(()=>{document.body.style.overflow=sbOpen?"hidden":"";return()=>{document.body.style.overflow="";};},[sbOpen]);

  const toast2=(msg:string,icon="✓",ok=true)=>{setToast({msg,icon,ok});setTimeout(()=>setToast(null),3500);};

  const loadData=useCallback(async()=>{
    // Each call is independent — one failing won't block the others
    try{
      const p=await api.get("/prices");
      // prices returns {BTC:{price,change24h,...}} — map to our format
      const mapped:Record<string,Price>={};
      Object.entries(p).forEach(([sym,v]:any)=>{
        mapped[sym]={price:v.price||0,change24h:v.change24h||0};
      });
      setPrices(mapped);
    }catch(e:any){console.warn("prices:",e.message);}

    try{
      const pf=await api.get("/portfolio");
      setPort({
        cashBalance:         pf.cashBalance         ??pf.cash_balance??0,
        totalPortfolioValue: pf.totalPortfolioValue ??0,
        totalValue:          pf.totalValue          ??0,
        holdings:            pf.holdings            ??[],
      });
    }catch(e:any){console.warn("portfolio:",e.message);}

    try{
      const tx=await api.get("/transactions");
      setTxs(tx.transactions??[]);
    }catch(e:any){console.warn("transactions:",e.message);}
  },[]);
  useEffect(()=>{if(user)loadData();},[user,loadData]);

  /* Auth */
  const oauthNotReady=(provider:string)=>{
  toast2(`${provider} sign-in isn't connected yet — this will work automatically once ${provider} OAuth is configured on the backend.`,"⚠",false);
};
  const doEmail=async()=>{
    if(!email)return setLoginErr("Please enter your email.");
    if(!pw)   return setLoginErr("Please enter your password.");
    setLoginErr("");setLoading(true);
    try{
      const d=await api.post("/auth/login",{email,password:pw});
      api.setTokens(d.accessToken,d.refreshToken);
      const u=d.user;
      const nm=u.name||email.split("@")[0]||"User";
      const initials=nm.trim().split(/\s+/).map((w:string)=>w[0]||"").join("").slice(0,2).toUpperCase()||"U";
      setUser({name:nm,email:u.email,initials,phone:u.phone||undefined,avatarUrl:u.avatarUrl||undefined});
      toast2(`Welcome back, ${nm.split(" ")[0]}!`,);
    }catch(err:any){setLoginErr(err.message||"Login failed. Check your email and password.");}
    finally{setLoading(false);}
  };
  const doRegister=async()=>{
    if(!regName.trim())return setLoginErr("Please enter your full name.");
    if(!regEmail.trim())return setLoginErr("Please enter your email.");
    if(!regPw)return setLoginErr("Please enter a password.");
    if(regPw.length<8)return setLoginErr("Password must be at least 8 characters.");
    if(regPw!==regPw2)return setLoginErr("Passwords do not match.");
    if(!regDob)return setLoginErr("Please enter your date of birth.");
    if(!regCountry)return setLoginErr("Please select your country.");
    if(!regAgree)return setLoginErr("Please accept the Terms & Privacy Policy.");
    setLoginErr("");setLoading(true);
    try{
      const d=await api.post("/auth/register",{email:regEmail,name:regName,password:regPw,date_of_birth:regDob,country:regCountry});
      api.setTokens(d.accessToken,d.refreshToken);
      const u=d.user;
      const nm=u.name||regName||"User";
      const initials=nm.trim().split(/\s+/).map((w:string)=>w[0]||"").join("").slice(0,2).toUpperCase()||"U";
      setUser({name:nm,email:u.email,initials});
      toast2(`Welcome to Wave, ${nm.split(" ")[0]}!`,);
    }catch(err:any){setLoginErr(err.message||"Registration failed.");}
    finally{setLoading(false);}
  };
  const doLogout=async()=>{
    try{await api.post("/auth/logout",{refreshToken:_refresh});}catch{}
   api.clearTokens();setUser(null);setPage("dashboard");toast2("Signed out");
  };

  /* Save profile */
  const doSaveProfile=async()=>{
    if(!editName.trim()&&!avatarPreview)return toast2("Nothing to update","⚠",false);
    setLoading(true);
    try{
     const d=await api.patch("/auth/profile",{name:editName||undefined,avatar_url:avatarPreview||undefined});
      const u=d.user;
      const nm=u.name||editName||user?.name||"User";
      const initials=nm.trim().split(/\s+/).map((w:string)=>w[0]||"").join("").slice(0,2).toUpperCase()||"U";
 setUser(p=>({...p!,name:nm,initials,avatarUrl:u.avatarUrl||p?.avatarUrl}));
      setEditOpen(false);toast2("Profile updated","✓");
    }catch(e:any){toast2(e.message,"⚠",false);}
    finally{setLoading(false);}
  };

  /* Add phone */
  const doAddPhone=async()=>{
    if(!phoneInput.trim())return toast2("Enter a phone number","⚠",false);
    setLoading(true);
    try{
      await api.patch("/auth/profile",{phone:phoneInput});
      setUser(p=>({...p!,phone:phoneInput}));
      setKycStatus(p=>({...p,phone:"verified"}));
      setPhoneOpen(false);toast2("Phone number added",);
    }catch(e:any){toast2(e.message,"⚠",false);}
    finally{setLoading(false);}
  };

  /* Submit ID */
  const doSubmitID=async()=>{
    if(!idFile)return toast2("Please select a file","⚠",false);
    setLoading(true);
    // Simulate upload — in prod you'd upload to S3 and send URL to backend
    await new Promise(r=>setTimeout(r,1200));
    setKycStatus(p=>({...p,id:"review"}));
    setIdOpen(false);toast2("ID submitted for review",);
    setLoading(false);
  };

  /* Submit address */
  const doSubmitAddr=async()=>{
    if(!addrFile)return toast2("Please select a file","⚠",false);
    setLoading(true);
    await new Promise(r=>setTimeout(r,1200));
    setKycStatus(p=>({...p,address:"review"}));
    setAddrOpen(false);toast2("Address proof submitted",);
    setLoading(false);
  };

  /* Change password */
  const doChangePassword=async()=>{
    if(!pwCurrent||!pwNew)return toast2("Fill in all fields","⚠",false);
    if(pwNew!==pwConfirm)return toast2("Passwords don't match","⚠",false);
    if(pwNew.length<8)return toast2("Password must be at least 8 characters","⚠",false);
    setLoading(true);
    try{
      await api.patch("/auth/password",{currentPassword:pwCurrent,newPassword:pwNew});
      setPwOpen(false);setPwCurrent("");setPwNew("");setPwConfirm("");
      toast2("Password changed",);
    }catch(e:any){toast2(e.message,"⚠",false);}
    finally{setLoading(false);}
  };

  /* Handle avatar file pick */
  const onAvatarPick=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const f=e.target.files?.[0];
    if(!f) return;
    if(f.size>5*1024*1024)return toast2("Image must be under 5MB","⚠",false);
    const r=new FileReader();
    r.onload=ev=>setAvatarPreview(ev.target?.result as string);
    r.readAsDataURL(f);
  };

  /* Trade */
  const doTrade=async()=>{
  const amt=parseFloat(tamt);
  if(!amt||amt<=0)return toast2("Enter a valid amount","⚠",false);
  setLoading(true);
  try{
    const d=await api.post("/trades",{type:ttype,symbol:tcoin,amount:amt});
    toast2(d.message,ttype==="buy"?"🟢":"🔴");
    setTamt("");
    await loadData();
  }catch(e:any){toast2(e.message,"⚠",false);}
  finally{setLoading(false);}
}; 

  /* Currency symbol helper */
  const CURRENCY_SYMBOLS:Record<string,string>={USD:"$",EUR:"€",GBP:"£",NGN:"₦",BTC:"₿"};
  const CURRENCY_RATES:Record<string,number>={USD:1,EUR:0.92,GBP:0.79,NGN:1580,BTC:0.0000148};
  const cur=(usd:number)=>{
    const sym=CURRENCY_SYMBOLS[appSettings.currency]||"$";
    const rate=CURRENCY_RATES[appSettings.currency]||1;
    const val=usd*rate;
    if(appSettings.currency==="BTC") return `${sym}${val.toFixed(6)}`;
    return `${sym}${val.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  };

  /* Derived */
  const lcd=charts[selCoin]||[];const lp=lcd[lcd.length-1]?.v||prices[selCoin]?.price||0;
  const tcd=tradeCharts[tcoin]||[];const tlp=tcd[tcd.length-1]?.v||prices[tcoin]?.price||0;
  const tci=prices[tcoin];
  const tsub=tamt&&tci?(parseFloat(tamt)*tci.price).toFixed(2):"0.00";
  const tfee=tamt&&tci?(parseFloat(tamt)*tci.price*.001).toFixed(2):"0.00";
  const ttot=(parseFloat(tsub)+parseFloat(tfee)).toFixed(2);
  const NAV=[{id:"dashboard",icon:"⬡",label:"Dashboard",short:"Home"},{id:"trade",icon:"⇄",label:"Trade",short:"Trade"},{id:"portfolio",icon:"◈",label:"Portfolio",short:"Portfolio"},{id:"history",icon:"⊞",label:"History",short:"History"}];
  const LABELS:Record<string,string>={dashboard:t("dashboard"),trade:t("trade"),portfolio:t("portfolio"),history:t("history"),settings:t("settings"),privacy:t("privacy"),notifications:"Notifications"};
  const nav=(id:string)=>{setPage(id);setSbOpen(false);};
  const pieData=port.holdings.filter(h=>h.amount>0).map(h=>({name:h.symbol,value:h.value,color:COINS[h.symbol]?.color||"#ccc"}));

  const AvatarDisplay=({size=40,fontSize=15}:{size?:number;fontSize?:number})=>(
    user?.avatarUrl
      ?<img src={user.avatarUrl} style={{width:size,height:size,borderRadius:"50%",objectFit:"cover"}}/>
      :<div className="av" style={{width:size,height:size,fontSize}}>{user?.initials}</div>
  );

  const kycLabel=(status:string)=>{
    if(status==="verified") return <span className="badge badge-green">✓ Verified</span>;
    if(status==="review")   return <span className="badge badge-blue">⏳ In Review</span>;
    return null;
  };

  /* ═══════════ LOGIN ═══════════ */
  if(authChecking) return(
    <div className="app" style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{textAlign:"center"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:14}}><WaveLogo size={38}/><span style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:800,fontSize:28,color:"var(--text)"}}>Wave</span></div>
        <p style={{color:"var(--text3)",fontSize:14}}>Restoring your session…</p>
      </div>
    </div>
  );
  if(!user) return(
    <div className="app" style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20,position:"relative",overflow:"hidden"}}>
      <div style={{position:"fixed",top:-150,left:-100,width:500,height:500,borderRadius:"50%",background:"radial-gradient(circle,rgba(99,102,241,.15),transparent 70%)",pointerEvents:"none"}}/>
      <div style={{position:"fixed",bottom:-100,right:-80,width:400,height:400,borderRadius:"50%",background:"radial-gradient(circle,rgba(139,92,246,.12),transparent 70%)",pointerEvents:"none"}}/>
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:12}}><WaveLogo size={38}/><span style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:800,fontSize:28,color:"var(--text)"}}>Wave</span></div>
          <p style={{color:"var(--text3)",fontSize:14,fontWeight:500}}>Professional crypto investing platform</p>
        </div>
        <div className="gcard" style={{padding:"28px 24px"}}>
          {/* Tabs */}
          <div style={{display:"flex",background:"rgba(255,255,255,.05)",borderRadius:100,padding:4,marginBottom:22,border:"1px solid var(--border)"}}>
            {(["login","register"] as const).map(t=>(
              <button key={t} onClick={()=>{setAuthTab(t);setLoginErr("");}} style={{flex:1,padding:"9px",borderRadius:100,border:"none",cursor:"pointer",fontSize:13,fontWeight:700,transition:"all .15s",background:authTab===t?"linear-gradient(135deg,#6366F1,#8B5CF6)":"transparent",color:authTab===t?"#fff":"var(--text3)"}}>
                {t==="login"?"Sign In":"Create Account"}
              </button>
            ))}
          </div>

          {loginErr&&<div className="ct-err">⚠ {loginErr}</div>}

          {/* Social login buttons */}
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
          <button className="btn btn-ghost" style={{width:"100%",padding:13,fontSize:13,borderRadius:12}} onClick={()=>oauthNotReady("Google")}>
              <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Continue with Google
            </button>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <button className="btn btn-ghost" style={{padding:13,fontSize:13,borderRadius:12}} onClick={()=>oauthNotReady("Apple")}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.4.07 2.38.81 3.18.84.96-.19 1.95-.93 3.24-.99 1.38-.07 2.61.49 3.41 1.52-3.41 2.08-2.51 6.53.77 7.8-.54 1.47-1.26 2.84-2.6 3.71zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                Apple
              </button>
              <button className="btn btn-ghost" style={{padding:13,fontSize:13,borderRadius:12}} onClick={()=>oauthNotReady("Facebook")}>
                <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#1877F2" d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.88v2.27h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z"/></svg>
                Facebook
              </button>
            </div>
          </div>

          <div style={{display:"flex",alignItems:"center",gap:10,margin:"14px 0",color:"var(--text3)",fontSize:11,fontWeight:600}}>
            <div style={{flex:1,height:1,background:"var(--border)"}}/>or<div style={{flex:1,height:1,background:"var(--border)"}}/>
          </div>

          {/* LOGIN FORM */}
          {authTab==="login"&&<>
            <input className="inp" placeholder="Email address" type="email" autoComplete="email" style={{marginBottom:10}} value={email} onChange={e=>{setEmail(e.target.value);setLoginErr("");}}/>
            <input className="inp" placeholder="Password" type="password" autoComplete="current-password" style={{marginBottom:16}} value={pw} onChange={e=>{setPw(e.target.value);setLoginErr("");}} onKeyDown={e=>e.key==="Enter"&&doEmail()}/>
            <button className="btn btn-primary btn-lg" style={{width:"100%",borderRadius:12,marginBottom:12}} onClick={doEmail} disabled={loading}>{loading?"Signing in…":"Sign In"}</button>
          </>}

          

          {/* REGISTRATION FORM */}
          {authTab==="register"&&<>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <div>
                <div style={{fontSize:10,fontWeight:600,color:"var(--text3)",letterSpacing:".5px",textTransform:"uppercase",marginBottom:4}}>Full Name *</div>
                <input className="inp" placeholder="Alex Morgan" type="text" autoComplete="name" value={regName} onChange={e=>{setRegName(e.target.value);setLoginErr("");}}/>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:600,color:"var(--text3)",letterSpacing:".5px",textTransform:"uppercase",marginBottom:4}}>Email *</div>
                <input className="inp" placeholder="you@example.com" type="email" autoComplete="email" value={regEmail} onChange={e=>{setRegEmail(e.target.value);setLoginErr("");}}/>
              </div>
            </div>
            <div style={{marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:600,color:"var(--text3)",letterSpacing:".5px",textTransform:"uppercase",marginBottom:4}}>Date of Birth * (must be 18+)</div>
              <input className="inp" type="date" value={regDob} max={new Date(Date.now()-18*365.25*24*3600*1000).toISOString().slice(0,10)} onChange={e=>{setRegDob(e.target.value);setLoginErr("");}}/>
            </div>
            <div style={{marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:600,color:"var(--text3)",letterSpacing:".5px",textTransform:"uppercase",marginBottom:4}}>Country *</div>
              <select className="inp" style={{cursor:"pointer"}} value={regCountry} onChange={e=>{setRegCountry(e.target.value);setLoginErr("");}}>
                <option value="">Select country…</option>
                {[
                  {f:"🇦🇫",n:"Afghanistan"},{f:"🇦🇱",n:"Albania"},{f:"🇩🇿",n:"Algeria"},{f:"🇦🇩",n:"Andorra"},{f:"🇦🇴",n:"Angola"},
                  {f:"🇦🇬",n:"Antigua and Barbuda"},{f:"🇦🇷",n:"Argentina"},{f:"🇦🇲",n:"Armenia"},{f:"🇦🇺",n:"Australia"},{f:"🇦🇹",n:"Austria"},
                  {f:"🇦🇿",n:"Azerbaijan"},{f:"🇧🇸",n:"Bahamas"},{f:"🇧🇭",n:"Bahrain"},{f:"🇧🇩",n:"Bangladesh"},{f:"🇧🇧",n:"Barbados"},
                  {f:"🇧🇾",n:"Belarus"},{f:"🇧🇪",n:"Belgium"},{f:"🇧🇿",n:"Belize"},{f:"🇧🇯",n:"Benin"},{f:"🇧🇹",n:"Bhutan"},
                  {f:"🇧🇴",n:"Bolivia"},{f:"🇧🇦",n:"Bosnia and Herzegovina"},{f:"🇧🇼",n:"Botswana"},{f:"🇧🇷",n:"Brazil"},{f:"🇧🇳",n:"Brunei"},
                  {f:"🇧🇬",n:"Bulgaria"},{f:"🇧🇫",n:"Burkina Faso"},{f:"🇧🇮",n:"Burundi"},{f:"🇨🇻",n:"Cabo Verde"},{f:"🇰🇭",n:"Cambodia"},
                  {f:"🇨🇲",n:"Cameroon"},{f:"🇨🇦",n:"Canada"},{f:"🇨🇫",n:"Central African Republic"},{f:"🇹🇩",n:"Chad"},{f:"🇨🇱",n:"Chile"},
                  {f:"🇨🇳",n:"China"},{f:"🇨🇴",n:"Colombia"},{f:"🇰🇲",n:"Comoros"},{f:"🇨🇩",n:"Congo (DRC)"},{f:"🇨🇬",n:"Congo (Republic)"},
                  {f:"🇨🇷",n:"Costa Rica"},{f:"🇭🇷",n:"Croatia"},{f:"🇨🇺",n:"Cuba"},{f:"🇨🇾",n:"Cyprus"},{f:"🇨🇿",n:"Czech Republic"},
                  {f:"🇩🇰",n:"Denmark"},{f:"🇩🇯",n:"Djibouti"},{f:"🇩🇲",n:"Dominica"},{f:"🇩🇴",n:"Dominican Republic"},{f:"🇪🇨",n:"Ecuador"},
                  {f:"🇪🇬",n:"Egypt"},{f:"🇸🇻",n:"El Salvador"},{f:"🇬🇶",n:"Equatorial Guinea"},{f:"🇪🇷",n:"Eritrea"},{f:"🇪🇪",n:"Estonia"},
                  {f:"🇸🇿",n:"Eswatini"},{f:"🇪🇹",n:"Ethiopia"},{f:"🇫🇯",n:"Fiji"},{f:"🇫🇮",n:"Finland"},{f:"🇫🇷",n:"France"},
                  {f:"🇬🇦",n:"Gabon"},{f:"🇬🇲",n:"Gambia"},{f:"🇬🇪",n:"Georgia"},{f:"🇩🇪",n:"Germany"},{f:"🇬🇭",n:"Ghana"},
                  {f:"🇬🇷",n:"Greece"},{f:"🇬🇩",n:"Grenada"},{f:"🇬🇹",n:"Guatemala"},{f:"🇬🇳",n:"Guinea"},{f:"🇬🇼",n:"Guinea-Bissau"},
                  {f:"🇬🇾",n:"Guyana"},{f:"🇭🇹",n:"Haiti"},{f:"🇭🇳",n:"Honduras"},{f:"🇭🇺",n:"Hungary"},{f:"🇮🇸",n:"Iceland"},
                  {f:"🇮🇳",n:"India"},{f:"🇮🇩",n:"Indonesia"},{f:"🇮🇷",n:"Iran"},{f:"🇮🇶",n:"Iraq"},{f:"🇮🇪",n:"Ireland"},
                  {f:"🇮🇱",n:"Israel"},{f:"🇮🇹",n:"Italy"},{f:"🇯🇲",n:"Jamaica"},{f:"🇯🇵",n:"Japan"},{f:"🇯🇴",n:"Jordan"},
                  {f:"🇰🇿",n:"Kazakhstan"},{f:"🇰🇪",n:"Kenya"},{f:"🇰🇮",n:"Kiribati"},{f:"🇰🇵",n:"Korea (North)"},{f:"🇰🇷",n:"Korea (South)"},
                  {f:"🇽🇰",n:"Kosovo"},{f:"🇰🇼",n:"Kuwait"},{f:"🇰🇬",n:"Kyrgyzstan"},{f:"🇱🇦",n:"Laos"},{f:"🇱🇻",n:"Latvia"},
                  {f:"🇱🇧",n:"Lebanon"},{f:"🇱🇸",n:"Lesotho"},{f:"🇱🇷",n:"Liberia"},{f:"🇱🇾",n:"Libya"},{f:"🇱🇮",n:"Liechtenstein"},
                  {f:"🇱🇹",n:"Lithuania"},{f:"🇱🇺",n:"Luxembourg"},{f:"🇲🇬",n:"Madagascar"},{f:"🇲🇼",n:"Malawi"},{f:"🇲🇾",n:"Malaysia"},
                  {f:"🇲🇻",n:"Maldives"},{f:"🇲🇱",n:"Mali"},{f:"🇲🇹",n:"Malta"},{f:"🇲🇭",n:"Marshall Islands"},{f:"🇲🇷",n:"Mauritania"},
                  {f:"🇲🇺",n:"Mauritius"},{f:"🇲🇽",n:"Mexico"},{f:"🇫🇲",n:"Micronesia"},{f:"🇲🇩",n:"Moldova"},{f:"🇲🇨",n:"Monaco"},
                  {f:"🇲🇳",n:"Mongolia"},{f:"🇲🇪",n:"Montenegro"},{f:"🇲🇦",n:"Morocco"},{f:"🇲🇿",n:"Mozambique"},{f:"🇲🇲",n:"Myanmar"},
                  {f:"🇳🇦",n:"Namibia"},{f:"🇳🇷",n:"Nauru"},{f:"🇳🇵",n:"Nepal"},{f:"🇳🇱",n:"Netherlands"},{f:"🇳🇿",n:"New Zealand"},
                  {f:"🇳🇮",n:"Nicaragua"},{f:"🇳🇪",n:"Niger"},{f:"🇳🇬",n:"Nigeria"},{f:"🇲🇰",n:"North Macedonia"},{f:"🇳🇴",n:"Norway"},
                  {f:"🇴🇲",n:"Oman"},{f:"🇵🇰",n:"Pakistan"},{f:"🇵🇼",n:"Palau"},{f:"🇵🇸",n:"Palestine"},{f:"🇵🇦",n:"Panama"},
                  {f:"🇵🇬",n:"Papua New Guinea"},{f:"🇵🇾",n:"Paraguay"},{f:"🇵🇪",n:"Peru"},{f:"🇵🇭",n:"Philippines"},{f:"🇵🇱",n:"Poland"},
                  {f:"🇵🇹",n:"Portugal"},{f:"🇶🇦",n:"Qatar"},{f:"🇷🇴",n:"Romania"},{f:"🇷🇺",n:"Russia"},{f:"🇷🇼",n:"Rwanda"},
                  {f:"🇰🇳",n:"Saint Kitts and Nevis"},{f:"🇱🇨",n:"Saint Lucia"},{f:"🇻🇨",n:"Saint Vincent"},{f:"🇼🇸",n:"Samoa"},{f:"🇸🇲",n:"San Marino"},
                  {f:"🇸🇹",n:"Sao Tome and Principe"},{f:"🇸🇦",n:"Saudi Arabia"},{f:"🇸🇳",n:"Senegal"},{f:"🇷🇸",n:"Serbia"},{f:"🇸🇨",n:"Seychelles"},
                  {f:"🇸🇱",n:"Sierra Leone"},{f:"🇸🇬",n:"Singapore"},{f:"🇸🇰",n:"Slovakia"},{f:"🇸🇮",n:"Slovenia"},{f:"🇸🇧",n:"Solomon Islands"},
                  {f:"🇸🇴",n:"Somalia"},{f:"🇿🇦",n:"South Africa"},{f:"🇸🇸",n:"South Sudan"},{f:"🇪🇸",n:"Spain"},{f:"🇱🇰",n:"Sri Lanka"},
                  {f:"🇸🇩",n:"Sudan"},{f:"🇸🇷",n:"Suriname"},{f:"🇸🇪",n:"Sweden"},{f:"🇨🇭",n:"Switzerland"},{f:"🇸🇾",n:"Syria"},
                  {f:"🇹🇼",n:"Taiwan"},{f:"🇹🇯",n:"Tajikistan"},{f:"🇹🇿",n:"Tanzania"},{f:"🇹🇭",n:"Thailand"},{f:"🇹🇱",n:"Timor-Leste"},
                  {f:"🇹🇬",n:"Togo"},{f:"🇹🇴",n:"Tonga"},{f:"🇹🇹",n:"Trinidad and Tobago"},{f:"🇹🇳",n:"Tunisia"},{f:"🇹🇷",n:"Turkey"},
                  {f:"🇹🇲",n:"Turkmenistan"},{f:"🇹🇻",n:"Tuvalu"},{f:"🇺🇬",n:"Uganda"},{f:"🇺🇦",n:"Ukraine"},{f:"🇦🇪",n:"United Arab Emirates"},
                  {f:"🇬🇧",n:"United Kingdom"},{f:"🇺🇸",n:"United States"},{f:"🇺🇾",n:"Uruguay"},{f:"🇺🇿",n:"Uzbekistan"},{f:"🇻🇺",n:"Vanuatu"},
                  {f:"🇻🇦",n:"Vatican City"},{f:"🇻🇪",n:"Venezuela"},{f:"🇻🇳",n:"Vietnam"},{f:"🇾🇪",n:"Yemen"},{f:"🇿🇲",n:"Zambia"},{f:"🇿🇼",n:"Zimbabwe"},
                ].map(c=><option key={c.n} value={c.n}>{c.f} {c.n}</option>)}
              </select>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <div>
                <div style={{fontSize:10,fontWeight:600,color:"var(--text3)",letterSpacing:".5px",textTransform:"uppercase",marginBottom:4}}>Password *</div>
                <input className="inp" placeholder="Min. 8 characters" type="password" autoComplete="new-password" value={regPw} onChange={e=>{setRegPw(e.target.value);setLoginErr("");}}/>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:600,color:"var(--text3)",letterSpacing:".5px",textTransform:"uppercase",marginBottom:4}}>Confirm Password *</div>
                <input className="inp" placeholder="Repeat password" type="password" autoComplete="new-password" value={regPw2} onChange={e=>{setRegPw2(e.target.value);setLoginErr("");}} onKeyDown={e=>e.key==="Enter"&&doRegister()}/>
              </div>
            </div>
            {/* Password strength indicator */}
            {regPw&&(
              <div style={{marginBottom:12}}>
                <div style={{display:"flex",gap:4,marginBottom:4}}>
                  {[1,2,3,4].map(i=>(
                    <div key={i} style={{flex:1,height:3,borderRadius:2,background:regPw.length>=(i*2+4)?(i<=1?"var(--red)":i===2?"var(--yellow)":i===3?"#06B6D4":"var(--green)"):"var(--border)"}}/>
                  ))}
                </div>
                <div style={{fontSize:10,color:"var(--text3)"}}>{regPw.length<6?"Too short":regPw.length<8?"Weak":regPw.length<12?"Fair":regPw.length<16?"Good":"Strong"}</div>
              </div>
            )}
            {/* Terms checkbox */}
            <label style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:showTerms?8:16,cursor:"pointer"}}>
              <div onClick={()=>setRegAgree(!regAgree)} style={{width:18,height:18,borderRadius:5,border:`2px solid ${regAgree?"var(--indigo2)":"var(--border2)"}`,background:regAgree?"var(--indigo)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1,transition:"all .15s"}}>
                {regAgree&&<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>}
              </div>
              <span style={{fontSize:12,color:"var(--text3)",lineHeight:1.5}}>
                I agree to the{" "}
                <span style={{color:"var(--indigo2)",cursor:"pointer",fontWeight:700,textDecoration:"underline"}}
                  onClick={e=>{e.stopPropagation();setShowTerms(p=>p==="terms"?"":"terms");}}>
                  Terms of Service
                </span>
                {" "}&amp;{" "}
                <span style={{color:"var(--indigo2)",cursor:"pointer",fontWeight:700,textDecoration:"underline"}}
                  onClick={e=>{e.stopPropagation();setShowTerms(p=>p==="privacy"?"":"privacy");}}>
                  Privacy Policy
                </span>
              </span>
            </label>

            {/* Terms / Privacy panel — opens inline inside the register tab */}
            {showTerms&&(
              <div style={{background:"rgba(99,102,241,.06)",border:"1px solid rgba(99,102,241,.2)",borderRadius:14,marginBottom:14,overflow:"hidden"}}>
                {/* Single combined Terms & Privacy tab */}
                <div style={{padding:"14px 16px",maxHeight:260,overflowY:"auto",fontSize:12,color:"var(--text2)",lineHeight:1.75}}>
                  <div style={{fontWeight:800,color:"var(--text)",marginBottom:10,fontSize:13}}>Terms of Service</div>
                  <div style={{fontWeight:700,color:"var(--text)",marginBottom:4}}>1. Who We Are</div>
                  <p style={{marginBottom:10}}>Wave Invest is a crypto investment platform. By registering you agree to these Terms.</p>
                  <div style={{fontWeight:700,color:"var(--text)",marginBottom:4}}>2. Eligibility</div>
                  <p style={{marginBottom:10}}>You must be 18 or older. By registering you confirm this and that all information you provide is accurate.</p>
                  <div style={{fontWeight:700,color:"var(--text)",marginBottom:4}}>3. Risk Disclosure</div>
                  <p style={{marginBottom:10}}>Cryptocurrency is highly volatile. Wave provides no financial advice. Invest only what you can afford to lose.</p>
                  <div style={{fontWeight:700,color:"var(--text)",marginBottom:4}}>4. Fees</div>
                  <p style={{marginBottom:10}}>0.1% on trades, 0.5% on withdrawals. All fees shown before confirmation.</p>
                  <div style={{fontWeight:700,color:"var(--text)",marginBottom:4}}>5. Prohibited Use</div>
                  <p style={{marginBottom:14}}>No money laundering, fraud, or market manipulation. Violations result in termination and may be reported.</p>
                  <div style={{fontWeight:800,color:"var(--text)",marginBottom:10,fontSize:13}}>Privacy Policy</div>
                  <div style={{fontWeight:700,color:"var(--text)",marginBottom:4}}>1. What We Collect</div>
                  <p style={{marginBottom:10}}>Name, email, date of birth, country, password hash (never plain text), and transaction history.</p>
                  <div style={{fontWeight:700,color:"var(--text)",marginBottom:4}}>2. How We Use It</div>
                  <p style={{marginBottom:10}}>To operate your account, comply with KYC/AML, process trades, and send security alerts. We never sell your data.</p>
                  <div style={{fontWeight:700,color:"var(--text)",marginBottom:4}}>3. Security</div>
                  <p style={{marginBottom:10}}>Passwords are bcrypt-hashed. Auth uses short-lived JWTs (15 min) + rotating refresh tokens (7 days). All traffic is HTTPS/TLS 1.3.</p>
                  <div style={{fontWeight:700,color:"var(--text)",marginBottom:4}}>4. Your Rights</div>
                  <p style={{marginBottom:10}}>Access, correct, or delete your data anytime. Email: privacy@waveinvest.io</p>
                  <div style={{fontWeight:700,color:"var(--text)",marginBottom:4}}>5. Contact</div>
                  <p>support@waveinvest.io · privacy@waveinvest.io</p>
                </div>
                <div style={{padding:"10px 16px",borderTop:"1px solid rgba(99,102,241,.2)",display:"flex",gap:8}}>
                  <button onClick={()=>setShowTerms("")} className="btn btn-ghost btn-sm" style={{borderRadius:100}}>Close</button>
                </div>
              </div>
            )}
            <button className="btn btn-primary btn-lg" style={{width:"100%",borderRadius:12}} onClick={doRegister} disabled={loading}>{loading?"Creating account…":"Create Account"}</button>
          </>}

          <p style={{textAlign:"center",color:"var(--text3)",fontSize:11,marginTop:14}}>
            Protected by 256-bit SSL encryption 🔒
          </p>
        </div>
      </div>
      {toast&&<div style={{position:"fixed",bottom:24,right:16,left:16,maxWidth:380,margin:"0 auto",padding:"13px 18px",borderRadius:100,background:toast.ok===false?"rgba(239,68,68,.25)":"rgba(16,185,129,.25)",border:`1px solid ${toast.ok===false?"rgba(239,68,68,.5)":"rgba(16,185,129,.5)"}`,color:"#fff",fontSize:13,fontWeight:700,zIndex:999,display:"flex",alignItems:"center",gap:9,backdropFilter:"blur(15px)",WebkitBackdropFilter:"blur(15px)"}}><span>{toast.icon}</span>{toast.msg}</div>}
    </div>
  );

  /* ═══════════ APP ═══════════ */
  return(
    <div className={`app ${appSettings.theme==="Light"?"theme-light":""}`}>
      {/* Modals */}
      <Modal open={editOpen} onClose={()=>setEditOpen(false)} title="Edit Profile">
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20}}>
          <div onClick={()=>avatarInput.current?.click()} style={{width:80,height:80,borderRadius:"50%",border:"3px solid var(--indigo2)",overflow:"hidden",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#6366F1,#8B5CF6)",position:"relative"}}>
            {avatarPreview||user?.avatarUrl
              ?<img src={avatarPreview||user?.avatarUrl} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              :<span style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:800,fontSize:24,color:"white"}}>{user?.initials}</span>
            }
            <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.4)",display:"flex",alignItems:"center",justifyContent:"center",opacity:0,transition:"opacity .15s"}} onMouseEnter={e=>(e.currentTarget.style.opacity="1")} onMouseLeave={e=>(e.currentTarget.style.opacity="0")}>
              <span style={{fontSize:22}}>📷</span>
            </div>
          </div>
          <div>
            <div style={{fontSize:13,color:"var(--text2)",fontWeight:500,marginBottom:4}}>Click avatar to change photo</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>JPG, PNG or GIF · Max 5MB</div>
          </div>
          <input ref={avatarInput} type="file" accept="image/*" style={{display:"none"}} onChange={onAvatarPick}/>
        </div>
        <div style={{marginBottom:12}}>
          <div className="tlab">Display Name</div>
          <input className="inp" placeholder={user?.name} defaultValue={user?.name} onChange={e=>setEditName(e.target.value)}/>
        </div>
        <div style={{marginBottom:20}}>
          <div className="tlab">Email</div>
          <input className="inp" value={user?.email} disabled style={{opacity:.5,cursor:"not-allowed"}}/>
          <div style={{fontSize:11,color:"var(--text3)",marginTop:5}}>Email cannot be changed here</div>
        </div>
        <button className="btn btn-primary" style={{width:"100%",justifyContent:"center"}} onClick={doSaveProfile} disabled={loading}>
          {loading?"Saving…":"Save Changes"}
        </button>
      </Modal>

      <Modal open={phoneOpen} onClose={()=>setPhoneOpen(false)} title="Add Phone Number">
        <div style={{fontSize:13,color:"var(--text3)",marginBottom:16}}>We'll send a verification code to this number.</div>
        <div className="tlab">Phone Number</div>
        <input className="inp" placeholder="+1 (555) 000-0000" type="tel" style={{marginBottom:20}} value={phoneInput} onChange={e=>setPhoneInput(e.target.value)}/>
        <button className="btn btn-primary" style={{width:"100%",justifyContent:"center"}} onClick={doAddPhone} disabled={loading}>
          {loading?"Sending…":"Send Verification Code"}
        </button>
      </Modal>

      <Modal open={idOpen} onClose={()=>setIdOpen(false)} title="Upload Government ID">
        <div style={{fontSize:13,color:"var(--text3)",marginBottom:16}}>Upload a clear photo of your passport, national ID or driver's license.</div>
        <div onClick={()=>idInput.current?.click()} style={{border:"2px dashed var(--border2)",borderRadius:12,padding:"32px 20px",textAlign:"center",cursor:"pointer",marginBottom:20,transition:"border-color .15s"}} onMouseEnter={e=>(e.currentTarget.style.borderColor="var(--indigo2)")} onMouseLeave={e=>(e.currentTarget.style.borderColor="var(--border2)")}>
          <div style={{fontSize:32,marginBottom:8}}>🪪</div>
          {idFile?<div style={{color:"var(--green)",fontWeight:600,fontSize:13}}>✓ {idFile.name}</div>:<div style={{color:"var(--text3)",fontSize:13}}>Click to upload · JPG, PNG or PDF · Max 10MB</div>}
        </div>
        <input ref={idInput} type="file" accept="image/*,.pdf" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)setIdFile(f);}}/>
        <button className="btn btn-primary" style={{width:"100%",justifyContent:"center"}} onClick={doSubmitID} disabled={loading}>
          {loading?"Uploading…":"Submit for Review"}
        </button>
      </Modal>

      <Modal open={addrOpen} onClose={()=>setAddrOpen(false)} title="Upload Address Proof">
        <div style={{fontSize:13,color:"var(--text3)",marginBottom:16}}>Upload a utility bill, bank statement or council tax letter dated within the last 3 months.</div>
        <div onClick={()=>addrInput.current?.click()} style={{border:"2px dashed var(--border2)",borderRadius:12,padding:"32px 20px",textAlign:"center",cursor:"pointer",marginBottom:20,transition:"border-color .15s"}} onMouseEnter={e=>(e.currentTarget.style.borderColor="var(--indigo2)")} onMouseLeave={e=>(e.currentTarget.style.borderColor="var(--border2)")}>
          <div style={{fontSize:32,marginBottom:8}}>🏠</div>
          {addrFile?<div style={{color:"var(--green)",fontWeight:600,fontSize:13}}>✓ {addrFile.name}</div>:<div style={{color:"var(--text3)",fontSize:13}}>Click to upload · JPG, PNG or PDF · Max 10MB</div>}
        </div>
        <input ref={addrInput} type="file" accept="image/*,.pdf" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)setAddrFile(f);}}/>
        <button className="btn btn-primary" style={{width:"100%",justifyContent:"center"}} onClick={doSubmitAddr} disabled={loading}>
          {loading?"Uploading…":"Submit for Review"}
        </button>
      </Modal>

      <Modal open={pwOpen} onClose={()=>setPwOpen(false)} title="Change Password">
        <div className="tlab">Current Password</div>
        <input className="inp" type="password" placeholder="Enter current password" style={{marginBottom:12}} value={pwCurrent} onChange={e=>setPwCurrent(e.target.value)}/>
        <div className="tlab">New Password</div>
        <input className="inp" type="password" placeholder="Min. 8 characters" style={{marginBottom:12}} value={pwNew} onChange={e=>setPwNew(e.target.value)}/>
        <div className="tlab">Confirm New Password</div>
        <input className="inp" type="password" placeholder="Repeat new password" style={{marginBottom:20}} value={pwConfirm} onChange={e=>setPwConfirm(e.target.value)}/>
        <button className="btn btn-primary" style={{width:"100%",justifyContent:"center"}} onClick={doChangePassword} disabled={loading}>
          {loading?"Updating…":"Update Password"}
        </button>
      </Modal>

      <Modal open={deleteOpen} onClose={()=>setDeleteOpen(false)} title="⚠ Close Account">
        <div style={{color:"var(--red)",fontSize:13,marginBottom:16,lineHeight:1.6}}>This is permanent and cannot be undone. All your data, holdings and history will be erased.</div>
        <div className="tlab">Type DELETE to confirm</div>
        <input className="inp" placeholder="DELETE" style={{marginBottom:20}} value={deleteConfirm} onChange={e=>setDeleteConfirm(e.target.value)}/>
        <button className="btn btn-danger" style={{width:"100%",justifyContent:"center"}} disabled={deleteConfirm!=="DELETE"} onClick={()=>{toast2("Account deletion requested. Our team will contact you.","⚠",false);setDeleteOpen(false);setDeleteConfirm("");}}>
          Delete My Account
        </button>
      </Modal>

      {/* Sidebar */}
      <div className={`sidebar ${sbOpen?"open":""}`}>
        <div className="shead" style={{paddingBottom:22}}>
          <div style={{background:"linear-gradient(135deg,rgba(99,102,241,.25),rgba(139,92,246,.18))",borderRadius:11,padding:"7px 8px",border:"1px solid rgba(99,102,241,.3)",boxShadow:"0 0 16px rgba(99,102,241,.25)",flexShrink:0}}>
            <WaveLogo size={22}/>
          </div>
          <div>
            <div className="slogo" style={{fontSize:21}}>Wave</div>
            <div style={{fontSize:9,color:"var(--indigo2)",fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",marginTop:1}}>Crypto Platform</div>
          </div>
        </div>
        <div className="ssec">Main</div>
        {NAV.map(n=>(
          <div key={n.id} className={`sitem ${page===n.id?"active":""}`} onClick={()=>nav(n.id)}>
            <span className="sicon">{n.icon}</span>{n.label}
          </div>
        ))}
        <div className="ssec" style={{marginTop:8}}>Account</div>
        <div className={`sitem ${page==="settings"?"active":""}`} onClick={()=>nav("settings")}>
          <span className="sicon">⚙</span>Settings
        </div>
        <div className={`sitem ${page==="notifications"?"active":""}`} onClick={()=>nav("notifications")} style={{position:"relative"}}>
          <span className="sicon">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </span>
          Notifications
          {appSettings.notifications&&<span style={{marginLeft:"auto",width:7,height:7,borderRadius:"50%",background:"var(--green)",flexShrink:0}}/>}
        </div>
        <div className="sbot">
          <div className="suser" onClick={()=>nav("settings")}>
            <AvatarDisplay size={34} fontSize={13}/>
            <div style={{flex:1,minWidth:0}}><div className="suname">{user.name}</div><div className="suemail">{user.email}</div></div>
            {/* SVG logout icon */}
            <div className="logbtn" onClick={e=>{e.stopPropagation();doLogout();}} title="Sign out">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="main">
        {/* Mobile topbar */}
        <div className="mtop">
          <div className="mlogo-row">
            <div className="mmenu" onClick={()=>setSbOpen(true)}>
              <svg width="22" height="16" viewBox="0 0 22 16" fill="none"><rect y="0" width="22" height="2.5" rx="1.25" fill="currentColor"/><rect y="6.75" width="16" height="2.5" rx="1.25" fill="currentColor"/><rect y="13.5" width="22" height="2.5" rx="1.25" fill="currentColor"/></svg>
            </div>
            <WaveLogo size={24}/><div className="mlogo">Wave</div>
          </div>
          <div className="mchip">{cur(port.cashBalance)}</div>
        </div>

        {/* Mobile: greeting on dashboard, spacing only on other pages */}
        {mob&&(
          page==="dashboard"?(
            <div style={{padding:"18px 0 8px"}}>
              <div style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:800,fontSize:20,color:"var(--text)"}}>
                Good {new Date().getHours()<12?t("morning"):new Date().getHours()<17?t("afternoon"):t("evening")}, {user.name.split(" ")[0]} 👋
              </div>
              <div style={{fontSize:12,color:"var(--text3)",marginTop:4,fontWeight:500}}>
                {new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
              </div>
            </div>
          ):(
            <div style={{height:16}}/>
          )
        )}

        {/* Desktop topbar */}
        <div className="topbar">
          <div>
            <div className="ttl">
              {page==="dashboard"
                ? `Good ${new Date().getHours()<12?t("morning"):new Date().getHours()<17?t("afternoon"):t("evening")}, ${user.name.split(" ")[0]} 👋`
                : (LANG[appSettings.language]?.[page]||LABELS[page])
              }
            </div>
            <div className="tdate">{new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div className="tchip"> {cur(port.cashBalance)}</div>
          </div>
        </div>

        {/* ══ DASHBOARD ══ */}
        {page==="dashboard"&&<>
          <div className="stats" style={{marginTop:mob?12:0}}>
            {[
              {l:"Total Balance",  v:cur(port.totalValue),                  s:"+3.82% today",pos:true,  glow:"#6366F1"},
              {l:"Portfolio Value",v:cur(port.totalPortfolioValue),          s:"Invested",    pos:null,  glow:"#06B6D4"},
              {l:"Cash Balance",   v:cur(port.cashBalance),                  s:"Available",  pos:null,  glow:"#10B981"},
              {l:"24h P&L",        v:"+$1,248.50",                                                                     s:"+3.82%",     pos:true,  glow:"#8B5CF6"},
            ].map((s,i)=>(
              <div key={i} className="stat">
                <div className="stat-glow" style={{background:s.glow}}/>
                <div className="stat-label">{s.l}</div>
                <div className="stat-value">{s.v}</div>
                <div className="stat-sub" style={{color:s.pos===true?"var(--green)":s.pos===false?"var(--red)":"var(--text3)"}}>{s.pos===true&&"▲ "}{s.s}</div>
              </div>
            ))}
          </div>

          <div className="crow">
            <div className="gcard" style={{padding:26}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
                <div>
                  <div style={{fontSize:12,color:"var(--text3)",fontWeight:500,marginBottom:4}}>{COINS[selCoin]?.name} / USD</div>
                  <div className="pbig">${lp.toLocaleString()}</div>
                  <div className="pchg" style={{color:(prices[selCoin]?.change24h||0)>=0?"var(--green)":"var(--red)"}}>
                    {priceDir[selCoin]?"▲":"▼"} {Math.abs(prices[selCoin]?.change24h||0).toFixed(2)}% <span style={{color:"var(--text3)",fontSize:11}}>24h</span>
                  </div>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"flex-end"}}>
                  <div className="coin-pills">
                    {Object.keys(COINS).map(s=>(
                      <button key={s} className={`chip ${selCoin===s?"active":""}`} onClick={()=>setSelCoin(s)} style={{display:"flex",alignItems:"center",gap:5}}>
                        <CoinIcon symbol={s} size={14}/>{s}
                      </button>
                    ))}
                  </div>
                  <div className="range-pills">
                    {(["1H","1D","1W","1M"] as Range[]).map(r=>(
                      <button key={r} className={`chip ${chartRange===r?"active":""}`} style={{padding:"4px 10px",fontSize:10}} onClick={()=>setChartRange(r)}>{r}</button>
                    ))}
                  </div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={mob?140:200}>
                <AreaChart data={lcd}>
                  <defs>
                    <linearGradient id={`ag-${selCoin}-${priceDir[selCoin]?1:0}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={priceDir[selCoin]?"#10B981":"#EF4444"} stopOpacity={.3}/>
                      <stop offset="95%" stopColor={priceDir[selCoin]?"#10B981":"#EF4444"} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" hide/><YAxis hide domain={["auto","auto"]}/><Tooltip content={CT}/>
                  <Area type="monotone" dataKey="v" stroke={priceDir[selCoin]?"#10B981":"#EF4444"} strokeWidth={2.5} fill={`url(#ag-${selCoin}-${priceDir[selCoin]?1:0})`} dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="gcard" style={{padding:mob?"14px":"20px"}}>
              <div style={{fontSize:11,color:"var(--text3)",fontWeight:700,letterSpacing:".8px",textTransform:"uppercase",marginBottom:14}}>Live Markets</div>
              <div className="mlist">
                {Object.keys(COINS).map(s=>{
                  const m=COINS[s];const ld=charts[s]||[];const lv=ld[ld.length-1]?.v||prices[s]?.price||0;const pos=(prices[s]?.change24h||0)>=0;
                  return(
                    <div key={s} className="mitem" onClick={()=>{setSelCoin(s);setTcoin(s);}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}><CoinIcon symbol={s} size={32}/><div><div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{mob?s:m.name}</div><div style={{fontSize:10,color:"var(--text3)",fontWeight:500}}>{s}</div></div></div>
                      <div style={{textAlign:"right"}}><div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>${lv.toLocaleString()}</div><div style={{fontSize:10,fontWeight:700,color:pos?"var(--green)":"var(--red)",marginTop:2}}>{pos?"+":""}{(prices[s]?.change24h||0).toFixed(2)}%</div></div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"nowrap",gap:8}}>
            <div className="stitle" style={{marginBottom:0,flexShrink:0}}>My Holdings</div>
            <button className="btn btn-ghost btn-sm" style={{borderRadius:100,padding:"7px 14px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",flexShrink:0,border:"1px solid var(--border2)"}} onClick={()=>nav("portfolio")}>View all →</button>
          </div>
          <div className="hgrid">
            {port.holdings.filter(h=>h.amount>0).map(h=>{
              const m=COINS[h.symbol];const pct=port.totalPortfolioValue>0?(h.value/port.totalPortfolioValue*100).toFixed(1):"0";const isPos=(h.change24h||0)>=0;
              return(
                <div key={h.symbol} className="hi" onClick={()=>{setTcoin(h.symbol);setSelCoin(h.symbol);nav("trade");}}>
                  <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${m?.color},transparent)`,borderRadius:"18px 18px 0 0"}}/>
                  <div className="hitop"><CoinIcon symbol={h.symbol} size={32}/><div><div className="hsym">{h.symbol}</div><div className="hnm">{m?.name}</div></div><div style={{marginLeft:"auto",flexShrink:0}}><span className={isPos?"badge badge-green":"badge badge-red"} style={{fontSize:9,padding:"2px 7px"}}>{isPos?"▲":"▼"} {Math.abs(h.change24h||0).toFixed(2)}%</span></div></div>
                  <div className="hamt">{h.amount}</div>
                  <div className="husd">${h.value.toLocaleString("en-US",{minimumFractionDigits:2})}</div>
                  <div className="hbar-bg"><div className="hbar" style={{width:`${pct}%`,background:`linear-gradient(90deg,${m?.color},${m?.color}88)`}}/></div>
                </div>
              );
            })}
          </div>
        </>}

        {/* ══ TRADE ══ */}
        {page==="trade"&&(
          <div className="page-wrap">
          <div className="tgrid">
            <div className="gcard tcrd">
              <div className="ttabs">
                {(["buy","sell","deposit","withdraw"] as const).map(t=>(
                  <button key={t} className={`ttab ${ttype===t?`active ${t}`:""}`} onClick={()=>{setTtype(t);setTamt("");}}>
                    {t.charAt(0).toUpperCase()+t.slice(1)}
                  </button>
                ))}
              </div>

              {(ttype==="buy"||ttype==="sell")&&<>
                <div className="tlab">Asset</div>
                <select className="sel" value={tcoin} onChange={e=>setTcoin(e.target.value)} style={{marginBottom:12}}>
                  {Object.entries(COINS).map(([s,m])=><option key={s} value={s}>{s} — {m.name}</option>)}
                </select>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"var(--surface)",borderRadius:10,marginBottom:14,border:"1px solid var(--border)"}}>
                  <CoinIcon symbol={tcoin} size={28}/>
                  <div><div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{COINS[tcoin]?.name}</div><div style={{fontSize:11,color:"var(--text3)"}}>${(tci?.price||0).toLocaleString()} per {tcoin}</div></div>
                  <div style={{marginLeft:"auto"}}><span className={(tci?.change24h||0)>=0?"badge badge-green":"badge badge-red"}>{(tci?.change24h||0)>=0?"▲":"▼"} {Math.abs(tci?.change24h||0).toFixed(2)}%</span></div>
                </div>
                <div className="tlab">Amount ({tcoin})</div>
                <div className="tiwrap"><input className="tinp" type="number" placeholder="0.00" inputMode="decimal" autoComplete="off" value={tamt} onChange={e=>setTamt(e.target.value)}/><span className="tsfx">{tcoin}</span></div>
                <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
                  {["0.001","0.01","0.1","1"].map(v=><button key={v} className={`qpill ${tamt===v?"act":""}`} onClick={()=>setTamt(v)}>{v}</button>)}
                </div>
                <div className="tsum">
                  <div className="trow"><span className="trl">Market Price</span><span className="trv">${(tci?.price||0).toLocaleString()}</span></div>
                  <div className="trow"><span className="trl">Fee (0.1%)</span><span className="trv">${tfee}</span></div>
                  <div className="trow"><span className="trl">{ttype==="buy"?"Total Cost":"You Receive"}</span><span className="trt">${ttot}</span></div>
                </div>
                <button className="btn btn-primary btn-lg" style={{width:"100%",background:ttype==="buy"?"linear-gradient(135deg,#10B981,#059669)":"linear-gradient(135deg,#EF4444,#DC2626)",boxShadow:ttype==="buy"?"0 4px 20px rgba(16,185,129,.35)":"0 4px 20px rgba(239,68,68,.35)"}} onClick={doTrade} disabled={loading}>
                  {loading?"Processing…":`${ttype==="buy"?"Buy":"Sell"} ${tcoin}`}
                </button>
                <div className="tbal">Available cash: <span>{cur(port.cashBalance)}</span></div>
              </>}

              {ttype==="deposit"&&<>
                <div className="tlab">Amount (USD)</div>
                <div className="tiwrap"><input className="tinp" type="number" placeholder="0.00" inputMode="decimal" value={tamt} onChange={e=>setTamt(e.target.value)}/><span className="tsfx">USD</span></div>
                <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>{["100","500","1000","5000"].map(v=><button key={v} className={`qpill ${tamt===v?"act":""}`} onClick={()=>setTamt(v)}>${v}</button>)}</div>
                <div className="tlab">Payment Method</div>
                <select className="sel" style={{marginBottom:14}}><option>Bank Transfer (Free)</option><option>Credit / Debit Card (1.5%)</option><option>PayPal (2%)</option></select>
                <div className="tsum">
                  <div className="trow"><span className="trl">Amount</span><span className="trv">${tamt||"0.00"}</span></div>
                  <div className="trow"><span className="trl">Fee</span><span className="trv">$0.00</span></div>
                  <div className="trow"><span className="trl">You receive</span><span className="trt">${tamt||"0.00"}</span></div>
                </div>
                <button className="btn btn-primary btn-lg" style={{width:"100%"}} onClick={doTrade} disabled={loading}>{loading?"Processing…":"Deposit Funds"}</button>
                <div className="tbal">Balance: <span>{cur(port.cashBalance)}</span></div>
              </>}

              {ttype==="withdraw"&&<>
                <div className="tlab">Amount (USD)</div>
                <div className="tiwrap"><input className="tinp" type="number" placeholder="0.00" inputMode="decimal" value={tamt} onChange={e=>setTamt(e.target.value)}/><span className="tsfx">USD</span></div>
                <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
                  {["100","500","1000"].map(v=><button key={v} className={`qpill ${tamt===v?"act":""}`} onClick={()=>setTamt(v)}>${v}</button>)}
                  <button className="qpill" onClick={()=>setTamt(String(port.cashBalance))}>Max</button>
                </div>
                <div className="tlab">Withdraw To</div>
                <select className="sel" style={{marginBottom:14}}><option>Bank Account ••• 4291</option><option>PayPal</option><option>Crypto Wallet</option></select>
                <div className="tsum">
                  <div className="trow"><span className="trl">Amount</span><span className="trv">${tamt||"0.00"}</span></div>
                  <div className="trow"><span className="trl">Fee (0.5%)</span><span className="trv">${tamt?(parseFloat(tamt)*.005).toFixed(2):"0.00"}</span></div>
                  <div className="trow"><span className="trl">You receive</span><span className="trt">${tamt?(parseFloat(tamt)*.995).toFixed(2):"0.00"}</span></div>
                </div>
                <button className="btn btn-primary btn-lg" style={{width:"100%",background:"linear-gradient(135deg,#8B5CF6,#6D28D9)",boxShadow:"0 4px 20px rgba(139,92,246,.35)"}} onClick={doTrade} disabled={loading}>{loading?"Processing…":"Withdraw Funds"}</button>
                <div className="tbal">Available: <span>{cur(port.cashBalance)}</span></div>
              </>}
            </div>

            {/* Trade chart */}
            <div className="gcard" style={{padding:26}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <CoinIcon symbol={tcoin} size={36}/>
                  <div>
                    <div style={{fontSize:13,color:"var(--text3)",fontWeight:500}}>{COINS[tcoin]?.name} / USD</div>
                    <div className="pbig" style={{fontSize:26}}>${tlp.toLocaleString()}</div>
                    <div className="pchg" style={{color:(tci?.change24h||0)>=0?"var(--green)":"var(--red)"}}>{(tci?.change24h||0)>=0?"▲":"▼"} {Math.abs(tci?.change24h||0).toFixed(2)}%</div>
                  </div>
                </div>
                {/* Functional time range buttons */}
                <div style={{display:"flex",gap:4}}>
                  {(["1H","1D","1W","1M"] as Range[]).map(r=>(
                    <button key={r} className={`chip ${tradeRange===r?"active":""}`} onClick={()=>setTradeRange(r)}>{r}</button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={mob?160:240}>
                <AreaChart data={tcd}>
                  <defs>
                    <linearGradient id={`tg-${tcoin}-${priceDir[tcoin]?1:0}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={priceDir[tcoin]?"#10B981":"#EF4444"} stopOpacity={.3}/>
                      <stop offset="95%" stopColor={priceDir[tcoin]?"#10B981":"#EF4444"} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" hide/><YAxis hide domain={["auto","auto"]}/><Tooltip content={CT}/>
                  <Area type="monotone" dataKey="v" stroke={priceDir[tcoin]?"#10B981":"#EF4444"} strokeWidth={2.5} fill={`url(#tg-${tcoin}-${priceDir[tcoin]?1:0})`} dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginTop:20,paddingTop:16,borderTop:"1px solid var(--border)"}}>
                {Object.entries(COIN_STATS[tcoin]||{cap:"—",vol:"—",supply:"—"}).map(([k,v])=>(
                  <div key={k} style={{background:"var(--surface)",borderRadius:10,padding:"10px 12px"}}>
                    <div style={{fontSize:10,color:"var(--text3)",fontWeight:600,textTransform:"uppercase",letterSpacing:".5px",marginBottom:4}}>{k==="cap"?"Market Cap":k==="vol"?"24h Volume":"Circulating"}</div>
                    <div style={{fontSize:14,fontWeight:800,color:"var(--text)",fontFamily:"'Plus Jakarta Sans',sans-serif"}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          </div>
        )}

        {/* ══ PORTFOLIO ══ */}
        {page==="portfolio"&&<>
          <div className="stats" style={{marginBottom:mob?14:24}}>
            {[
              {l:"Total Value",  v:cur(port.totalValue),                  glow:"#6366F1"},
              {l:"Invested",     v:cur(port.totalPortfolioValue),          glow:"#06B6D4"},
              {l:"Cash",         v:cur(port.cashBalance),                  glow:"#10B981"},
              {l:"Assets Held",  v:port.holdings.filter(h=>h.amount>0).length,                                      glow:"#8B5CF6"},
            ].map((s,i)=>(
              <div key={i} className="stat"><div className="stat-glow" style={{background:s.glow}}/><div className="stat-label">{s.l}</div><div className="stat-value">{s.v}</div></div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:tab?"1fr":"1.8fr 1fr",gap:18,marginBottom:22}}>
            <div>
              <div className="stitle">All Holdings</div>
              <div className="hgrid" style={{gridTemplateColumns:"repeat(2,1fr)"}}>
                {Object.entries(COINS).map(([sym,m])=>{
                  const h=port.holdings.find(x=>x.symbol===sym);const amt=h?.amount||0;const val=h?.value||0;
                  const pct=port.totalPortfolioValue>0?((val/port.totalPortfolioValue)*100).toFixed(1):"0";
                  return(
                    <div key={sym} className="hi">
                      <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${m.color},transparent)`,opacity:amt>0?1:.3,borderRadius:"18px 18px 0 0"}}/>
                      <div className="hitop"><CoinIcon symbol={sym} size={32}/><div><div className="hsym">{sym}</div><div className="hnm">{m.name}</div></div><div style={{marginLeft:"auto",fontSize:11,color:"var(--text3)",fontWeight:600}}>{pct}%</div></div>
                      <div className="hamt" style={{color:amt>0?"var(--text)":"var(--text3)",fontSize:18}}>{amt||"—"}</div>
                      <div className="husd">${val.toLocaleString("en-US",{minimumFractionDigits:2})}</div>
                      <div className="hbar-bg"><div className="hbar" style={{width:`${pct}%`,background:`linear-gradient(90deg,${m.color},${m.color}66)`}}/></div>
                    </div>
                  );
                })}
              </div>
            </div>
            {!mob&&(
              <div>
                <div className="stitle">Allocation</div>
                <div className="gcard">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                        {pieData.map((e,i)=><Cell key={i} fill={e.color}/>)}
                      </Pie>
                      <Tooltip formatter={(v:any)=>`$${Number(v).toLocaleString()}`} contentStyle={{background:"#1C1E2E",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,color:"#F1F2F8"}}/>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:12}}>
                    {pieData.map((d,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}><CoinIcon symbol={d.name} size={18}/><span style={{fontSize:12,fontWeight:700,color:"var(--text)"}}>{d.name}</span></div>
                        <span style={{fontSize:12,color:"var(--text3)",fontWeight:600}}>{port.totalPortfolioValue>0?((d.value/port.totalPortfolioValue)*100).toFixed(1):0}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>}

        {/* ══ HISTORY ══ */}
        {page==="history"&&(
          <div className="gcard" style={{padding:0,overflow:"hidden"}}>
            <div style={{padding:mob?"14px 16px 12px":"22px 24px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
              <div className="stitle" style={{marginBottom:0}}>All Transactions</div>
              <span style={{fontSize:11,color:"var(--text3)",fontWeight:600}}>{txs.length} total</span>
            </div>
            <div className="txwrap">
              <table className="txt">
                <thead><tr><th>Type</th><th>Asset</th><th>Amount</th><th>Price</th><th>Total</th><th>Date</th><th>Status</th></tr></thead>
                <tbody>
                  {txs.map(tx=>(
                    <tr key={tx.id}>
                      <td><span className={`tbadge ${tx.type==="buy"?"badge-green":tx.type==="sell"?"badge-red":tx.type==="deposit"?"badge-blue":"badge-purple"}`}>{tx.type}</span></td>
                      <td style={{display:"flex",alignItems:"center",gap:8,color:"var(--text)",fontWeight:700}}><CoinIcon symbol={tx.symbol} size={20}/>{tx.symbol}</td>
                      <td>{tx.amount}</td>
                      <td>${(tx.price||0).toLocaleString()}</td>
                      <td style={{color:tx.type==="buy"||tx.type==="withdraw"?"var(--red)":"var(--green)",fontWeight:700}}>{tx.type==="buy"||tx.type==="withdraw"?"-":"+"}${(tx.total||0).toLocaleString()}</td>
                      <td>{(tx.created_at||"").slice(0,10)}</td>
                      <td><span className="badge badge-green">✓ {tx.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="txcards" style={{padding:"12px 14px 16px"}}>
              {txs.map(tx=>(
                <div key={tx.id} className="txc">
                  <div className="txctop">
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span className={`tbadge ${tx.type==="buy"?"badge-green":tx.type==="sell"?"badge-red":tx.type==="deposit"?"badge-blue":"badge-purple"}`}>{tx.type}</span>
                      <div style={{display:"flex",alignItems:"center",gap:6}}><CoinIcon symbol={tx.symbol} size={18}/><span className="txcsym" style={{color:COINS[tx.symbol]?.color||"var(--text)"}}>{tx.symbol}</span></div>
                    </div>
                    <span className="txcdate">{(tx.created_at||"").slice(0,10)}</span>
                  </div>
                  <div className="txcbot">
                    <span className="txcamt">{tx.amount} @ ${(tx.price||0).toLocaleString()}</span>
                    <span className="txctot" style={{color:tx.type==="buy"||tx.type==="withdraw"?"var(--red)":"var(--green)"}}>{tx.type==="buy"||tx.type==="withdraw"?"-":"+"}${(tx.total||0).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ SETTINGS ══ */}
        {page==="settings"&&(
          <div className="com-styler" style={{}}>
            {/* Profile banner */}
            <div className="gcard" style={{marginBottom:18,background:"linear-gradient(135deg,rgba(99,102,241,.12),rgba(139,92,246,.08))"}}>
              <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                <div onClick={()=>{setEditName(user.name);setAvatarPreview(null);setEditOpen(true);}} style={{cursor:"pointer",borderRadius:"50%",border:"3px solid var(--indigo2)",boxShadow:"0 0 0 3px rgba(99,102,241,.2)"}}>
                  <AvatarDisplay size={72} fontSize={26}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:800,fontSize:20,color:"var(--text)"}}>{user.name}</div>
                  <div style={{fontSize:13,color:"var(--text2)",marginTop:2}}>{user.email}</div>
                  {user.phone&&<div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{user.phone}</div>}
                  <div style={{display:"flex",alignItems:"center",gap:8,marginTop:10,flexWrap:"wrap"}}>
                    <span className="badge badge-green">✓ Verified</span>
                    {kycStatus.phone==="verified"&&<span className="badge badge-green"> Phone</span>}
                    {kycStatus.id==="verified"&&<span className="badge badge-green"> ID</span>}
                  </div>
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <button className="btn btn-ghost" onClick={()=>{setEditName(user.name);setAvatarPreview(null);setEditOpen(true);}}>Edit Profile</button>
                  <button className="btn btn-ghost" onClick={()=>setPwOpen(true)}>Change Password</button>
                </div>
              </div>
            </div>

            <div className="settings-grid">
              {/* Security */}
              <div className="gcard">
                <div style={{fontSize:11,fontWeight:700,letterSpacing:".8px",textTransform:"uppercase",color:"var(--text3)",marginBottom:4}}>🔒 Security</div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>Manage your account security</div>
                {([
                  {key:"twoFA",        label:"Two-Factor Auth",     desc:"Require 2FA on every login"},
                  {key:"notifications",label:"Login Notifications", desc:"Email alert on new sign-in"},
                ] as const).map(s=>(
                  <div key={s.key} className="setting-row">
                    <div><div className="setting-label">{s.label}</div><div className="setting-desc">{s.desc}</div></div>
                    <Toggle on={appSettings[s.key as keyof AppSettings] as boolean} onToggle={()=>{
                      const newVal=!appSettings[s.key as keyof AppSettings];
                      setAppSettings(p=>({...p,[s.key]:newVal}));
                      toast2(`${s.label} ${newVal?"enabled":"disabled"}`,"⚙");
                    }}/>
                  </div>
                ))}
              </div>

              {/* Preferences */}
              <div className="gcard">
                <div style={{fontSize:11,fontWeight:700,letterSpacing:".8px",textTransform:"uppercase",color:"var(--text3)",marginBottom:4}}>⚙ {t("preferences")}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>Customise your Wave experience</div>
                {[
                  {label:"Currency",   desc:"Displayed prices",    key:"currency", opts:["USD","EUR","GBP","NGN","BTC"]},
                  {label:"Theme",      desc:"App appearance",      key:"theme",    opts:["Dark","Light","System"]},
                  {label:"Language",   desc:"Interface language",  key:"language", opts:["English","French","Spanish","Portuguese"]},
                ].map((s,i)=>(
                  <div key={i} className="setting-row">
                    <div><div className="setting-label">{s.label}</div><div className="setting-desc">{s.desc}</div></div>
                    <select className="sel-input"
                      value={appSettings[s.key as keyof AppSettings] as string}
                      onChange={e=>{
                        setAppSettings(p=>({...p,[s.key]:e.target.value}));
                        toast2(`${s.label} → ${e.target.value}`,"✓");
                      }}>
                      {s.opts.map(o=><option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              {/* KYC */}
              <div className="gcard">
                <div style={{fontSize:11,fontWeight:700,letterSpacing:".8px",textTransform:"uppercase",color:"var(--text3)",marginBottom:4}}>KYC Verification</div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>Increase your limits by verifying your identity</div>
                {[
                  {label:"Email",         status:"done",              action:null},
                  {label:"Phone Number",  status:kycStatus.phone,     action:()=>setPhoneOpen(true)},
                  {label:"Gov. ID",       status:kycStatus.id,        action:()=>setIdOpen(true)},
                  {label:"Address Proof", status:kycStatus.address,   action:()=>setAddrOpen(true)},
                ].map((v,i)=>(
                  <div key={i} className="setting-row">
                    <div className="setting-label">{v.label}</div>
                    {v.status==="done"     ?<span className="badge badge-green">✓ Verified</span>
                    :v.status==="verified" ?<span className="badge badge-green">✓ Verified</span>
                    :v.status==="review"   ?<span className="badge badge-blue">⏳ In Review</span>
                    :<button className="btn btn-action btn-sm" onClick={v.action||undefined}>
                      {v.label.includes("Phone")?"Add Number":"Upload"}
                    </button>}
                  </div>
                ))}
              </div>

              {/* Account */}
              <div className="gcard">
                <div style={{fontSize:11,fontWeight:700,letterSpacing:".8px",textTransform:"uppercase",color:"var(--text3)",marginBottom:4}}>👤 {t("account")}</div>
                <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>Manage your account and data</div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <button className="btn btn-action" style={{justifyContent:"flex-start"}} onClick={()=>toast2("Statement ready for download",)}>Account Statement</button>
                  <button className="btn btn-action" style={{justifyContent:"flex-start"}} onClick={doLogout}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:6,flexShrink:0}}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>{t("signOut")}</button>
                  <button className="btn btn-danger" style={{justifyContent:"flex-start"}} onClick={()=>setDeleteOpen(true)}>🗑 Close Account</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ PRIVACY POLICY ══ */}
        {page==="privacy"&&(
          <div style={{maxWidth:760}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
              <button className="btn btn-ghost btn-sm" onClick={()=>setPage("settings")}>← Back</button>
            </div>
            <div className="gcard" style={{lineHeight:1.8}}>
              <div style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:900,fontSize:28,color:"var(--text)",marginBottom:6}}>Privacy Policy</div>
              <div style={{fontSize:12,color:"var(--text3)",marginBottom:28}}>Last updated: April 6, 2026 · Effective immediately</div>


              {[
                {h:"1. Introduction",t:'Wave Invest ("Wave", "we", "us", or "our") is committed to protecting your personal data. This Privacy Policy explains how we collect, use, store, and protect information when you use the Wave platform (the "Service"). By registering or using the Service, you agree to the practices described here. If you do not agree, please discontinue use immediately.'},
                {h:"2. Information We Collect",t:"We collect the following categories of personal data:\n\n\u2022 Identity Data - Full name, date of birth, country of residence, government-issued ID.\n\u2022 Contact Data - Email address, phone number.\n\u2022 Account Data - Password (stored as a bcrypt hash, never in plain text), account preferences, currency and theme settings.\n\u2022 Financial Data - Cash balance, trade history, deposit and withdrawal records. We do not store card numbers directly.\n\u2022 Technical Data - IP address, browser type, device identifiers, time zone, usage logs, and session tokens.\n\u2022 Profile Data - Avatar image, display name, language preference.\n\u2022 KYC Data - Verification documents submitted during identity verification."},
                {h:"3. How We Use Your Data",t:"We use your data to:\n\u2022 Create and manage your Wave account.\n\u2022 Verify your identity and comply with AML/KYC regulations.\n\u2022 Process trades, deposits, and withdrawals.\n\u2022 Send security alerts, login notifications, and service communications.\n\u2022 Personalise your experience (currency display, theme, language).\n\u2022 Detect and prevent fraud, security incidents, or Terms of Service violations.\n\u2022 Comply with legal obligations in applicable jurisdictions."},
                {h:"4. Legal Basis for Processing",t:"We process your data under: (a) Contract - to fulfil services you requested; (b) Legal obligation - to comply with AML, KYC, and financial regulations; (c) Legitimate interests - to protect platform security; (d) Consent - where you have given explicit consent, which you may withdraw at any time."},
                {h:"5. Data Storage and Security",t:"All data is stored on secured servers. Passwords are hashed using bcrypt (cost factor 12). Authentication uses short-lived JWT access tokens (15 min) and rotating refresh tokens (7 days). We use HTTPS/TLS 1.3 for all data in transit. Access to production systems is restricted and logged."},
                {h:"6. Data Sharing",t:"We do not sell your personal data. We may share it with:\n\u2022 KYC/AML verification partners for legal compliance.\n\u2022 Payment processors to facilitate deposits and withdrawals.\n\u2022 Cloud hosting providers under strict data processing agreements.\n\u2022 Law enforcement or regulatory authorities when legally required.\n\nAll third-party providers are contractually bound to handle your data in accordance with applicable data protection law."},
                {h:"7. Data Retention",t:"We retain your personal data for as long as your account is active, and for a minimum of 5 years after account closure as required by financial regulations. Transaction records are retained for 7 years for tax and audit purposes. You may request deletion of non-legally-required data at any time."},
                {h:"8. Your Rights",t:"Depending on your jurisdiction, you may have the right to:\n\u2022 Access the personal data we hold about you.\n\u2022 Correct inaccurate or incomplete data.\n\u2022 Request deletion of your data (subject to legal retention requirements).\n\u2022 Object to or restrict processing.\n\u2022 Data portability in a structured, machine-readable format.\n\u2022 Withdraw consent at any time.\n\nTo exercise any of these rights, contact: privacy@waveinvest.io"},
                {h:"9. Cookies",t:"We use only essential cookies required for authentication and session management. We do not use advertising, analytics, or tracking cookies. You may disable cookies in your browser settings, but this may prevent login from working correctly."},
                {h:"10. Children's Privacy",t:"The Wave platform is not directed at individuals under 18. We do not knowingly collect data from minors. If you believe a minor has registered, contact us immediately and we will delete the account and all associated data."},
                {h:"11. International Transfers",t:"If you access Wave from outside our servers' jurisdiction, your data may be transferred internationally. We apply appropriate safeguards including standard contractual clauses and data processing agreements."},
                {h:"12. Changes to This Policy",t:"We may update this Privacy Policy from time to time. We will notify you by email and in-app notification at least 14 days before material changes take effect. Continued use after that date constitutes acceptance of the updated policy."},
                {h:"13. Contact Us",t:"For privacy queries, data requests, or complaints:\n\nEmail: privacy@waveinvest.io\nMailing: Wave Invest Ltd, Privacy Officer, 123 Fintech Avenue, Suite 400, Lagos, Nigeria\n\nIf unsatisfied with our response, you have the right to lodge a complaint with your local data protection authority."},
              ].map((s,i)=>(
                <div key={i} style={{marginBottom:24}}>
                  <div style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:700,fontSize:15,color:"var(--text)",marginBottom:8}}>{s.h}</div>
                  <div style={{fontSize:13,color:"var(--text2)",whiteSpace:"pre-line"}}>{s.t}</div>
                </div>
              ))}

              <div style={{marginTop:32,paddingTop:20,borderTop:"1px solid var(--border)",display:"flex",gap:12,flexWrap:"wrap"}}>
                <button className="btn btn-primary" onClick={()=>setPage("settings")}>← Back to Settings</button>
                <button className="btn btn-ghost" onClick={()=>{
                  const blob=new Blob([(document.querySelector(".gcard") as HTMLElement)?.innerText||""],{type:"text/plain"});
                  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="wave-privacy-policy.txt";a.click();
                  toast2("Privacy policy downloaded","📄");
                }}>📄 Download PDF</button>
              </div>
            </div>
          </div>
        )}

        {/* ══ NOTIFICATIONS ══ */}
        {page==="notifications"&&(
          <div style={{maxWidth:600}}>
            <div className="gcard" style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:".8px",textTransform:"uppercase",color:"var(--text3)",marginBottom:4}}>🔔 Notification Preferences</div>
              <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>Control what alerts you receive</div>

              <div className="setting-row">
                <div><div className="setting-label">Login Notifications</div><div className="setting-desc">Email alert whenever a new sign-in is detected</div></div>
                <Toggle on={appSettings.notifications} onToggle={()=>{
                  setAppSettings(p=>({...p,notifications:!p.notifications}));
                  toast2(`Login notifications ${!appSettings.notifications?"enabled":"disabled"}`,"🔔");
                }}/>
              </div>
              <div className="setting-row">
                <div><div className="setting-label">Trade Alerts</div><div className="setting-desc">Notify when a buy/sell order is completed</div></div>
                <Toggle on={true} onToggle={()=>toast2("Trade alerts always on for security","🔒")}/>
              </div>
              <div className="setting-row" style={{borderBottom:"none"}}>
                <div><div className="setting-label">Price Alerts</div><div className="setting-desc">Get notified on major price movements</div></div>
                <Toggle on={false} onToggle={()=>toast2("Price alerts coming soon","📈")}/>
              </div>
            </div>

            <div className="gcard">
              <div style={{fontSize:11,fontWeight:700,letterSpacing:".8px",textTransform:"uppercase",color:"var(--text3)",marginBottom:16}}>⚡ Recent Activity</div>
              {txs.slice(0,5).map((tx,i)=>(
                <div key={i} className="setting-row" style={{borderBottom:i<4?"1px solid var(--border)":"none",paddingTop:12,paddingBottom:12}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:34,height:34,borderRadius:"50%",background:tx.type==="buy"||tx.type==="deposit"?"rgba(16,185,129,.15)":"rgba(239,68,68,.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>
                      {tx.type==="buy"?"🟢":tx.type==="sell"?"🔴":tx.type==="deposit"?"Deposit":""}       {toast&&<div style={{position:"fixed",bottom:24,right:16,left:16,maxWidth:380,margin:"0 auto",padding:"13px 18px",borderRadius:100,background:toast.ok===false?"rgba(239,68,68,.9)":"rgba(16,185,129,.9)",color:"#fff",fontSize:13,fontWeight:700,zIndex:999,display:"flex",alignItems:"center",gap:9,backdropFilter:"blur(10px)"}}><span>{toast.icon}</span>{toast.msg}</div>}
                    </div>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{tx.type.charAt(0).toUpperCase()+tx.type.slice(1)} {tx.symbol}</div>
                      <div style={{fontSize:11,color:"var(--text3)"}}>{tx.created_at?.slice(0,10)}</div>
                    </div>
                  </div>
                  <div style={{fontSize:13,fontWeight:700,color:tx.type==="buy"||tx.type==="withdraw"?"var(--red)":"var(--green)"}}>
                    {tx.type==="buy"||tx.type==="withdraw"?"-":"+"}${(tx.total||0).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>

            <div style={{marginTop:14}}>
              <button className="btn btn-danger" style={{width:"100%",justifyContent:"center"}} onClick={doLogout}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="bnav">
        <div className="bnavr">
          {NAV.slice(0,2).map(n=>(
            <div key={n.id} className={`bni ${page===n.id?"active":""}`} onClick={()=>nav(n.id)}>
              <span className="bni-icon">{n.icon}</span><span>{n.short}</span>
            </div>
          ))}
          <div className="bnav-fab" onClick={()=>nav("trade")} role="button" aria-label="Quick trade">+</div>
          {NAV.slice(2).map(n=>(
            <div key={n.id} className={`bni ${page===n.id?"active":""}`} onClick={()=>nav(n.id)}>
              <span className="bni-icon">{n.icon}</span><span>{n.short}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Toast */}
      {toast&&(
        <div style={{position:"fixed",bottom:mob?"calc(96px + env(safe-area-inset-bottom,16px))":"24px",right:mob?"12px":"24px",left:mob?"12px":"auto",maxWidth:mob?"none":"380px",padding:"13px 20px",borderRadius:100,background:toast.ok===false?"rgba(239,68,68,.92)":"rgba(16,185,129,.92)",color:"#fff",fontSize:13,fontWeight:700,zIndex:1001,display:"flex",alignItems:"center",gap:9,backdropFilter:"blur(12px)",boxShadow:"0 8px 30px rgba(0,0,0,.3)"}}>
          <span>{toast.icon}</span>{toast.msg}
        </div>
      )}
    </div>
  );
}
