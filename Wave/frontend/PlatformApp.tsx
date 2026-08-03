import React, { Suspense, lazy, useState, useEffect, useCallback, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import "./styles/platform.css";
import { api } from "./api/client";
import type { User, Price, Holding, Portfolio, Tx } from "./types";
import type { AppSettings, SiteUpdate, LoginEvent, Activity, ChartPt } from "./types/platform";
import { LANG, LANGUAGE_OPTIONS } from "./data/languages";
import { COINS, RANGE_POINTS, RANGE_VOL, FB_PRICES, LANDING_CHARTS, LANDING_META, COIN_STATS, COIN_DETAILS } from "./data/market";
import type { Range, LandingRange } from "./data/market";
import { generateChart as genChart } from "./utils/charts";
import { useWindowWidth as useWW } from "./hooks/useWindowWidth";
import { CoinIcon, WaveLogo, AppIcon, CT, Toggle, Modal } from "./components/PlatformPrimitives";

const AdminPanel=lazy(()=>import("./admin/AdminPanel"));

const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800;900&display=swap";
document.head.appendChild(fontLink);
const keyToBytes=(key:string)=>{const pad="=".repeat((4-key.length%4)%4);const raw=atob((key+pad).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));};
/* ════════════════ APP ════════════════ */
export default function App(){
  const[user,setUser]         =useState<User|null>(null);
  const[authChecking,setAuthChecking]=useState(true);
  const[accountLoading,setAccountLoading]=useState(false);
  // On first load, if a saved token exists, verify it and restore the session —
  // this is what fixes "refresh logs me out". Runs once when the app mounts.
  useEffect(()=>{
    let cancelled=false;
    if(!api.hasAccessToken()){
      setAuthChecking(false);
      return;
    }
    api.get("/auth/me").then(d=>{
      if(cancelled) return;
      const u=d.user;
      if(!u){
        // Backend returned 200 without a user object — treat it like an invalid
        // session instead of crashing on u.name below, so we fall through to
        // the .catch() and clear the bad token rather than silently breaking.
        throw new Error("Malformed /auth/me response: missing user");
      }
      const nm=u.name||"User";
      const initials=nm.trim().split(/\s+/).map((w:string)=>w[0]||"").join("").slice(0,2).toUpperCase()||"U";
      setAccountLoading(true);
      setUser({id:u.id,name:nm,email:u.email,initials,phone:u.phone||undefined,avatarUrl:u.avatarUrl||undefined,role:u.role,permissions:u.permissions});
      // right default currency one time only, and never again once the user (or this logic)
      // has set a currency, so it can never silently overwrite a manual choice.
      if(u.country&&!localStorage.getItem("wave_currency_auto")){
        setAppSettings(p=>({...p,currency:currencyForCountry(u.country)}));
        localStorage.setItem("wave_currency_auto","1");
      }
    }).catch(()=>{
      api.clearTokens(); // token was invalid/expired/malformed — clear it so we don't keep retrying
    }).finally(()=>{
      if(!cancelled) setAuthChecking(false);
    });
    return()=>{cancelled=true;};
  },[]);
  const[page,setPage]         =useState("dashboard");
  const[autoTier,setAutoTier] =useState("Balanced");
  const[autoAmount,setAutoAmount]=useState("250");
  const[autoFrequency,setAutoFrequency]=useState("Monthly");
  const[authTab,setAuthTab]   =useState<"login"|"register">("login");
  const[landingRange,setLandingRange]=useState<LandingRange>("1M");
  const[landingHover,setLandingHover]=useState<number|null>(null);
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
  const priceSnapshot=useRef<Record<string,Price>>(FB_PRICES);
  const[watchlist,setWatchlist]=useState<string[]>(()=>{
    try{return JSON.parse(localStorage.getItem("wave_watchlist")||"[]").filter((s:string)=>COINS[s]);}catch{return [];}
  });
  const[showWatchlist,setShowWatchlist]=useState(false);
  // Never display sample account data for a signed-in user. The real portfolio
  // is loaded before the dashboard is shown.
  const[port,setPort]         =useState<Portfolio>({cashBalance:0,totalPortfolioValue:0,totalValue:0,holdings:[]});
  const[txs,setTxs]           =useState<Tx[]>([]);
  const[charts,setCharts]     =useState<Record<string,ChartPt[]>>({});
  const[selCoin,setSelCoin]   =useState("BTC");
  const[chartRange,setChartRange]=useState<Range>("1D");
  const[tradeRange,setTradeRange]=useState<Range>("1D");
  const[ttype,setTtype]       =useState("buy");
  const[tcoin,setTcoin]       =useState("BTC");
  const[tamt,setTamt]         =useState("");
  const[loading,setLoading]   =useState(false);
  const[signingOut,setSigningOut]=useState(false);
  const[toast,setToast]       =useState<{msg:string;icon:string;ok?:boolean}|null>(null);
  const[email,setEmail]       =useState("");
  const[pw,setPw]             =useState("");
  const[sbOpen,setSbOpen]     =useState(false);      // mobile: sidebar slid in/out
  const[sbCollapsed,setSbCollapsed]=useState(true);  // desktop: sidebar hidden/shown
  const[profileOpen,setProfileOpen]=useState<"mobile"|"desktop"|null>(null);
  const profileRefs=useRef<Record<"mobile"|"desktop",HTMLDivElement|null>>({mobile:null,desktop:null});
  const sidebarRef=useRef<HTMLDivElement>(null);
  const sidebarTouchRef=useRef<{y:number;scrollTop:number}|null>(null);
  const onSidebarKeyDown=(e:any)=>{
    if(!sidebarRef.current) return;
    if(e.key==="ArrowDown"){
      e.preventDefault();
      sidebarRef.current.scrollTop += 48;
    }
    if(e.key==="ArrowUp"){
      e.preventDefault();
      sidebarRef.current.scrollTop -= 48;
    }
    if(e.key==="PageDown"){
      e.preventDefault();
      sidebarRef.current.scrollTop += sidebarRef.current.clientHeight;
    }
    if(e.key==="PageUp"){
      e.preventDefault();
      sidebarRef.current.scrollTop -= sidebarRef.current.clientHeight;
    }
    if(e.key==="Home"){
      e.preventDefault();
      sidebarRef.current.scrollTop = 0;
    }
    if(e.key==="End"){
      e.preventDefault();
      sidebarRef.current.scrollTop = sidebarRef.current.scrollHeight;
    }
  };
  const onSidebarTouchStart=(e:any)=>{
    if(!sidebarRef.current) return;
    sidebarTouchRef.current={y:e.touches[0].clientY,scrollTop:sidebarRef.current.scrollTop};
  };
  const onSidebarTouchMove=(e:any)=>{
    if(!sidebarRef.current || !sidebarTouchRef.current) return;
    const delta=e.touches[0].clientY - sidebarTouchRef.current.y;
    sidebarRef.current.scrollTop = sidebarTouchRef.current.scrollTop - delta;
  };
  const onSidebarTouchEnd=()=>{ sidebarTouchRef.current=null; };
  useEffect(()=>{
    if(!profileOpen) return;
    const closeOnOutsideClick=(event:MouseEvent)=>{
      if(!profileRefs.current[profileOpen]?.contains(event.target as Node)) setProfileOpen(null);
    };
    document.addEventListener("mousedown",closeOnOutsideClick);
    return()=>document.removeEventListener("mousedown",closeOnOutsideClick);
  },[profileOpen]);
  const[loginErr,setLoginErr] =useState("");
  const[siteUpdates,setSiteUpdates]=useState<SiteUpdate[]>([]);
  const[loginHistory,setLoginHistory]=useState<LoginEvent[]>([]);
  const[activities,setActivities]=useState<Activity[]>([]);
  const[notifLoading,setNotifLoading]=useState(false);
  const[pushSubscribed,setPushSubscribed]=useState<boolean|null>(null);
  const[pushBusy,setPushBusy]=useState(false);
  const[appSettings,setAppSettings]=useState<AppSettings>(()=>{
    try{
      const saved=localStorage.getItem("wave_prefs");
      if(saved) return {...{twoFA:false,notifications:true,currency:"USD",theme:"Light",language:"English"},...JSON.parse(saved)};
    }catch{}
    return {twoFA:false,notifications:true,currency:"USD",theme:"Light",language:"English"};
  });
  // Persist preferences whenever they change
  useEffect(()=>{try{localStorage.setItem("wave_prefs",JSON.stringify(appSettings));}catch{}},[appSettings]);
  useEffect(()=>{try{localStorage.setItem("wave_watchlist",JSON.stringify(watchlist));}catch{}},[watchlist]);

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
  },[chartRange,prices]);

  // Trade chart is separate — regens on tradeRange change
  const[tradeCharts,setTradeCharts]=useState<Record<string,ChartPt[]>>({});
  useEffect(()=>{
    const d:Record<string,ChartPt[]>={};
    Object.keys(COINS).forEach(s=>{d[s]=genChart(prices[s]?.price||100,RANGE_POINTS[tradeRange],RANGE_VOL[tradeRange]);});
    setTradeCharts(d);
  },[tradeRange,tcoin,prices]);

  useEffect(()=>{document.body.style.overflow=sbOpen?"hidden":"";return()=>{document.body.style.overflow="";};},[sbOpen]);

  const toast2=(msg:string,icon="✓",ok=true)=>{setToast({msg,icon,ok});setTimeout(()=>setToast(null),3500);};
  const toggleWatch=(symbol:string)=>setWatchlist(items=>items.includes(symbol)?items.filter(s=>s!==symbol):[...items,symbol]);

  const loadMarketPrices=useCallback(async()=>{
    try{
      const p=await api.get("/prices");
      const mapped:Record<string,Price>={};
      Object.entries(p).forEach(([sym,v]:any)=>{
        mapped[sym]={price:v.price||0,change24h:v.change24h||0};
      });
      const directions:Record<string,boolean>={};
      Object.entries(mapped).forEach(([sym,next])=>{
        directions[sym]=(next.price??0)>=(priceSnapshot.current[sym]?.price??next.price??0);
      });
      priceSnapshot.current=mapped;
      setPriceDir(directions);
      setPrices(mapped);
    }catch(e:any){console.warn("prices:",e.message);}
  },[]);

  // Market prices are public: keep both the landing page and signed-in app live.
  useEffect(()=>{
    loadMarketPrices();
    const interval=window.setInterval(loadMarketPrices,20000);
    return()=>window.clearInterval(interval);
  },[loadMarketPrices]);

  const loadData=useCallback(async()=>{
    // Each call is independent — one failing won't block the others
    await loadMarketPrices();

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
  },[loadMarketPrices]);
  useEffect(()=>{
    if(!user) return;
    setAccountLoading(true);
    loadData().finally(()=>setAccountLoading(false));
  },[user,loadData]);
  // Keep account balances and transaction history current while the dashboard is open.
  useEffect(()=>{
    if(!user) return;
    const interval=window.setInterval(()=>{loadData();},30000);
    return()=>window.clearInterval(interval);
  },[user,loadData]);

  useEffect(()=>{
    if(!user||page!=="notifications") return;
    setNotifLoading(true);
    Promise.allSettled([
      api.get("/notifications/updates").then(d=>setSiteUpdates(d.updates??[])).catch(e=>console.warn("site updates:",e.message)),
      api.get("/auth/sessions").then(d=>setLoginHistory(d.sessions??[])).catch(e=>console.warn("login history:",e.message)),
      api.get("/notifications/activity").then(d=>setActivities(d.activities??[])).catch(e=>console.warn("activity:",e.message)),
    ]).finally(()=>setNotifLoading(false));
  },[page,user]);

  const chargeCashBalance=async(label:string,amount:number)=>{
    if(!Number.isFinite(amount)||amount<=0){
      toast2("Enter a valid amount","⚠",false);
      return null;
    }
    setLoading(true);
    try{
      const d=await api.post("/trades",{type:"investment",amount:Number(amount.toFixed(2)),label});
      await loadData();
      toast2(`${label} activated — $${Number(amount.toFixed(2)).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} deducted from balance.`,"🟢");
      return d;
    }catch(e:any){
      toast2(e.message||`Unable to activate ${label}.`,"⚠",false);
      return null;
    }finally{
      setLoading(false);
    }
  };

  const handleAutoInvestActivation=async()=>{
    const amount=Number(autoAmount);
    if(!Number.isFinite(amount)||amount<=0){
      toast2("Enter a valid contribution amount","⚠",false);
      return;
    }
    await chargeCashBalance(`${autoTier} auto-invest plan`, amount);
  };

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
      setAccountLoading(true);
      setUser({id:u.id,name:nm,email:u.email,initials,phone:u.phone||undefined,avatarUrl:u.avatarUrl||undefined,role:u.role,permissions:u.permissions});
      if(u.country&&!localStorage.getItem("wave_currency_auto")){
        setAppSettings(p=>({...p,currency:currencyForCountry(u.country)}));
        localStorage.setItem("wave_currency_auto","1");
      }
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
      setAccountLoading(true);
      setUser({id:u.id,name:nm,email:u.email,initials,role:u.role,permissions:u.permissions});
      setAppSettings(p=>({...p,currency:currencyForCountry(regCountry)}));
      localStorage.setItem("wave_currency_auto","1");
      toast2(`Welcome to Wave, ${nm.split(" ")[0]}!`,);
    }catch(err:any){setLoginErr(err.message||"Registration failed.");}
    finally{setLoading(false);}
  };
  const doLogout=async()=>{
    if(signingOut) return;
    setSigningOut(true);
    const started=Date.now();
    try{await api.post("/auth/logout",{refreshToken:api.getRefreshToken()});}catch{}
    // Keep the confirmation motion visible briefly, even on a fast connection.
    const remaining=420-(Date.now()-started);
    if(remaining>0) await new Promise(resolve=>setTimeout(resolve,remaining));
    api.clearTokens();setUser(null);setAccountLoading(false);setPage("dashboard");setSigningOut(false);toast2("Signed out");
  };
  const signOutDevice=async(session:LoginEvent)=>{
    if(session.current){ doLogout(); return; }
    try{
      await api.post(`/auth/sessions/${session.id}/logout`,{});
      setLoginHistory(items=>items.filter(item=>item.id!==session.id));
      toast2(`${session.device} signed out`);
    }catch(e:any){toast2(e.message||"Unable to sign out this device","âš ",false);}
  };

  const checkPushStatus=async()=>{
    if(!("serviceWorker" in navigator)||!("PushManager" in window)){setPushSubscribed(false);return;}
    try{
      const reg=await navigator.serviceWorker.getRegistration("/sw.js");
      const sub=await reg?.pushManager.getSubscription();
      setPushSubscribed(!!sub);
    }catch{setPushSubscribed(false);}
  };
  const enableAdminPush=async()=>{
    setPushBusy(true);
    try{
      if(!("serviceWorker" in navigator)||!("PushManager" in window)) throw new Error("Push is not supported on this device");
      const cfg=await api.get("/admin/push/config");
      if(!cfg.publicKey) throw new Error("Push isn't configured on the backend yet");
      const reg=await navigator.serviceWorker.register("/sw.js");
      const existing=await reg.pushManager.getSubscription();
      const sub=existing||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyToBytes(cfg.publicKey)});
      await api.post("/admin/push/subscribe",sub);
      setPushSubscribed(true);
      toast2("This device will receive admin alerts","OK");
    }catch(e:any){toast2(e.message,"!",false);}
    finally{setPushBusy(false);}
  };
  const disableAdminPush=async()=>{
    setPushBusy(true);
    try{
      const reg=await navigator.serviceWorker.getRegistration("/sw.js");
      const sub=await reg?.pushManager.getSubscription();
      if(sub){
        await api.delete("/admin/push/subscribe",{endpoint:sub.endpoint});
        await sub.unsubscribe();
      }
      setPushSubscribed(false);
      toast2("Admin alerts turned off");
    }catch(e:any){toast2(e.message,"!",false);}
    finally{setPushBusy(false);}
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

  const requestAccountDeletion=async()=>{
    if(deleteConfirm!=="DELETE") return;
    setLoading(true);
    try{await api.post("/requests/account-deletion",{confirm:deleteConfirm});setDeleteOpen(false);setDeleteConfirm("");toast2("Account deletion request sent to admin review","!",false);}catch(e:any){toast2(e.message||"Unable to request deletion","!",false);}finally{setLoading(false);}
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

  /* Country → default currency. Only covers currencies Wave actually supports (see CURRENCY_SYMBOLS);
     everything else falls back to USD. Applied once at signup — never overwrites a currency the
     user already picked, so returning users' manual choice is never silently reset on login. */
  const EUR_COUNTRIES=new Set(["Austria","Belgium","Croatia","Cyprus","Estonia","Finland","France","Germany","Greece","Ireland","Italy","Latvia","Lithuania","Luxembourg","Malta","Netherlands","Portugal","Slovakia","Slovenia","Spain","Monaco","San Marino","Vatican City","Andorra"]);
  const currencyForCountry=(country?:string):string=>{
    if(!country) return "USD";
    if(country==="Nigeria") return "NGN";
    if(country==="United Kingdom") return "GBP";
    if(EUR_COUNTRIES.has(country)) return "EUR";
    return "USD";
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
  const selectedHolding=port.holdings.find(h=>h.symbol===selCoin);const selectedStats=COIN_STATS[selCoin];const selectedDetails=COIN_DETAILS[selCoin];
  const tcd=tradeCharts[tcoin]||[];const tlp=tcd[tcd.length-1]?.v||prices[tcoin]?.price||0;
  const tci=prices[tcoin];
  const tsub=tamt&&tci?(parseFloat(tamt)*tci.price).toFixed(2):"0.00";
  const tfee=tamt&&tci?(parseFloat(tamt)*tci.price*.001).toFixed(2):"0.00";
  const ttot=(parseFloat(tsub)+parseFloat(tfee)).toFixed(2);
  // Guarded landing-page chart series: if LANDING_CHARTS[landingRange] is ever empty,
  // fall back to a safe default instead of indexing [-1] and crashing the logged-out
  // landing page with "Cannot read properties of undefined (reading 'value')".
  const landingSeries=LANDING_CHARTS[landingRange]||[];
  const landingIndex=landingHover??landingSeries.length-1;
  const landingValue=landingSeries[landingIndex]?.value??0;
  const NAV=[
    {id:"dashboard",icon:"dashboard" as const,label:"Dashboard",short:"Home"},
    {id:"trade",icon:"trade" as const,label:"Trade",short:"Trade"},
    {id:"portfolio",icon:"portfolio" as const,label:"Portfolio",short:"Portfolio"},
    {id:"history",icon:"history" as const,label:"History",short:"History"},
  ];
  const LABELS:Record<string,string>={dashboard:t("dashboard"),trade:t("trade"),portfolio:t("portfolio"),history:t("history"),settings:t("settings"),privacy:t("privacy"),notifications:"Notifications",admin:"Admin Center"};
  const SERVICE_NAV=[
    {id:"invest",icon:"invest" as const,label:"Investment Plans"},
    {id:"copy",icon:"signal" as const,label:"Signal Copier"},
    {id:"managed",icon:"managed" as const,label:"Account Management"},
  ];
  const INVESTMENT_PLAN_TIERS:Record<string,number>={Starter:50,Balanced:250,Growth:1000};
  const FEATURED_PLAN_PRICES:Record<string,number>={Foundation:250,Momentum:1000,Legacy:10000};
  const SIGNAL_COPIER_FEE=250;
  const ACCOUNT_MANAGEMENT_FEE=1500;
  const pageTitle:Record<string,string>={invest:"Investment Plans",copy:"Signal Copier",managed:"Account Management"};
  const nav=(id:string)=>{setPage(id);setSbOpen(false);};
  const onActivate=(event:React.KeyboardEvent<HTMLElement>,action:()=>void)=>{
    if(event.key==="Enter"||event.key===" "){event.preventDefault();action();}
  };
  const openCoin=(symbol:string)=>{setSelCoin(symbol);setTcoin(symbol);nav("coin");};
  const goToDeposit=()=>{setTtype("deposit");setTamt("");nav("trade");};
  const pieData=port.holdings.filter(h=>h.amount>0).map(h=>({name:h.symbol,value:h.value,color:COINS[h.symbol]?.color||"#ccc"}));
  const isAdmin=user?.role==="owner"||user?.role==="admin"||Boolean(user?.permissions?.access_admin);
  useEffect(()=>{
    if(!isAdmin) return;
    checkPushStatus();
  },[isAdmin]);

  const AvatarDisplay=({size=40,fontSize=15}:{size?:number;fontSize?:number})=>(
    user?.avatarUrl
      ?<img src={user.avatarUrl} style={{width:size,height:size,borderRadius:"50%",objectFit:"cover"}}/>
      :<div className="av" style={{width:size,height:size,fontSize}}>{user?.initials}</div>
  );

  /* Profile circle + dropdown — sits beside the balance chip in both topbars */
  const ProfileMenu=({menuId,size=34,fontSize=13}:{menuId:"mobile"|"desktop";size?:number;fontSize?:number})=>{
    const isOpen=profileOpen===menuId;
    const toggleProfileMenu=()=>setProfileOpen(current=>current===menuId?null:menuId);
    return <div ref={node=>{profileRefs.current[menuId]=node;}} style={{position:"relative",zIndex:isOpen?500:1}}>
      <div onClick={toggleProfileMenu} onKeyDown={e=>onActivate(e,toggleProfileMenu)} style={{cursor:"pointer",borderRadius:"50%",border:"2px solid var(--border2)",lineHeight:0,transition:"border-color .15s"}} title={user?.name} role="button" tabIndex={0} aria-label="Profile menu" aria-expanded={isOpen}>
        <AvatarDisplay size={size} fontSize={fontSize}/>
      </div>
      {isOpen&&(
        <div style={{position:"absolute",zIndex:501,top:"calc(100% + 10px)",right:0,minWidth:190,background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:6,boxShadow:"0 20px 50px rgba(0,0,0,.42)",}}>
          <div style={{padding:"8px 10px",marginBottom:2}}>
            <div style={{fontSize:12,fontWeight:700,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{user?.name}</div>
            <div style={{fontSize:10,color:"var(--text3)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{user?.email}</div>
          </div>
          <div className="sitem" style={{margin:"1px 0",borderRadius:10}} onClick={()=>{nav("settings");setProfileOpen(null);}}>
            <span className="sicon">⚙</span>Profile &amp; Settings
          </div>
          <div className="sitem" style={{margin:"1px 0",borderRadius:10}} onClick={()=>{nav("notifications");setProfileOpen(null);}}>
            <span className="sicon">🔔</span>Notifications
          </div>
          <div className="sitem" style={{margin:"1px 0",borderRadius:10,color:"var(--red)"}} onClick={()=>{setProfileOpen(null);doLogout();}}>
            <span className="sicon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>
            Log Out
          </div>
        </div>
      )}
    </div>;
  };

  const kycLabel=(status:string)=>{
    if(status==="verified") return <span className="badge badge-green">Verified</span>;
    if(status==="review")   return <span className="badge badge-blue">KYC-Unverified</span>;
    return null;
  };

  /* ═══════════ LOGIN ═══════════ */
  if(authChecking||accountLoading) return(
    <div className="app" style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{textAlign:"center"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:14}}><WaveLogo size={38}/><span style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:800,fontSize:28,color:"var(--text)"}}>Wave</span></div>
        <p style={{color:"var(--text3)",fontSize:14}}>{authChecking?"Restoring your session…":"Loading your account…"}</p>
      </div>
    </div>
  );
  if(!user) return(
    <div className="app landing">
      <div className="landing-orb one"/><div className="landing-orb two"/>
      <nav className="landing-nav">
        <div className="landing-brand"><WaveLogo size={28}/>Wave</div>
        <div className="landing-navlinks"><a href="#platform">Platform</a><a href="#how-it-works">How it works</a><a href="#security">Security</a><a href="#faq">FAQ</a></div>
        <button className="btn btn-ghost landing-signin" onClick={()=>{setAuthTab("login");document.getElementById("access")?.scrollIntoView({behavior:"smooth",block:"center"});}}>Sign in</button>
      </nav>
      <main className="landing-main">
        <div className="landing-live-strip" aria-label="Live cryptocurrency prices from CoinGecko">
          <div className="landing-live-label"><i/>Live market prize</div>
          <div className="landing-live-track">
            {Object.keys(COINS).map(symbol=>{
              const quote=prices[symbol]||FB_PRICES[symbol];
              const up=(quote?.change24h||0)>=0;
              return <div className={`landing-live-quote ${priceDir[symbol]?"up":"down"}`} key={symbol}><CoinIcon symbol={symbol} size={18}/><b>{symbol}</b><span>${(quote?.price||0).toLocaleString(undefined,{maximumFractionDigits:quote?.price&&quote.price<10?4:2})}</span><em className={up?"positive":"negative"}>{up?"+":""}{(quote?.change24h||0).toFixed(2)}%</em></div>;
            })}
          </div>
        </div>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <div className="landing-eyebrow"><i/>The modern home for your wealth</div>
            <h1 className="landing-title">Invest with more <span>clarity.</span></h1>
            <p className="landing-lede">A composed, intelligent investing experience built to help you move from first deposit to your next financial milestone.</p>
            <div className="landing-actions"><button className="btn btn-primary" onClick={()=>{setAuthTab("register");document.getElementById("access")?.scrollIntoView({behavior:"smooth",block:"center"});}}>Start investing <span>→</span></button><a className="btn btn-ghost" href="#platform">Explore the platform</a></div>
            <div className="landing-trust"><span><b>◈</b> Bank-grade security</span><span><b>◎</b> Built for long-term investors</span></div>
          </div>
          <div id="access" className="landing-access">
            <div className="landing-access-inner">
      <div style={{position:"relative",zIndex:1,width:"100%"}}>
        <div style={{display:"none"}}>
        </div>
        <div className="gcard landing-auth-card">
          <div className="landing-auth-top"><div><div className="landing-auth-kicker">Secure access</div><div className="landing-auth-heading">{authTab==="login"?"Welcome back.":"Start with clarity."}</div><p className="landing-auth-copy">{authTab==="login"?"Pick up exactly where you left off.":"Create your account and take the first step at your own pace."}</p></div><div className="landing-auth-shield">◈</div></div>
          {/* Tabs */}
          <div className="landing-auth-tabs">
            {(["login","register"] as const).map(t=>(
              <button key={t} className={`landing-auth-tab ${authTab===t?"active":""}`} onClick={()=>{setAuthTab(t);setLoginErr("");}}>
                {t==="login"?"Sign In":"Create Account"}
              </button>
            ))}
          </div>

          {loginErr&&<div className="ct-err">⚠ {loginErr}</div>}

          {/* Social login buttons */}
          <div className="landing-social">
          <button className="btn btn-ghost" style={{width:"100%"}} onClick={()=>oauthNotReady("Google")}>
              <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              Continue with Google
            </button>
            <div className="landing-social-row">
              <button className="btn btn-ghost" onClick={()=>oauthNotReady("Apple")}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.4.07 2.38.81 3.18.84.96-.19 1.95-.93 3.24-.99 1.38-.07 2.61.49 3.41 1.52-3.41 2.08-2.51 6.53.77 7.8-.54 1.47-1.26 2.84-2.6 3.71zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                Apple
              </button>
              <button className="btn btn-ghost" onClick={()=>oauthNotReady("Facebook")}>
                <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#1877F2" d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.88v2.27h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z"/></svg>
                Facebook
              </button>
            </div>
          </div>

          <div className="landing-auth-divider">or use email</div>

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
                <input className="inp" placeholder="John Doe" type="text" autoComplete="name" value={regName} onChange={e=>{setRegName(e.target.value);setLoginErr("");}}/>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:600,color:"var(--text3)",letterSpacing:".5px",textTransform:"uppercase",marginBottom:4}}>Email *</div>
                <input className="inp" placeholder="Jack.Reaper@wave.io" type="email" autoComplete="email" value={regEmail} onChange={e=>{setRegEmail(e.target.value);setLoginErr("");}}/>
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
                <input className="inp" placeholder="Confirm password" type="password" autoComplete="new-password" value={regPw2} onChange={e=>{setRegPw2(e.target.value);setLoginErr("");}} onKeyDown={e=>e.key==="Enter"&&doRegister()}/>
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
                <div style={{fontSize:10,color:"var(--text3)"}}>{regPw.length<6?"Too short":regPw.length<8?"Weak":regPw.length<12?"Fair":regPw.length<16?"Good":"Strong Password comrade"}</div>
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

          <p className="landing-auth-security"><span>◈</span> Protected with 256-bit SSL encryption</p>
        </div>
      </div>
            </div>
          </div>
        </section>
        <div className="landing-logos"><span>Designed for conviction</span><span>Private by default</span><span>Built for every market</span><span>Always in your control</span></div>
        <section id="platform" className="landing-section"><div className="landing-section-head"><div className="landing-overline">A calmer way to invest</div><h2 className="landing-h2">Everything you need. Nothing you do not.</h2><p>Wave brings your cash, crypto, and investing decisions into one intentional workspace—so the important information is always close and the noise stays out of the way.</p></div><div className="landing-features">{[['O','One view of your money','See available cash, holdings, performance, and recent activity together. Your full financial picture should not require a maze of tabs.'],['~','Better context before a trade','Review price, amount, fees, and what you receive before confirming. Every action is designed to feel considered, not rushed.'],['*','A rhythm that fits your life','Follow markets in real time, build your own process, and return to a dashboard that makes your next step easy to find.']].map(([icon,title,text])=><article className="landing-feature" key={title}><div className="landing-icon">{icon}</div><h3>{title}</h3><p>{text}</p></article>)}</div></section>
        <section className="landing-section" style={{paddingTop:18}}><div className="landing-section-head"><div className="landing-overline">Built around good decisions</div><h2 className="landing-h2">More context. Less noise.</h2><p>Investing is personal. Wave gives you a clear place to learn from the past, understand the present, and decide what comes next.</p></div><div className="landing-principles"><article className="landing-principle featured"><h3>Keep the signal close.</h3><p>Your dashboard brings the details that matter into focus: your portfolio value, available balance, market movements, and a clean record of every action you take.</p><div className="landing-checklist"><span><b>01</b>Portfolio at a glance</span><span><b>02</b>Fees shown before you act</span><span><b>03</b>Activity you can follow</span></div></article><article className="landing-principle"><div className="landing-point"><strong>A calmer daily check-in</strong><p>See what changed without being pulled into a constant stream of alerts, opinions, or pressure.</p></div><div className="landing-point"><strong>Clear actions, plain language</strong><p>From deposits to trades, the key details appear before confirmation, so you know what you are choosing.</p></div><div className="landing-point"><strong>Your account, thoughtfully protected</strong><p>Security settings and account activity are easy to find, understand, and manage when you need them.</p></div></article></div></section>
        <section id="security" className="landing-section" style={{paddingTop:20}}><div className="landing-showcase"><div className="landing-terminal"><div className="terminal-top"><span>Portfolio overview</span><div className="terminal-range" aria-label="Portfolio chart range">{(Object.keys(LANDING_CHARTS) as LandingRange[]).map(range=><button key={range} className={landingRange===range?"active":""} onClick={()=>{setLandingRange(range);setLandingHover(null);}}>{range}</button>)}</div></div><div className="terminal-value">${landingValue.toLocaleString(undefined,{minimumFractionDigits:2})}</div><div className="terminal-gain">{LANDING_META[landingRange]}</div><div className="terminal-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={landingSeries} onMouseMove={(state:any)=>setLandingHover(typeof state?.activeTooltipIndex==="number"?state.activeTooltipIndex:null)} onMouseLeave={()=>setLandingHover(null)} margin={{top:8,right:3,left:3,bottom:0}}><defs><linearGradient id="landing-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#818CF8" stopOpacity=".42"/><stop offset="1" stopColor="#818CF8" stopOpacity="0"/></linearGradient></defs><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fill:"#777D91",fontSize:10}} dy={9}/><YAxis hide domain={["dataMin - 500","dataMax + 500"]}/><Tooltip cursor={{stroke:"rgba(199,210,254,.4)",strokeWidth:1}} content={({active,payload}:any)=>active&&payload?.[0]?<div className="landing-chart-tip"><b>${Number(payload[0].value).toLocaleString(undefined,{minimumFractionDigits:2})}</b><span>{payload[0].payload.label}</span></div>:null}/><Area type="monotone" dataKey="value" stroke="#A5B4FC" strokeWidth={3} fill="url(#landing-chart-fill)" animationDuration={700} activeDot={{r:5,fill:"#F7F8FC",stroke:"#818CF8",strokeWidth:3}}/></AreaChart></ResponsiveContainer></div></div><div className="landing-sidecard"><div><div className="landing-overline">Protected at every step</div><h2 className="landing-h2" style={{fontSize:"clamp(30px,3vw,43px)"}}>Your wealth deserves a quieter kind of security.</h2><p>Session-level controls, transparent activity, and built-in safeguards work together without getting in your way.</p></div><div className="side-stat">24/7<small>Account activity monitoring</small></div></div></div></section>
        <section className="landing-section" style={{paddingTop:42}}><div className="landing-stats">{[['$2.4B+','Assets represented'],['99.99%','Platform uptime'],['150+','Markets available'],['4.9/5','Member experience']].map(([value,label])=><div className="landing-stat" key={label}><strong>{value}</strong><span>{label}</span></div>)}</div></section>
        <section id="how-it-works" className="landing-section"><div className="landing-section-head"><div className="landing-overline">Designed for momentum</div><h2 className="landing-h2">From first step to better habits.</h2><p>Wave removes the friction between intent and action without oversimplifying the decisions that matter.</p></div><div className="landing-steps">{[['01','Create your secure account','Set up in minutes with the details you need to keep your account protected.'],['02','Fund with intention','Add cash, explore the market, and make every next step visible before you take it.'],['03','Build what is next','Invest directly or put your strategy on autopilot while staying in control.']].map(([number,title,text])=><div className="landing-step" key={number}><b>{number}</b><h3>{title}</h3><p>{text}</p></div>)}</div></section>
        <section className="landing-section" style={{paddingTop:18}}><div className="landing-section-head"><div className="landing-overline">Member stories</div><h2 className="landing-h2">Made for people who value their time.</h2></div><div className="landing-quotes">{[['It feels less like a trading app and more like a considered financial home.','AM','Avery M.','Product leader'],['The clarity is the difference. I always know where I am and what I am choosing next.','JL','Jordan L.','Independent investor'],['Everything is deliberate, from the activity feed to the way the portfolio moves.','SK','Samira K.','Creative director']].map(([quote,initials,name,role])=><figure className="landing-quote" key={name}><p>&ldquo;{quote}&rdquo;</p><figcaption className="landing-person"><span className="landing-avatar">{initials}</span><span><b>{name}</b>{role}</span></figcaption></figure>)}</div></section>
        <section id="faq" className="landing-section" style={{paddingTop:40}}><div className="landing-section-head"><div className="landing-overline">Questions, answered</div><h2 className="landing-h2">A straightforward experience deserves straightforward answers.</h2></div><div className="landing-faq">{[['How does Wave keep my account secure?','Wave uses encrypted transport, bcrypt password hashing, short-lived access tokens, and device-level session controls.'],['Can I start with any amount?','Yes. Your account starts with a zero balance, so you can add funds and start on your own terms.'],['Will I see fees before I act?','Always. Trade and withdrawal fees are made clear before confirmation, with activity recorded in your account history.']].map(([q,a])=><details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div></section>
        <section className="landing-cta"><h2>Let your next move feel inevitable.</h2><p>Join Wave and build a more intentional relationship with your financial future.</p><button className="btn" onClick={()=>{setAuthTab("register");document.getElementById("access")?.scrollIntoView({behavior:"smooth",block:"center"});}}>Create your account <span>-&gt;</span></button></section>
      </main>
      <footer className="landing-footer"><div className="landing-brand"><WaveLogo size={22}/>Wave</div><span>Copyright 2026 Wave Invest. Built for what is next.</span><div className="landing-footer-links"><a href="#security">Security</a><a href="#faq">Support</a><a href="#access">Privacy</a></div></footer>
      {toast&&<div style={{position:"fixed",bottom:24,right:16,left:16,maxWidth:380,margin:"0 auto",padding:"13px 18px",borderRadius:100,background:toast.ok===false?"rgba(239,68,68,.25)":"rgba(16,185,129,.25)",border:`1px solid ${toast.ok===false?"rgba(239,68,68,.5)":"rgba(16,185,129,.5)"}`,color:"#fff",fontSize:13,fontWeight:700,zIndex:999,display:"flex",alignItems:"center",gap:9,backdropFilter:"blur(15px)",WebkitBackdropFilter:"blur(15px)"}}><span>{toast.icon}</span>{toast.msg}</div>}
    </div>
  );

  /* ═══════════ APP ═══════════ */
  return(
    <div className={`app dashboard-shell ${appSettings.theme==="Light"?"theme-light":""}`}>
      {signingOut&&<div className="signout-overlay" role="status" aria-live="polite"><div className="signout-spinner"/><div className="signout-label">Signing you out…</div></div>}
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
          <div style={{fontSize:32,marginBottom:8}}></div>
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

      <Modal open={deleteOpen} onClose={()=>setDeleteOpen(false)} title="Close Account">
        <div style={{color:"var(--red)",fontSize:13,marginBottom:16,lineHeight:1.6}}>This is permanent and cannot be undone. All your data, holdings and history will be erased.</div>
        <div className="tlab">Type DELETE to confirm</div>
        <input className="inp" placeholder="DELETE" style={{marginBottom:20}} value={deleteConfirm} onChange={e=>setDeleteConfirm(e.target.value)}/>
        <button className="btn btn-danger" style={{width:"100%",justifyContent:"center"}} disabled={deleteConfirm!=="DELETE"} onClick={()=>{toast2("Account deletion requested. Our team will contact you.","⚠",false);setDeleteOpen(false);setDeleteConfirm("");}}>
          Delete My Account
        </button>
      </Modal>

      {/* Sidebar */}
      <div ref={sidebarRef} tabIndex={0} role="navigation" aria-label="Sidebar navigation" className={`sidebar ${sbOpen?"open":""} ${sbCollapsed?"collapsed":""}`} onKeyDown={onSidebarKeyDown} onTouchStart={onSidebarTouchStart} onTouchMove={onSidebarTouchMove} onTouchEnd={onSidebarTouchEnd}>
        <div className="shead" style={{paddingBottom:22}}>
          <div style={{background:"linear-gradient(135deg,rgba(99,102,241,.25),rgba(139,92,246,.18))",borderRadius:11,padding:"7px 8px",border:"1px solid rgba(99,102,241,.3)",boxShadow:"0 0 16px rgba(99,102,241,.25)",flexShrink:0}}>
            <WaveLogo size={22}/>
          </div>
          <div>
            <div className="slogo" style={{fontSize:21}}>Wave</div>
          </div>
          <div className="sb-close" onClick={()=>{setSbOpen(false);setSbCollapsed(true);}} onKeyDown={e=>onActivate(e,()=>{setSbOpen(false);setSbCollapsed(true);})} title="Close sidebar" role="button" tabIndex={0} aria-label="Close sidebar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </div>
        </div>
        <div className="ssec">Main</div>
        {NAV.map(n=>(
          <div key={n.id} className={`sitem ${page===n.id?"active":""}`} onClick={()=>nav(n.id)} onKeyDown={e=>onActivate(e,()=>nav(n.id))} role="button" tabIndex={0} aria-current={page===n.id?"page":undefined}>
            <span className="sicon"><AppIcon name={n.icon} size={17}/></span>{n.label}
          </div>
        ))}
        <div className="ssec" style={{marginTop:18}}>Wealth Services</div>
        {SERVICE_NAV.map(n=>(
          <div key={n.id} className={`sitem ${page===n.id?"active":""}`} onClick={()=>nav(n.id)} onKeyDown={e=>onActivate(e,()=>nav(n.id))} role="button" tabIndex={0} aria-current={page===n.id?"page":undefined}>
            <span className="sicon"><AppIcon name={n.icon} size={17}/></span>{n.label}
          </div>
        ))}
        {isAdmin&&<>
          <div className="ssec" style={{marginTop:18}}>Admin</div>
          <div className={`sitem ${page==="admin"?"active":""}`} onClick={()=>nav("admin")} onKeyDown={e=>onActivate(e,()=>nav("admin"))} role="button" tabIndex={0} aria-current={page==="admin"?"page":undefined}>
            <span className="sicon">+</span>Admin Center
          </div>
        </>}
        <div className="ssec" style={{marginTop:8}}>Account</div>
        <div className={`sitem ${page==="settings"?"active":""}`} onClick={()=>nav("settings")} onKeyDown={e=>onActivate(e,()=>nav("settings"))} role="button" tabIndex={0} aria-current={page==="settings"?"page":undefined}>
          <span className="sicon">⚙</span>Settings
        </div>
        <div className={`sitem ${page==="notifications"?"active":""}`} onClick={()=>nav("notifications")} onKeyDown={e=>onActivate(e,()=>nav("notifications"))} role="button" tabIndex={0} aria-current={page==="notifications"?"page":undefined} style={{position:"relative"}}>
          <span className="sicon">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </span>
          Notifications
          {appSettings.notifications&&<span style={{marginLeft:"auto",width:7,height:7,borderRadius:"50%",background:"var(--green)",flexShrink:0}}/>}
        </div>
        <div className="sbot">
          <div className="suser" onClick={()=>nav("settings")} onKeyDown={e=>onActivate(e,()=>nav("settings"))} role="button" tabIndex={0} aria-label="Open profile settings">
            <AvatarDisplay size={34} fontSize={13}/>
            <div style={{flex:1,minWidth:0}}><div className="suname">{user.name}</div><div className="suemail">{user.email}</div></div>
            {/* SVG logout icon */}
            <div className="logbtn" onClick={e=>{e.stopPropagation();doLogout();}} onKeyDown={e=>onActivate(e,()=>doLogout())} title="Sign out" role="button" tabIndex={0} aria-label="Sign out">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </div>
          </div>
        </div>
      </div>

      {/* Overlay — closes the sidebar on mobile when tapped outside it */}
      <div className={`overlay ${sbOpen?"open":""}`} onClick={()=>setSbOpen(false)}/>

     
      {/* Main */}
      <div className={`main ${sbCollapsed?"sb-collapsed":""}`}>
        {/* Mobile topbar */}
        <div className="mtop">
          <div className="mlogo-row">
            <div className="mmenu" onClick={()=>setSbOpen(true)} onKeyDown={e=>onActivate(e,()=>setSbOpen(true))} role="button" tabIndex={0} aria-label="Open navigation menu">
              <svg width="22" height="16" viewBox="0 0 22 16" fill="none"><rect y="0" width="22" height="2.5" rx="1.25" fill="currentColor"/><rect y="6.75" width="16" height="2.5" rx="1.25" fill="currentColor"/><rect y="13.5" width="22" height="2.5" rx="1.25" fill="currentColor"/></svg>
            </div>
            <WaveLogo size={24}/><div className="mlogo">Wave</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <button type="button" className="mchip balance-chip" onClick={goToDeposit} title="Add funds">{cur(port.cashBalance)}</button>
            <ProfileMenu menuId="mobile" size={30} fontSize={12}/>
          </div>
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
  <div style={{display:"flex",alignItems:"center",gap:14}}>
    {sbCollapsed&&<div className="sb-open" onClick={()=>setSbCollapsed(false)} onKeyDown={e=>onActivate(e,()=>setSbCollapsed(false))} title="Open sidebar" role="button" tabIndex={0} aria-label="Open sidebar">
      <svg width="18" height="14" viewBox="0 0 22 16" fill="none"><rect y="0" width="22" height="2.5" rx="1.25" fill="currentColor"/><rect y="6.75" width="16" height="2.5" rx="1.25" fill="currentColor"/><rect y="13.5" width="22" height="2.5" rx="1.25" fill="currentColor"/></svg>
    </div>}
    <div>
      <div className="ttl">
        {page==="dashboard"
          ? `Good ${new Date().getHours()<12?t("morning"):new Date().getHours()<17?t("afternoon"):t("evening")}, ${user.name.split(" ")[0]} 👋`
          : page==="coin"
            ? `${COINS[selCoin]?.name||selCoin} (${selCoin})`
            : (LANG[appSettings.language]?.[page]||LABELS[page]||pageTitle[page])
        }
      </div>
      <div className="tdate">{new Date().toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
    </div>
  </div>
  <div style={{display:"flex",alignItems:"center",gap:12}}>
    <button type="button" className="tchip balance-chip" onClick={goToDeposit} title="Add funds">{cur(port.cashBalance)}</button>
    <ProfileMenu menuId="desktop"/>
  </div>
</div>        {/* ══ DASHBOARD ══ */}
        {page==="admin"&&<Suspense fallback={<div className="gcard skeleton" style={{minHeight:360}} aria-label="Loading admin center"/>}><AdminPanel currentUser={user} notify={toast2}/></Suspense>}

        {page==="dashboard"&&<>
          <div className="stats" style={{marginTop:mob?12:0}}>
            {[
              {l:"Total Balance",  v:cur(port.totalValue),                  s:"+3.82% today",pos:true,  glow:"#6366F1"},
              {l:"Portfolio Value",v:cur(port.totalPortfolioValue),          s:"Invested",    pos:null,  glow:"#06B6D4"},
              {l:"Cash Balance",   v:cur(port.cashBalance),                  s:"Available",  pos:null,  glow:"#10B981"},
              {l:"24h P&L",        v:"+$1,248.50",                                                                     s:"+3.82%",     pos:true,  glow:"#8B5CF6"},
            ].map((s,i)=>(
              <div key={i} className={`stat ${s.l==="Total Balance"||s.l==="Cash Balance"?"balance-link":""}`} onClick={s.l==="Total Balance"||s.l==="Cash Balance"?goToDeposit:undefined}>
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
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:14}}>
                <div style={{fontSize:11,color:"var(--text3)",fontWeight:700,letterSpacing:".8px",textTransform:"uppercase"}}>Live Markets</div>
                <button className="btn btn-ghost btn-sm" onClick={()=>setShowWatchlist(v=>!v)} style={{padding:"5px 9px",fontSize:10}}>{showWatchlist?"All markets":"★ Watchlist"}</button>
              </div>
              <div className="mlist">
                {(showWatchlist?watchlist:Object.keys(COINS)).map(s=>{
                  const m=COINS[s];const ld=charts[s]||[];const lv=ld[ld.length-1]?.v||prices[s]?.price||0;const pos=(prices[s]?.change24h||0)>=0;
                  return(
                    <div key={s} className="mitem" onClick={()=>openCoin(s)}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}><CoinIcon symbol={s} size={32}/><div><div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{mob?s:m.name}</div><div style={{fontSize:10,color:"var(--text3)",fontWeight:500}}>{s}</div></div></div>
                      <button aria-label={`${watchlist.includes(s)?"Remove":"Add"} ${s} ${watchlist.includes(s)?"from":"to"} watchlist`} onClick={e=>{e.stopPropagation();toggleWatch(s);}} style={{border:"none",background:"transparent",cursor:"pointer",fontSize:17,padding:"4px",color:watchlist.includes(s)?"#F59E0B":"var(--text3)"}}>{watchlist.includes(s)?"★":"☆"}</button>
                      <div style={{textAlign:"right"}}><div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>${lv.toLocaleString()}</div><div style={{fontSize:10,fontWeight:700,color:pos?"var(--green)":"var(--red)",marginTop:2}}>{pos?"+":""}{(prices[s]?.change24h||0).toFixed(2)}%</div></div>
                    </div>
                  );
                })}
                {showWatchlist&&watchlist.length===0&&<div style={{padding:"18px 0",textAlign:"center",fontSize:12,color:"var(--text3)"}}>Star a market to add it to your watchlist.</div>}
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
                <div key={h.symbol} className="hi" onClick={()=>openCoin(h.symbol)}>
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
        {page==="coin"&&(
          <div className="page-wrap">
            <button className="btn btn-ghost btn-sm" onClick={()=>nav("dashboard")} style={{marginBottom:22}}>← Back to dashboard</button>
            <div className="coin-detail-head gcard">
              <div style={{display:"flex",alignItems:"center",gap:15,minWidth:0}}>
                <CoinIcon symbol={selCoin} size={52}/>
                <div><div style={{display:"flex",alignItems:"center",gap:9,flexWrap:"wrap"}}><h1 className="coin-detail-title">{COINS[selCoin]?.name}</h1><span className="badge badge-gray">{selCoin}</span></div><div style={{fontSize:12,color:"var(--text3)",marginTop:5}}>Live market overview</div></div>
              </div>
              <div className="coin-detail-actions"><button className="btn btn-ghost" onClick={()=>toggleWatch(selCoin)}>{watchlist.includes(selCoin)?"★ Watching":"☆ Watch"}</button><button className="btn btn-primary" onClick={()=>{setTtype("buy");nav("trade");}}>Buy {selCoin}</button></div>
            </div>
            <div className="coin-detail-grid" style={{marginTop:18}}>
              <div className="gcard coin-chart-card">
                <div style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"flex-start",flexWrap:"wrap",marginBottom:18}}>
                  <div><div style={{fontSize:11,color:"var(--text3)",fontWeight:700,letterSpacing:".9px",textTransform:"uppercase",marginBottom:7}}>{selCoin} price</div><div className="coin-detail-price">${lp.toLocaleString()}</div><div className="pchg" style={{color:(prices[selCoin]?.change24h||0)>=0?"var(--green)":"var(--red)"}}>{(prices[selCoin]?.change24h||0)>=0?"▲":"▼"} {Math.abs(prices[selCoin]?.change24h||0).toFixed(2)}% <span style={{color:"var(--text3)",fontSize:11}}>today</span></div></div>
                  <div className="range-pills">{(["1H","1D","1W","1M"] as Range[]).map(r=><button key={r} className={`chip ${chartRange===r?"active":""}`} onClick={()=>setChartRange(r)}>{r}</button>)}</div>
                </div>
                <ResponsiveContainer width="100%" height={mob?210:280}><AreaChart data={lcd}><defs><linearGradient id={`coin-detail-${selCoin}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COINS[selCoin]?.color} stopOpacity={.35}/><stop offset="100%" stopColor={COINS[selCoin]?.color} stopOpacity={0}/></linearGradient></defs><XAxis dataKey="t" hide/><YAxis hide domain={["auto","auto"]}/><Tooltip content={CT}/><Area type="monotone" dataKey="v" stroke={COINS[selCoin]?.color} strokeWidth={2.6} fill={`url(#coin-detail-${selCoin})`} dot={false}/></AreaChart></ResponsiveContainer>
              </div>
              <div className="gcard">
                <div className="stitle">Your position</div>
                <div className="coin-position-value">{selectedHolding?.amount||0} <span>{selCoin}</span></div>
                <div style={{fontSize:13,color:"var(--text2)",marginTop:5}}>{cur(selectedHolding?.value||0)} current value</div>
                <div style={{height:1,background:"var(--border)",margin:"22px 0"}}/>
                <div className="coin-mini-row"><span>Average market price</span><b>${lp.toLocaleString()}</b></div>
                <div className="coin-mini-row"><span>24h movement</span><b style={{color:(prices[selCoin]?.change24h||0)>=0?"var(--green)":"var(--red)"}}>{(prices[selCoin]?.change24h||0)>=0?"+":""}{(prices[selCoin]?.change24h||0).toFixed(2)}%</b></div>
                <button className="btn btn-primary" style={{width:"100%",marginTop:22}} onClick={()=>{setTtype("buy");nav("trade");}}>Trade {selCoin}</button>
              </div>
            </div>
            <div className="coin-stat-grid" style={{marginTop:18}}>
              {[{label:"Market cap",value:selectedStats?.cap||"—"},{label:"24h volume",value:selectedStats?.vol||"—"},{label:"Circulating supply",value:selectedStats?.supply||"—"},{label:"All-time high",value:selectedDetails?.ath||"—"},{label:"Market rank",value:selectedDetails?.rank||"—"}].map(item=><div className="gcard coin-stat" key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}
            </div>
            <div className="gcard" style={{marginTop:18}}><div className="stitle">About {COINS[selCoin]?.name}</div><p style={{maxWidth:720,fontSize:14,lineHeight:1.75,color:"var(--text2)"}}>{selectedDetails?.about}</p></div>
          </div>
        )}

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
                <div className="deposit-hero">
                  <div>
                    <div className="deposit-title">Instant deposit</div>
                    <p className="deposit-copy">Move funds into your account quickly with a clean, modern checkout designed to help you stay invested.</p>
                  </div>
                  <div className="deposit-badge"><span>Available balance</span><strong>{cur(port.cashBalance)}</strong></div>
                </div>
                <div className="deposit-panel">
                  <div className="deposit-row">
                    <div style={{flex:1}}>
                      <div className="tlab">Amount (USD)</div>
                      <div className="tiwrap"><input className="tinp" type="number" placeholder="0.00" inputMode="decimal" value={tamt} onChange={e=>setTamt(e.target.value)}/><span className="tsfx">USD</span></div>
                    </div>
                  </div>
                  <div className="deposit-quick">{["100","500","1000","5000"].map(v=><button key={v} className={`qpill ${tamt===v?"act":""}`} onClick={()=>setTamt(v)}>${v}</button>)}</div>
                  <div className="deposit-method">
                    <div className="tlab">Payment Method</div>
                    <select className="sel"><option>Bank Transfer (Free)</option><option>Credit / Debit Card (1.5%)</option><option>PayPal (2%)</option></select>
                  </div>
                  <div className="deposit-summary">
                    <div className="trow"><span className="trl">Amount</span><span className="trv">${tamt||"0.00"}</span></div>
                    <div className="trow"><span className="trl">Fee</span><span className="trv">$0.00</span></div>
                    <div className="trow"><span className="trl">You receive</span><span className="trt">${tamt||"0.00"}</span></div>
                  </div>
                  <div className="deposit-action">
                    <button className="btn btn-primary btn-lg" style={{width:"100%"}} onClick={doTrade} disabled={loading}>{loading?"Processing…":"Deposit Funds"}</button>
                    <div className="deposit-note">Your deposit will appear in your balance instantly after completion.</div>
                  </div>
                </div>
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
        {(page==="invest"||page==="copy"||page==="managed")&&(
          <div className="page-wrap">
            {page==="invest"&&<>
              <div style={{padding:mob?22:34,borderRadius:24,marginBottom:20,background:"linear-gradient(120deg,#172554,#4c1d95 55%,#111827)",border:"1px solid rgba(129,140,248,.4)"}}>
                <div style={{fontSize:11,fontWeight:800,color:"#c4b5fd",letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Wave Wealth</div>
                <div style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontSize:mob?27:36,fontWeight:900,lineHeight:1.15}}>Invest automatically. Grow consistently.</div>
                <p style={{color:"#ddd6fe",fontSize:14,lineHeight:1.6,maxWidth:600,marginTop:12}}>Pick a tier, choose how much and how often, then let Wave build your investment habit.</p>
                <button className="btn btn-primary" style={{marginTop:18}} onClick={()=>document.getElementById("auto-invest")?.scrollIntoView({behavior:"smooth"})}>Set up auto-invest</button>
              </div>
              <div id="auto-invest" className="gcard" style={{marginBottom:20,padding:mob?18:24}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",marginBottom:18,flexWrap:"wrap"}}><div><div className="stitle" style={{marginBottom:5}}>Your auto-invest plan</div><div style={{fontSize:12,color:"var(--text3)"}}>You can pause or change this anytime.</div></div><span className="badge badge-green">No setup fee</span></div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,marginBottom:18}}>{[["Starter","$50 / month","A simple mix of global ETFs and bonds.","#22c55e"],["Balanced","$250 / month","A diversified core with equities, ETFs and crypto.","#818cf8"],["Growth","$1,000 / month","Higher-growth allocation for long-term builders.","#f59e0b"]].map(x=><button key={x[0]} onClick={()=>{setAutoTier(x[0]);setAutoAmount(x[1].split(" ")[0].slice(1));}} style={{textAlign:"left",padding:16,borderRadius:14,cursor:"pointer",border:`1px solid ${autoTier===x[0]?x[3]:"var(--border)"}`,background:autoTier===x[0]?"rgba(99,102,241,.1)":"var(--surface)",color:"var(--text)"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><b>{x[0]}</b>{autoTier===x[0]&&<span style={{color:x[3],fontWeight:800}}>Selected</span>}</div><div style={{fontSize:13,fontWeight:800,marginBottom:6}}>{x[1]}</div><div style={{fontSize:11,color:"var(--text3)",lineHeight:1.45}}>{x[2]}</div></button>)}</div>
                <div style={{display:"grid",gridTemplateColumns:mob?"1fr":"1fr 1fr 1.2fr",gap:12,alignItems:"end"}}><div><div className="tlab">Contribution</div><div className="tiwrap" style={{marginBottom:0}}><input className="tinp" type="number" min="10" value={autoAmount} onChange={e=>setAutoAmount(e.target.value)}/><span className="tsfx">USD</span></div></div><div><div className="tlab">Frequency</div><select className="sel" value={autoFrequency} onChange={e=>setAutoFrequency(e.target.value)}><option>Weekly</option><option>Bi-weekly</option><option>Monthly</option></select></div><button className="btn btn-primary btn-lg" onClick={handleAutoInvestActivation}>Activate plan</button></div>
              </div>
              <div className="gcard" style={{padding:0,overflow:"hidden",marginBottom:20}}><div style={{padding:"14px 18px",display:"flex",justifyContent:"space-between",borderBottom:"1px solid var(--border)",fontWeight:800,fontSize:13}}><span>Live market pulse</span><span style={{color:"var(--green)",fontSize:11}}>● Live pricing</span></div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))"}}>{Object.keys(COINS).map(s=>{const p=prices[s],up=(p?.change24h||0)>=0;return <a key={s} href={`https://www.tradingview.com/symbols/${s}USD/`} target="_blank" rel="noreferrer" style={{padding:"14px 18px",borderRight:"1px solid var(--border)",textDecoration:"none",color:"inherit"}}><b style={{fontSize:12}}>{s}/USD</b><div style={{fontSize:16,fontWeight:800,margin:"6px 0"}}>${(p?.price||0).toLocaleString()}</div><span style={{fontSize:11,fontWeight:700,color:up?"var(--green)":"var(--red)"}}>{up?"+":""}{(p?.change24h||0).toFixed(2)}% · TradingView ↗</span></a>})}</div></div>
              <div className="stitle">Featured investment plans</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:16,marginBottom:24}}>{[["Foundation","$250","Conservative","Diversified income, bonds & global ETFs.","#22c55e"],["Momentum","$1,000","Balanced","Growth-focused stocks, crypto & alternatives.","#818cf8"],["Legacy","$10,000","Growth","Bespoke multi-asset strategy with advisor access.","#f59e0b"]].map(x=><div key={x[0]} className="gcard" style={{borderTop:`3px solid ${x[4]}`}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}><b style={{fontSize:18}}>{x[0]}</b><span style={{fontSize:11,color:x[4]}}>{x[2]}</span></div><p style={{fontSize:13,color:"var(--text2)",lineHeight:1.6}}>{x[3]}</p><div style={{fontSize:13,fontWeight:700,margin:"18px 0"}}>Minimum {x[1]}</div><button className="btn btn-primary" style={{width:"100%"}} onClick={()=>chargeCashBalance(`${x[0]} plan`, FEATURED_PLAN_PRICES[x[0]] || 0)}>Choose plan</button></div>)}</div>
              <div className="stitle">Investment categories</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:10}}>{["Stocks","ETFs","Mutual Funds","Bonds & Commodities","Options International","Precious Metals","Crypto","DeFi","NFTs","Real Estate","Oil & Gas","Renewable Energy","Web3","Medical Cannabis","Loans & Grants","Financial Planning","Retirement Planning"].map((x,i)=><button key={x} onClick={()=>toast2(`${x} added to your investment interests.`)} style={{textAlign:"left",padding:15,borderRadius:14,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text)",cursor:"pointer",fontSize:12,fontWeight:700}}><span style={{color:["#818cf8","#22c55e","#f59e0b"][i%3],marginRight:7}}>●</span>{x}</button>)}</div>
            </>}
            {page==="copy"&&<><div className="gcard" style={{padding:28,marginBottom:18,background:"linear-gradient(135deg,var(--bg2),rgba(99,102,241,.16))"}}><div style={{fontSize:11,color:"var(--indigo2)",fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Wave Signal Copier</div><div className="stitle" style={{fontSize:28,marginBottom:8}}>Copy strategies. Stay in control.</div><p style={{color:"var(--text2)",fontSize:13}}>Mirror selected signals with clear risk limits and full trade visibility.</p><button className="btn btn-primary" style={{marginTop:18}} onClick={()=>chargeCashBalance("Signal copier", SIGNAL_COPIER_FEE)}>Connect strategy</button></div><div className="stats" style={{marginBottom:18}}>{[["Copier balance","$24,850.00"],["Realized profit","+$3,420.60"],["Win rate","68.4%"],["Risk level","Moderate"]].map((x,i)=><div className="stat" key={x[0]}><div className="stat-label">{x[0]}</div><div className="stat-value" style={{fontSize:21,color:i===1?"var(--green)":"var(--text)"}}>{x[1]}</div></div>)}</div><div className="gcard" style={{padding:0,overflow:"hidden"}}><div style={{padding:"18px 22px",fontWeight:800}}>Copied trades & profits</div><div className="txwrap"><table className="txt"><thead><tr><th>Strategy</th><th>Instrument</th><th>Direction</th><th>Opened</th><th>Profit</th><th>Status</th></tr></thead><tbody>{[["Apex Momentum","BTCUSD","Buy","Today, 09:42","+$482.10","Open"],["Atlas FX","EURUSD","Sell","Yesterday, 14:10","+$236.40","Closed"],["Apex Momentum","XAUUSD","Buy","Jul 10, 11:25","+$611.80","Closed"]].map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j} style={{color:j===4?"var(--green)":undefined,fontWeight:j===4?800:undefined}}>{c}</td>)}</tr>)}</tbody></table></div></div></>}
            {page==="managed"&&<><div style={{display:"grid",gridTemplateColumns:tab?"1fr":"1.2fr .8fr",gap:18}}><div className="gcard" style={{padding:30,background:"linear-gradient(135deg,#10212b,#13243e)"}}><div style={{fontSize:11,color:"#67e8f9",fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Private account management</div><div style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontSize:30,fontWeight:900,lineHeight:1.2}}>Your ambitions, professionally managed.</div><p style={{color:"#bfdbfe",fontSize:14,lineHeight:1.6,marginTop:12}}>A tailored allocation across traditional, alternative and digital assets.</p><button className="btn btn-primary" style={{marginTop:20}} onClick={()=>toast2("Consultation request sent.")}>Request a consultation</button></div><div className="gcard"><div className="stitle">Account snapshot</div>{[["Managed value","$128,450.00"],["This month","+$4,821.28"],["Allocation","9 asset classes"],["Next review","July 24"]].map(x=><div key={x[0]} style={{display:"flex",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid var(--border)",fontSize:13}}><span style={{color:"var(--text3)"}}>{x[0]}</span><b style={{color:x[0]==="This month"?"var(--green)":"var(--text)"}}>{x[1]}</b></div>)}</div></div><div className="stitle" style={{marginTop:24}}>Managed portfolio allocation</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>{[["Global Equities","36%","#818cf8"],["Fixed Income","22%","#22c55e"],["Real Assets","18%","#f59e0b"],["Digital Assets","14%","#a78bfa"],["Cash & Alternatives","10%","#38bdf8"]].map(x=><div className="gcard" key={x[0]}><div style={{fontSize:12,color:"var(--text3)"}}>{x[0]}</div><div style={{fontSize:24,fontWeight:900,margin:"9px 0"}}>{x[1]}</div><div style={{height:5,borderRadius:5,background:"var(--surface)"}}><div style={{height:"100%",width:x[1],background:x[2],borderRadius:5}}/></div></div>)}</div><div className="gcard" style={{marginTop:18}}><div className="stitle">VIP & Inner Circle</div><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:14}}>{[["VIP Monthly","$149 / month"],["VIP Lifetime","$1,499 once"],["Inner Circle","By invitation"]].map(x=><div key={x[0]} style={{border:"1px solid var(--border)",borderRadius:14,padding:16}}><b>{x[0]}</b><div style={{fontSize:18,fontWeight:900,margin:"10px 0"}}>{x[1]}</div><p style={{fontSize:12,color:"var(--text2)"}}>Premium signals, market briefings and priority support.</p><button className="btn btn-ghost btn-sm" style={{marginTop:12}} onClick={()=>toast2(`${x[0]} interest registered.`)}>Register interest</button></div>)}</div></div></>}
          </div>
        )}

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
                    <div key={sym} className="hi" onClick={()=>openCoin(sym)}>
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
                  {label:"Language",   desc:"Interface language",  key:"language", opts:LANGUAGE_OPTIONS},
                ].map((s,i)=>(
                  <div key={i} className="setting-row">
                    <div><div className="setting-label">{s.label}</div><div className="setting-desc">{s.desc}</div></div>
                    <select className="sel-input"
                      value={appSettings[s.key as keyof AppSettings] as string}
                      onChange={e=>{
                        setAppSettings(p=>({...p,[s.key]:e.target.value}));
                        if(s.key==="currency") localStorage.setItem("wave_currency_auto","1");
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
              <div className="setting-row" style={{borderBottom:isAdmin?undefined:"none"}}>
                <div><div className="setting-label">Price Alerts</div><div className="setting-desc">Get notified on major price movements</div></div>
                <Toggle on={false} onToggle={()=>toast2("Price alerts coming soon","📈")}/>
              </div>
              {isAdmin&&<div className="setting-row" style={{borderBottom:"none"}}>
                <div><div className="setting-label">Admin Device Alerts</div><div className="setting-desc">Push notification on this device for new pending requests</div></div>
                <Toggle label="Toggle admin device alerts" on={!!pushSubscribed} onToggle={()=>pushBusy?null:(pushSubscribed?disableAdminPush():enableAdminPush())}/>
              </div>}
            </div>

            <div className="gcard" style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:".8px",textTransform:"uppercase",color:"var(--text3)",marginBottom:16}}>📢 Site Updates</div>
              {notifLoading?<div style={{fontSize:12,color:"var(--text3)"}}>Loading…</div>
              :siteUpdates.length===0?<div style={{fontSize:12,color:"var(--text3)"}}>No updates yet — you'll see new Wave features and announcements here.</div>
              :siteUpdates.map((u,i)=>(
                <div key={u.id} className="setting-row" style={{alignItems:"flex-start",borderBottom:i<siteUpdates.length-1?"1px solid var(--border)":"none",display:"block",paddingTop:12,paddingBottom:12}}>
                  <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:2}}>{u.title}</div>
                  <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.5,marginBottom:4}}>{u.body}</div>
                  <div style={{fontSize:11,color:"var(--text3)"}}>{new Date(u.created_at).toLocaleString()}</div>
                </div>
              ))}
            </div>

            <div className="gcard" style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:".8px",textTransform:"uppercase",color:"var(--text3)",marginBottom:16}}>🖥 Login Activity</div>
              {notifLoading?<div style={{fontSize:12,color:"var(--text3)"}}>Loading…</div>
              :loginHistory.length===0?<div style={{fontSize:12,color:"var(--text3)"}}>No login history yet — sign-ins across your devices will appear here.</div>
              :loginHistory.map((s,i)=>(
                <div key={s.id} className="setting-row" style={{borderBottom:i<loginHistory.length-1?"1px solid var(--border)":"none",paddingTop:12,paddingBottom:12}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:34,height:34,borderRadius:"50%",background:"rgba(99,102,241,.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>
                      {/\bmobile\b/i.test(s.device)?"📱":"💻"}
                    </div>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{s.device}{s.current&&<span className="badge badge-green" style={{marginLeft:8,fontSize:9}}>This device</span>}</div>
                      <div style={{fontSize:11,color:"var(--text3)"}}>Signed in {new Date(s.login_at).toLocaleString()}</div>
                      <button className="btn btn-danger btn-sm" style={{marginTop:8}} onClick={()=>signOutDevice(s)}>{s.current?"Sign out":"Sign out device"}</button>
                    </div>
                  </div>
                  <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,textAlign:"right"}}>
                    {s.logout_at?`Signed out ${new Date(s.logout_at).toLocaleString()}`:<span style={{color:"var(--green)"}}>● Active</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="gcard">
              <div style={{fontSize:11,fontWeight:700,letterSpacing:".8px",textTransform:"uppercase",color:"var(--text3)",marginBottom:16}}>⚡ Recent Activity</div>
              {activities.slice(0,5).map((tx,i)=>(
                <div key={i} className="setting-row" style={{borderBottom:i<4?"1px solid var(--border)":"none",paddingTop:12,paddingBottom:12}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:34,height:34,borderRadius:"50%",background:tx.type==="buy"||tx.type==="deposit"?"rgba(16,185,129,.15)":"rgba(239,68,68,.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>
                      {tx.type==="buy"?"🟢":tx.type==="sell"?"🔴":tx.type==="deposit"?"Deposit":""}
                    </div>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{tx.type==="investment"?`${tx.label} activated`:`${tx.type.charAt(0).toUpperCase()+tx.type.slice(1)} ${tx.label}`}</div>
                      <div style={{fontSize:11,color:"var(--text3)"}}>{new Date(tx.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                  <div style={{fontSize:13,fontWeight:700,color:tx.type==="buy"||tx.type==="withdraw"?"var(--red)":"var(--green)"}}>
                    {tx.type==="buy"||tx.type==="withdraw"||tx.type==="investment"?"-":"+"}${Number(tx.amount||0).toLocaleString()}
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
            <div key={n.id} className={`bni ${page===n.id?"active":""}`} onClick={()=>nav(n.id)} onKeyDown={e=>onActivate(e,()=>nav(n.id))} role="button" tabIndex={0} aria-current={page===n.id?"page":undefined}>
              <span className="bni-icon"><AppIcon name={n.icon} size={19}/></span><span>{n.short}</span>
            </div>
          ))}
          <div className="bnav-fab" onClick={()=>nav("trade")} onKeyDown={e=>onActivate(e,()=>nav("trade"))} role="button" tabIndex={0} aria-label="Quick trade">+</div>
          {NAV.slice(2).map(n=>(
            <div key={n.id} className={`bni ${page===n.id?"active":""}`} onClick={()=>nav(n.id)} onKeyDown={e=>onActivate(e,()=>nav(n.id))} role="button" tabIndex={0} aria-current={page===n.id?"page":undefined}>
              <span className="bni-icon"><AppIcon name={n.icon} size={19}/></span><span>{n.short}</span>
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
