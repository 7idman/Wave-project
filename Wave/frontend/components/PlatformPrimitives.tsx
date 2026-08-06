import { forwardRef, useEffect, useId, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { COINS } from "../data/market";

export const CoinIcon=({symbol,size=32}:{symbol:string;size?:number})=>{
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

export const WaveLogo=({size=28}:{size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <rect x="7" y="14" width="4" height="11" rx="2" fill="#818CF8" opacity="0.7"/>
    <rect x="14" y="9" width="4" height="16" rx="2" fill="#6366F1"/>
    <rect x="21" y="6" width="4" height="19" rx="2" fill="#818CF8" opacity="0.85"/>
  </svg>
);

export type AppIconName="dashboard"|"trade"|"portfolio"|"history"|"invest"|"signal"|"managed"|"settings"|"notifications"|"plus"|"transactions"|"stocks";
export const AppIcon=({name,size=18}:{name:AppIconName;size?:number})=>{
  const paths:Record<AppIconName,JSX.Element>={
    dashboard:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>, trade:<><path d="M4 7h13"/><path d="m14 3 4 4-4 4"/><path d="M20 17H7"/><path d="m10 13-4 4 4 4"/></>, portfolio:<><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5z"/><path d="M4 9h13a2 2 0 0 1 2 2v2H14a2 2 0 0 0 0 4h5"/></>, history:<><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/></>, invest:<><path d="m12 3 7.5 4.2L12 11.4 4.5 7.2z"/><path d="m4.5 12 7.5 4.2 7.5-4.2"/><path d="m4.5 16.8 7.5 4.2 7.5-4.2"/></>, signal:<><path d="M4 17 9 12l3 3 7-8"/><path d="M14 7h5v5"/></>, managed:<><path d="M12 3.5 19 6v5.5c0 4.3-3 7.4-7 9-4-1.6-7-4.7-7-9V6z"/><path d="M9.2 12.2 11 14l3.8-4"/></>, settings:<><circle cx="12" cy="12" r="3"/><path d="M5 12h2m10 0h2M12 5v2m0 10v2M7.1 7.1l1.4 1.4m7 7 1.4 1.4m0-9.8-1.4 1.4m-7 7L7.1 17"/></>, notifications:<><path d="M18 9a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M10 21h4"/></>, plus:<><path d="M12 5v14M5 12h14"/></>, transactions:<><path d="M7 7h11l-3-3"/><path d="M17 17H6l3 3"/></>, stocks:<><path d="M4 20V10"/><path d="M11 20V4"/><path d="M18 20v-7"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
};

export const CT=({active,payload}:any)=>active&&payload?.length?<div style={{background:"rgba(15,17,26,.95)",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,padding:"7px 12px",fontSize:12,color:"#fff",fontWeight:600}}>${payload[0].value.toLocaleString()}</div>:null;
export const Toggle=({on,onToggle,label="Toggle setting"}:{on:boolean;onToggle:()=>void;label?:string})=>(
  <button type="button" onClick={onToggle} aria-label={label} aria-pressed={on} style={{width:46,height:26,borderRadius:13,position:"relative",cursor:"pointer",border:"none",outline:"none",background:on?"linear-gradient(135deg,#818CF8,#6366F1)":"rgba(255,255,255,.08)",transition:"background .2s",flexShrink:0}}>
    <div style={{position:"absolute",top:3,left:on?23:3,width:20,height:20,borderRadius:"50%",background:"white",transition:"left .2s",boxShadow:"0 2px 6px rgba(0,0,0,.3)"}}/>
  </button>
);

export const Card=({children,className="",...props}:{children:ReactNode;className?:string}&HTMLAttributes<HTMLDivElement>)=>(
  <div className={`gcard ui-card ${className}`} {...props}>{children}</div>
);

export const Button=({className="",type="button",...props}:{className?:string}&ButtonHTMLAttributes<HTMLButtonElement>)=>(
  <button type={type} className={`btn ${className}`} {...props}/>
);

export const Input=forwardRef<HTMLInputElement,InputHTMLAttributes<HTMLInputElement>>(({className="",...props},ref)=>(
  <input ref={ref} className={`inp ${className}`} {...props}/>
));
Input.displayName="Input";

export const Badge=({children,tone="blue",className=""}:{children:ReactNode;tone?:"blue"|"green"|"red"|"purple"|"gray";className?:string})=>(
  <span className={`badge badge-${tone} ${className}`}>{children}</span>
);

export const Tooltip=({label,children}:{label:string;children:ReactNode})=>(
  <span className="ui-tooltip" data-tooltip={label}>{children}</span>
);

export const Dropdown=({children,className="",...props}:{children:ReactNode;className?:string}&HTMLAttributes<HTMLDivElement>)=>(
  <div className={`ui-dropdown ${className}`} {...props}>{children}</div>
);

/* ── Modal ── */
export const Modal=({open,onClose,title,children}:{open:boolean;onClose:()=>void;title:string;children:ReactNode})=>{
  const titleId=useId();
  useEffect(()=>{
    if(!open) return;
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==="Escape") onClose();};
    document.addEventListener("keydown",onKeyDown);
    return()=>document.removeEventListener("keydown",onKeyDown);
  },[open,onClose]);
  if(!open) return null;
  return(
    <div className="ui-modal-backdrop" onMouseDown={onClose}>
      <div className="ui-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <span id={titleId} style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:800,fontSize:18,color:"var(--text)"}}>{title}</span>
          <button onClick={onClose} style={{width:30,height:30,borderRadius:"50%",background:"rgba(255,255,255,.08)",border:"none",cursor:"pointer",color:"#9496A8",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};

/* ── CSS ── */
