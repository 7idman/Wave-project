import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Modal } from "../components/PlatformPrimitives";
import { PanelLoading } from "../components/PlatformFeedback";
import type { User } from "../types";

type Tab="requests"|"members"|"roles"|"violations"|"updates"|"search"|"strategies"|"managed"|"promotions"|"security"|"activity";
type AdminRequest={id:number;type:string;status:string;amount?:number;title:string;details?:string;user_email:string;user_name:string;created_at:string;reviewed_by_email?:string;reviewed_at?:string;admin_note?:string};
type Role={role_key:string;name:string;permissions:Record<string,boolean>;is_owner?:number};
type Member={id:number;email:string;name:string;avatar_url?:string;role:string;account_status:string;created_at:string};
type Violation={id:number;email:string;name:string;reason:string;severity:string;account_status:string};
type SiteUpdate={id:number|string;title:string;body:string;created_at:string};
type SearchUser={id:number;email:string;name:string;avatar_url?:string;phone?:string;role:string;account_status:string;created_at:string};
type ConfirmAction={kind:"reject"|"ban"|"revoke";id:number;label:string};
type AdminStrategy={id:number;name:string;description:string;fee:number;status:string;cashBalance:number;holdingsValue:number;totalValue:number;subscribers:number};
type StrategyTrade={id:number;symbol:string;side:string;amount:number;price:number;created_at:string};
type StrategyMirrorJob={id:number;strategy_trade_id:number;portfolio_id:number;status:"failed"|"skipped";attempt_count:number;last_error?:string;created_at:string;strategy_name:string;symbol:string;side:string};
type AdminManagedAccount={portfolioId:number;userId:number;email:string;name:string;cashBalance:number;holdingsValue:number;totalValue:number;createdAt:string};
type Promotion={id:number;name:string;bonus_pct:number;min_tier:string;min_deposit:number;lock_days:number;start_at:string;end_at:string};
type SecurityEvent={id:number;type:string;user_id?:number;user_email?:string;ip?:string;metadata:Record<string,any>;created_at:string};
type ClientError={id:number;user_id?:number;user_email?:string;message:string;stack?:string;boundary?:string;url?:string;created_at:string};
type AdminReferral={id:number;status:string;threshold_amount:number;completed_at?:string;created_at:string;referrer_email:string;referrer_name:string;referee_email:string;referee_name:string};
type AdminAutoInvestPlan={id:number;symbol:string;weekly_amount:number;status:string;last_run_at?:string;next_run_at:string;user_email:string};
type StockRefreshJob={id:number;source:"scheduled"|"admin";status:"pending"|"processing"|"completed"|"failed";total:number;processed:number;updated:number;skipped:number;lastSymbol?:string|null;error?:string|null;createdAt:string;updatedAt:string;completedAt?:string|null};

function AdminAvatar({name,avatarUrl}:{name:string;avatarUrl?:string}){
  const initials=(name||"?").trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
  return avatarUrl
    ? <img src={avatarUrl} alt="" style={{width:32,height:32,borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>
    : <div style={{width:32,height:32,borderRadius:"50%",background:"var(--surface2)",color:"var(--text2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>{initials}</div>;
}
const PERMS=["access_admin","manage_requests","manage_roles","manage_members","manage_announcements","ban_users"];
const blankPerms=()=>Object.fromEntries(PERMS.map(p=>[p,false])) as Record<string,boolean>;

export default function AdminPanel({currentUser,notify}:{currentUser:User|null;notify:(msg:string,icon?:string,ok?:boolean)=>void}) {
  const[tab,setTab]=useState<Tab>("requests"),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const[requests,setRequests]=useState<AdminRequest[]>([]),[roles,setRoles]=useState<Role[]>([]),[members,setMembers]=useState<Member[]>([]),[violations,setViolations]=useState<Violation[]>([]),[updates,setUpdates]=useState<SiteUpdate[]>([]);
  const[syncing,setSyncing]=useState(false),[lastSynced,setLastSynced]=useState<Date|null>(null);
  const[reqView,setReqView]=useState<"pending"|"reviewed">("pending");
  const[email,setEmail]=useState(""),[memberRole,setMemberRole]=useState("admin"),[roleName,setRoleName]=useState(""),[rolePerms,setRolePerms]=useState<Record<string,boolean>>(blankPerms());
  const[announceTitle,setAnnounceTitle]=useState(""),[announceBody,setAnnounceBody]=useState("");
  const[confirm,setConfirm]=useState<ConfirmAction|null>(null),[confirmReason,setConfirmReason]=useState(""),[confirmBusy,setConfirmBusy]=useState(false);
  const[searchQuery,setSearchQuery]=useState(""),[searchResults,setSearchResults]=useState<SearchUser[]>([]),[searching,setSearching]=useState(false);
  const[adminStrategies,setAdminStrategies]=useState<AdminStrategy[]>([]),[strategiesLoading,setStrategiesLoading]=useState(false);
  const[newStratName,setNewStratName]=useState(""),[newStratDesc,setNewStratDesc]=useState(""),[newStratFee,setNewStratFee]=useState("");
  const[fundTarget,setFundTarget]=useState<AdminStrategy|null>(null),[fundAmount,setFundAmount]=useState(""),[fundBusy,setFundBusy]=useState(false);
  const[tradeTarget,setTradeTarget]=useState<AdminStrategy|null>(null),[tradeSymbol,setTradeSymbol]=useState(""),[tradeSide,setTradeSide]=useState<"buy"|"sell">("buy"),[tradeAmount,setTradeAmount]=useState(""),[tradeBusy,setTradeBusy]=useState(false);
  const[tradesView,setTradesView]=useState<AdminStrategy|null>(null),[strategyTrades,setStrategyTrades]=useState<StrategyTrade[]>([]),[tradesLoading,setTradesLoading]=useState(false);
  const[mirrorRecoveryJobs,setMirrorRecoveryJobs]=useState<StrategyMirrorJob[]>([]),[mirrorRecoveryLoading,setMirrorRecoveryLoading]=useState(false),[retryingMirrorJob,setRetryingMirrorJob]=useState<number|null>(null);
  const[adminManaged,setAdminManaged]=useState<AdminManagedAccount[]>([]),[managedTabLoading,setManagedTabLoading]=useState(false);
  const[managedPickQuery,setManagedPickQuery]=useState(""),[managedPickResults,setManagedPickResults]=useState<SearchUser[]>([]),[managedPicking,setManagedPicking]=useState(false);
  const[managedFundTarget,setManagedFundTarget]=useState<AdminManagedAccount|null>(null),[managedFundAmount,setManagedFundAmount]=useState(""),[managedFundBusy,setManagedFundBusy]=useState(false);
  const[managedAllocTarget,setManagedAllocTarget]=useState<AdminManagedAccount|null>(null),[managedAllocSymbol,setManagedAllocSymbol]=useState(""),[managedAllocAmount,setManagedAllocAmount]=useState(""),[managedAllocBusy,setManagedAllocBusy]=useState(false);
  const[promotions,setPromotions]=useState<Promotion[]>([]),[promotionsLoading,setPromotionsLoading]=useState(false);
  const[promoName,setPromoName]=useState(""),[promoBonusPct,setPromoBonusPct]=useState(""),[promoMinTier,setPromoMinTier]=useState("bronze"),[promoMinDeposit,setPromoMinDeposit]=useState(""),[promoLockDays,setPromoLockDays]=useState("7"),[promoStart,setPromoStart]=useState(""),[promoEnd,setPromoEnd]=useState("");
  const[securityEvents,setSecurityEvents]=useState<SecurityEvent[]>([]),[securityLoading,setSecurityLoading]=useState(false),[securityTypeFilter,setSecurityTypeFilter]=useState("");
  const[clientErrors,setClientErrors]=useState<ClientError[]>([]),[clientErrorsLoading,setClientErrorsLoading]=useState(false);
  const[adminReferrals,setAdminReferrals]=useState<AdminReferral[]>([]),[adminAutoInvest,setAdminAutoInvest]=useState<AdminAutoInvestPlan[]>([]),[activityLoading,setActivityLoading]=useState(false);
  const[stockRefresh,setStockRefresh]=useState<StockRefreshJob|null>(null),[stockRefreshBusy,setStockRefreshBusy]=useState(false);
  const canOwner=currentUser?.role==="owner";
  const can=(perm:string)=>canOwner||!!currentUser?.permissions?.[perm];
  const pendingCount=useMemo(()=>requests.filter(r=>r.status==="pending").length,[requests]);
  const pendingRequests=useMemo(()=>requests.filter(r=>r.status==="pending"),[requests]);
  const reviewedRequests=useMemo(()=>requests.filter(r=>r.status!=="pending"),[requests]);
  const refreshAdminData=async({showLoading=true,showError=true}:{showLoading?:boolean;showError?:boolean}={})=>{if(showLoading) setLoading(true);else setSyncing(true);if(showError) setError("");try{const d=await api.get("/admin/summary");setRequests(d.requests||[]);setRoles(d.roles||[]);setMembers(d.members||[]);setViolations(d.violations||[]);setUpdates(d.updates||[]);setLastSynced(new Date());}catch(e:any){if(showError) setError(e.message||"Admin access unavailable");}finally{if(showLoading) setLoading(false);else setSyncing(false);}};
  useEffect(()=>{refreshAdminData();const id=setInterval(()=>refreshAdminData({showLoading:false,showError:false}),30000);return()=>clearInterval(id);},[]);

  // Live user search — debounced so we don't fire a request on every keystroke.
  useEffect(()=>{
    const q=searchQuery.trim();
    if(!q){setSearchResults([]);setSearching(false);return;}
    setSearching(true);
    const t=setTimeout(async()=>{
      try{const d=await api.get(`/admin/users/search?q=${encodeURIComponent(q)}`);setSearchResults(d.users||[]);}
      catch(e:any){notify(e.message,"!",false);}
      finally{setSearching(false);}
    },350);
    return()=>clearTimeout(t);
  },[searchQuery]);

  const refreshStrategies=async()=>{setStrategiesLoading(true);try{const d=await api.get("/admin/strategies");setAdminStrategies(d.strategies||[]);}catch(e:any){notify(e.message,"!",false);}finally{setStrategiesLoading(false);}};
  const refreshMirrorRecovery=async()=>{
    setMirrorRecoveryLoading(true);
    try{
      const[failed,skipped]=await Promise.all([
        api.get("/admin/strategies/mirror-jobs?status=failed&limit=100"),
        api.get("/admin/strategies/mirror-jobs?status=skipped&limit=100"),
      ]);
      setMirrorRecoveryJobs([...(failed.jobs||[]),...(skipped.jobs||[])].sort((a,b)=>b.id-a.id));
    }catch(e:any){notify(e.message,"!",false);}finally{setMirrorRecoveryLoading(false);}
  };
  useEffect(()=>{if(tab==="strategies"){refreshStrategies();refreshMirrorRecovery();}},[tab]);

  const createStrategy=async()=>{
    const fee=Number(newStratFee);
    if(!newStratName.trim()||!Number.isFinite(fee)||fee<0){notify("Name and a valid fee are required","!",false);return;}
    try{await api.post("/admin/strategies",{name:newStratName.trim(),description:newStratDesc.trim(),fee});setNewStratName("");setNewStratDesc("");setNewStratFee("");notify("Strategy created","OK");refreshStrategies();}catch(e:any){notify(e.message,"!",false);}
  };
  const submitFund=async()=>{
    if(!fundTarget)return;
    const amount=Number(fundAmount);
    if(!Number.isFinite(amount)||amount<=0){notify("Enter a valid amount","!",false);return;}
    setFundBusy(true);
    try{await api.post(`/admin/strategies/${fundTarget.id}/fund`,{amount});notify(`Funded ${fundTarget.name}`,"OK");setFundTarget(null);setFundAmount("");refreshStrategies();}catch(e:any){notify(e.message,"!",false);}finally{setFundBusy(false);}
  };
  const submitTrade=async()=>{
    if(!tradeTarget)return;
    const amount=Number(tradeAmount);
    if(!tradeSymbol.trim()||!Number.isFinite(amount)||amount<=0){notify("Symbol and a valid amount are required","!",false);return;}
    setTradeBusy(true);
    try{
      const d=await api.post(`/admin/strategies/${tradeTarget.id}/trades`,{symbol:tradeSymbol.trim().toUpperCase(),side:tradeSide,amount});
      const pending=Math.max(0,(d.queued||0)-(d.mirrored||0)-(d.skipped||0));
      notify(`Logged — ${d.mirrored} mirrored${d.skipped?`, ${d.skipped} need attention`:""}${pending?`, ${pending} queued`:""}`,"OK");
      setTradeTarget(null);setTradeSymbol("");setTradeAmount("");
      refreshStrategies();refreshMirrorRecovery();
    }catch(e:any){notify(e.message,"!",false);}finally{setTradeBusy(false);}
  };
  const openTradesView=async(s:AdminStrategy)=>{
    setTradesView(s);setTradesLoading(true);
    try{const d=await api.get(`/admin/strategies/${s.id}/trades`);setStrategyTrades(d.trades||[]);}catch(e:any){notify(e.message,"!",false);}finally{setTradesLoading(false);}
  };
  const retryMirrorJob=async(jobId:number)=>{
    setRetryingMirrorJob(jobId);
    try{
      await api.post(`/admin/strategies/mirror-jobs/${jobId}/retry`,{});
      setMirrorRecoveryJobs(current=>current.filter(job=>job.id!==jobId));
      notify("Mirror job queued for recovery","OK");
    }catch(e:any){notify(e.message,"!",false);}finally{setRetryingMirrorJob(null);}
  };

  const refreshManaged=async()=>{setManagedTabLoading(true);try{const d=await api.get("/admin/managed");setAdminManaged(d.accounts||[]);}catch(e:any){notify(e.message,"!",false);}finally{setManagedTabLoading(false);}};
  useEffect(()=>{if(tab==="managed")refreshManaged();},[tab]);

  useEffect(()=>{
    const q=managedPickQuery.trim();
    if(!q){setManagedPickResults([]);setManagedPicking(false);return;}
    setManagedPicking(true);
    const t=setTimeout(async()=>{
      try{const d=await api.get(`/admin/users/search?q=${encodeURIComponent(q)}`);setManagedPickResults(d.users||[]);}
      catch(e:any){notify(e.message,"!",false);}
      finally{setManagedPicking(false);}
    },350);
    return()=>clearTimeout(t);
  },[managedPickQuery]);

  const createManagedFor=async(u:SearchUser)=>{
    try{await api.post(`/admin/managed/${u.id}`,{});notify(`Managed account ready for ${u.email}`,"OK");setManagedPickQuery("");setManagedPickResults([]);refreshManaged();}catch(e:any){notify(e.message,"!",false);}
  };
  const submitManagedFund=async()=>{
    if(!managedFundTarget)return;
    const amount=Number(managedFundAmount);
    if(!Number.isFinite(amount)||amount<=0){notify("Enter a valid amount","!",false);return;}
    setManagedFundBusy(true);
    try{await api.post(`/admin/managed/${managedFundTarget.userId}/fund`,{amount});notify(`Funded ${managedFundTarget.email}`,"OK");setManagedFundTarget(null);setManagedFundAmount("");refreshManaged();}catch(e:any){notify(e.message,"!",false);}finally{setManagedFundBusy(false);}
  };
  const submitManagedAllocate=async()=>{
    if(!managedAllocTarget)return;
    const amount=Number(managedAllocAmount);
    if(!managedAllocSymbol.trim()||!Number.isFinite(amount)||amount<=0){notify("Symbol and a valid amount are required","!",false);return;}
    setManagedAllocBusy(true);
    try{await api.post(`/admin/managed/${managedAllocTarget.userId}/allocate`,{symbol:managedAllocSymbol.trim().toUpperCase(),amount});notify(`Allocated ${amount} ${managedAllocSymbol.trim().toUpperCase()} to ${managedAllocTarget.email}`,"OK");setManagedAllocTarget(null);setManagedAllocSymbol("");setManagedAllocAmount("");refreshManaged();}catch(e:any){notify(e.message,"!",false);}finally{setManagedAllocBusy(false);}
  };

  const refreshPromotions=async()=>{setPromotionsLoading(true);try{const d=await api.get("/admin/promotions");setPromotions(d.promotions||[]);}catch(e:any){notify(e.message,"!",false);}finally{setPromotionsLoading(false);}};
  useEffect(()=>{if(tab==="promotions")refreshPromotions();},[tab]);
  const refreshSecurityEvents=async(type=securityTypeFilter)=>{setSecurityLoading(true);try{const d=await api.get(`/admin/security-events${type?`?type=${encodeURIComponent(type)}`:""}`);setSecurityEvents(d.events||[]);}catch(e:any){notify(e.message,"!",false);}finally{setSecurityLoading(false);}};
  useEffect(()=>{if(tab==="security")refreshSecurityEvents();},[tab]);
  useEffect(()=>{if(tab==="security"){setClientErrorsLoading(true);api.get("/admin/client-errors").then(d=>setClientErrors(d.errors||[])).catch(e=>notify(e.message,"!",false)).finally(()=>setClientErrorsLoading(false));}},[tab]);
  useEffect(()=>{
    if(tab!=="activity")return;
    setActivityLoading(true);
    Promise.all([
      api.get("/admin/referrals").then(d=>setAdminReferrals(d.referrals||[])),
      api.get("/admin/auto-invest-plans").then(d=>setAdminAutoInvest(d.plans||[])),
    ]).catch(e=>notify(e.message,"!",false)).finally(()=>setActivityLoading(false));
  },[tab]);
  useEffect(()=>{
    if(tab!=="activity")return;
    let cancelled=false;
    const poll=async()=>{
      try{
        const data=await api.get("/admin/stocks/refresh/latest");
        if(!cancelled)setStockRefresh(data.job||null);
      }catch(error:any){
        if(!cancelled&&error?.status===404)setStockRefresh(null);
      }
    };
    poll();
    const handle=window.setInterval(poll,3000);
    return()=>{cancelled=true;window.clearInterval(handle);};
  },[tab]);
  const startStockRefresh=async()=>{
    setStockRefreshBusy(true);
    try{
      const data=await api.post("/admin/stocks/refresh",{});
      setStockRefresh(data.job||null);
      notify(data.message||"Stock refresh queued","OK");
    }catch(error:any){notify(error.message,"!",false);}
    finally{setStockRefreshBusy(false);}
  };
  const createPromotion=async()=>{
    const bonusPct=Number(promoBonusPct)/100;
    const minDeposit=Number(promoMinDeposit);
    const lockDays=Number(promoLockDays);
    if(!promoName.trim()||!Number.isFinite(bonusPct)||bonusPct<=0||bonusPct>1){notify("Name and a bonus % between 0-100 are required","!",false);return;}
    if(!promoStart||!promoEnd){notify("Start and end dates are required","!",false);return;}
    try{
      await api.post("/admin/promotions",{name:promoName.trim(),bonusPct,minTier:promoMinTier,minDeposit,lockDays,startAt:promoStart.replace("T"," ")+":00",endAt:promoEnd.replace("T"," ")+":00"});
      notify("Promotion created","OK");
      setPromoName("");setPromoBonusPct("");setPromoMinDeposit("");setPromoLockDays("7");setPromoStart("");setPromoEnd("");
      refreshPromotions();
    }catch(e:any){notify(e.message,"!",false);}
  };
  const endPromotion=async(id:number)=>{try{await api.delete(`/admin/promotions/${id}`,{});notify("Promotion ended","OK");refreshPromotions();}catch(e:any){notify(e.message,"!",false);}};

  const approveRequest=async(id:number)=>{try{await api.patch(`/admin/requests/${id}`,{action:"approve"});notify("Request approved","OK");refreshAdminData({showLoading:false,showError:false});}catch(e:any){notify(e.message,"!",false);}};
  const addMember=async()=>{try{await api.post("/admin/members",{email,role:memberRole});setEmail("");notify("Member role updated","OK");refreshAdminData({showLoading:false,showError:false});}catch(e:any){notify(e.message,"!",false);}};
  const restore=async(id:number)=>{try{await api.patch(`/admin/members/${id}/restore`,{});notify("User restored","OK");refreshAdminData({showLoading:false,showError:false});if(searchQuery.trim())setSearchResults(rs=>rs.map(u=>u.id===id?{...u,account_status:"active"}:u));}catch(e:any){notify(e.message,"!",false);}};
  const createRole=async()=>{try{await api.post("/admin/roles",{name:roleName,permissions:rolePerms});setRoleName("");setRolePerms(blankPerms());notify("Role created","OK");refreshAdminData({showLoading:false,showError:false});}catch(e:any){notify(e.message,"!",false);}};
  const sendAnnouncement=async()=>{try{await api.post("/admin/announcements",{title:announceTitle,body:announceBody});setAnnounceTitle("");setAnnounceBody("");notify("Platform update sent","OK");refreshAdminData({showLoading:false,showError:false});}catch(e:any){notify(e.message,"!",false);}};

  // Unified "confirm with reason" flow — used for every negative admin action
  // (reject a request, ban a user, revoke admin access) so they share one modal,
  // one audit trail, and one place to add more actions later.
  const openConfirm=(kind:ConfirmAction["kind"],id:number,label:string)=>{setConfirm({kind,id,label});setConfirmReason("");};
  const submitConfirm=async()=>{
    if(!confirm) return;
    setConfirmBusy(true);
    try{
      if(confirm.kind==="reject")      await api.patch(`/admin/requests/${confirm.id}`,{action:"reject",note:confirmReason||undefined});
      else if(confirm.kind==="ban")    await api.patch(`/admin/members/${confirm.id}/ban`,{reason:confirmReason||undefined});
      else if(confirm.kind==="revoke") await api.patch(`/admin/members/${confirm.id}/role`,{role:"user",reason:confirmReason||undefined});
      notify(confirm.kind==="reject"?"Request rejected":confirm.kind==="ban"?"User banned and logged out":"Admin privileges revoked",confirm.kind==="revoke"?"OK":"!");
      setConfirm(null);
      refreshAdminData({showLoading:false,showError:false});
      if(searchQuery.trim()&&confirm.kind==="ban")setSearchResults(rs=>rs.map(u=>u.id===confirm.id?{...u,account_status:"banned"}:u));
    }catch(e:any){notify(e.message,"!",false);}
    finally{setConfirmBusy(false);}
  };

  if(error)return <div className="gcard admin-denied"><div className="stitle">Admin Center</div><p className="admin-note">{error}</p></div>;
  return <div>
    <div className="admin-heading">
      <div>
        <div className="ttl">Admin Center</div>
        <div className="tdate">Requests, roles, admins, violations, and platform updates.</div>
        <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"var(--text3)",marginTop:4}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:syncing?"#F59E0B":"var(--green)",transition:"background .2s",flexShrink:0}}/>
          {syncing?"Syncing…":lastSynced?`Live · updated ${lastSynced.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:"Live"}
        </div>
      </div>
    </div>

    <div className="admin-banner"><b>{pendingCount}</b> pending request(s). Manage device alerts in Settings → Notifications.</div>

    <div className="admin-tabs">{(["requests","members","roles","violations","updates","search","strategies","managed","promotions","security","activity"] as Tab[]).map(x=><button key={x} className={`chip ${tab===x?"active":""}`} onClick={()=>setTab(x)}>{x}</button>)}</div>

    {loading?<div className="gcard"><PanelLoading rows={5} label="Loading admin data"/></div>:<>
      {tab==="requests"&&<>
        <div className="admin-tabs" style={{marginBottom:14}}>
          <button className={`chip ${reqView==="pending"?"active":""}`} onClick={()=>setReqView("pending")}>Pending ({pendingRequests.length})</button>
          <button className={`chip ${reqView==="reviewed"?"active":""}`} onClick={()=>setReqView("reviewed")}>Reviewed ({reviewedRequests.length})</button>
        </div>
        {reqView==="pending"&&<div className="gcard admin-table-wrap"><table className="admin-table"><thead><tr><th>Request</th><th>User</th><th>Status</th><th>Amount</th><th>Created</th><th></th></tr></thead><tbody>
          {pendingRequests.length===0&&<tr><td colSpan={6}><div className="admin-note" style={{padding:"18px 0",textAlign:"center"}}>Nothing pending — you're caught up.</div></td></tr>}
          {pendingRequests.map(r=><tr key={r.id}>
            <td><b style={{color:"var(--text)"}}>{r.title}</b><div className="admin-note">{r.details||r.type}</div></td>
            <td>{r.user_name}<div className="admin-note">{r.user_email}</div></td>
            <td><span className={`admin-status ${r.status}`}>{r.status}</span></td>
            <td>{r.amount?`$${Number(r.amount).toLocaleString()}`:"-"}</td>
            <td>{new Date(r.created_at).toLocaleString()}</td>
            <td>{can("manage_requests")&&<div style={{display:"flex",gap:8}}>
              <button className="btn btn-action btn-sm" onClick={()=>approveRequest(r.id)}>Approve</button>
              <button className="btn btn-danger btn-sm" onClick={()=>openConfirm("reject",r.id,`reject "${r.title}"`)}>Reject</button>
            </div>}</td>
          </tr>)}
        </tbody></table></div>}
        {reqView==="reviewed"&&<div className="gcard admin-table-wrap"><table className="admin-table"><thead><tr><th>Request</th><th>User</th><th>Outcome</th><th>Reviewed by</th><th>Note</th><th>When</th></tr></thead><tbody>
          {reviewedRequests.length===0&&<tr><td colSpan={6}><div className="admin-note" style={{padding:"18px 0",textAlign:"center"}}>No reviewed requests yet.</div></td></tr>}
          {reviewedRequests.map(r=><tr key={r.id}>
            <td><b style={{color:"var(--text)"}}>{r.title}</b><div className="admin-note">{r.details||r.type}</div></td>
            <td>{r.user_name}<div className="admin-note">{r.user_email}</div></td>
            <td><span className={`admin-status ${r.status}`}>{r.status}</span></td>
            <td>{r.reviewed_by_email||"—"}</td>
            <td>{r.admin_note||<span className="admin-note">—</span>}</td>
            <td>{r.reviewed_at?new Date(r.reviewed_at).toLocaleString():"—"}</td>
          </tr>)}
        </tbody></table></div>}
      </>}

      {tab==="members"&&<div className="admin-grid"><div className="gcard admin-table-wrap"><table className="admin-table"><tbody>{members.map(m=>{const isSelfOrOwner=m.role==="owner"||m.id===currentUser?.id;return <tr key={m.id}><td><div style={{display:"flex",alignItems:"center",gap:10}}><AdminAvatar name={m.name} avatarUrl={m.avatar_url}/><div>{m.name}<div className="admin-note">{m.email}</div></div></div></td><td>{m.role}</td><td><span className={`admin-status ${m.account_status}`}>{m.account_status}</span></td><td><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{!isSelfOrOwner&&can("manage_members")&&<button className="btn btn-ghost btn-sm" onClick={()=>openConfirm("revoke",m.id,`revoke ${m.name}'s admin access`)}>Revoke admin</button>}{!isSelfOrOwner&&can("ban_users")&&(m.account_status==="banned"?<button className="btn btn-action btn-sm" onClick={()=>restore(m.id)}>Restore</button>:<button className="btn btn-danger btn-sm" onClick={()=>openConfirm("ban",m.id,`ban ${m.name}`)}>Ban</button>)}</div></td></tr>})}</tbody></table></div><div className="gcard"><div className="stitle">Add member</div><div className="admin-form-grid"><input className="inp" placeholder="member@email.com" value={email} onChange={e=>setEmail(e.target.value)}/><select className="sel" value={memberRole} onChange={e=>setMemberRole(e.target.value)}>{roles.filter(r=>!r.is_owner).map(r=><option key={r.role_key} value={r.role_key}>{r.name}</option>)}</select><button className="btn btn-primary admin-plus" onClick={addMember}>+</button></div></div></div>}

      {tab==="roles"&&<div className="admin-grid"><div className="gcard admin-card-list">{roles.map(r=><div key={r.role_key} className="admin-banner"><b>{r.name}</b><div className="admin-note">{Object.entries(r.permissions||{}).filter(([,v])=>v).map(([k])=>k).join(", ")||"No permissions"}</div></div>)}</div><div className="gcard"><div className="stitle">Create role</div><input className="inp" placeholder="Role name" value={roleName} onChange={e=>setRoleName(e.target.value)}/><div className="admin-perms">{PERMS.map(p=><label key={p} className="admin-perm"><input type="checkbox" checked={!!rolePerms[p]} onChange={e=>setRolePerms(v=>({...v,[p]:e.target.checked}))}/>{p}</label>)}</div><button className="btn btn-primary" style={{marginTop:14,width:"100%"}} onClick={createRole} disabled={!can("manage_roles")}>Create role</button></div></div>}

      {tab==="violations"&&<div className="gcard admin-table-wrap"><table className="admin-table"><tbody>{violations.map(v=><tr key={v.id}><td>{v.name}<div className="admin-note">{v.email}</div></td><td>{v.reason}</td><td>{v.severity}</td><td><span className={`admin-status ${v.account_status}`}>{v.account_status}</span></td><td>{can("ban_users")&&(v.account_status==="banned"?<button className="btn btn-action btn-sm" onClick={()=>restore(v.id)}>Restore</button>:<button className="btn btn-danger btn-sm" onClick={()=>openConfirm("ban",v.id,`ban ${v.name}`)}>Ban</button>)}</td></tr>)}</tbody></table></div>}

      {tab==="updates"&&<div className="admin-grid"><div className="gcard admin-card-list">{updates.map(u=><div className="admin-banner" key={u.id}><b>{u.title}</b><div className="admin-note">{u.body}</div><div className="admin-note">{new Date(u.created_at).toLocaleString()}</div></div>)}</div><div className="gcard"><div className="stitle">Send platform update</div><input className="inp" placeholder="Improved bug fixes" value={announceTitle} onChange={e=>setAnnounceTitle(e.target.value)} style={{marginBottom:10}}/><textarea className="inp" placeholder="Write the announcement..." value={announceBody} onChange={e=>setAnnounceBody(e.target.value)} style={{minHeight:130,resize:"vertical",marginBottom:12}}/><button className="btn btn-primary" style={{width:"100%"}} onClick={sendAnnouncement} disabled={!can("manage_announcements")}>Send update</button></div></div>}

      {tab==="search"&&<div>
        <div className="gcard" style={{marginBottom:16}}>
          <div className="stitle">Search users</div>
          <div className="admin-note" style={{marginBottom:12}}>Search by email or name. Phone search will work automatically once phone numbers are configured.</div>
          <input className="inp" placeholder="name@email.com or full name" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/>
        </div>
        {searching&&<div className="gcard">Searching…</div>}
        {!searching&&searchQuery.trim()&&searchResults.length===0&&<div className="gcard admin-note" style={{textAlign:"center",padding:"24px 0"}}>No users match "{searchQuery.trim()}".</div>}
        {!searching&&searchResults.length>0&&<div className="gcard admin-table-wrap"><table className="admin-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Joined</th><th></th></tr></thead><tbody>
          {searchResults.map(u=>{const isSelfOrOwner=u.role==="owner"||u.id===currentUser?.id;return <tr key={u.id}>
            <td><div style={{display:"flex",alignItems:"center",gap:10}}><AdminAvatar name={u.name} avatarUrl={u.avatar_url}/><div>{u.name}<div className="admin-note">{u.email}{u.phone?` · ${u.phone}`:""}</div></div></div></td>
            <td>{u.role}</td>
            <td><span className={`admin-status ${u.account_status}`}>{u.account_status}</span></td>
            <td>{new Date(u.created_at).toLocaleDateString()}</td>
            <td>{!isSelfOrOwner&&can("ban_users")&&<div style={{display:"flex",gap:8}}>{u.account_status==="banned"?<button className="btn btn-action btn-sm" onClick={()=>restore(u.id)}>Restore</button>:<button className="btn btn-danger btn-sm" onClick={()=>openConfirm("ban",u.id,`ban ${u.name}`)}>Ban</button>}</div>}</td>
          </tr>})}
        </tbody></table></div>}
      </div>}

      {tab==="strategies"&&<div className="admin-grid">
        <div className="gcard admin-table-wrap">
          {strategiesLoading?<PanelLoading rows={4} label="Loading strategies"/>:
          adminStrategies.length===0?<div className="admin-note" style={{padding:"18px 0",textAlign:"center"}}>No strategies yet — create one.</div>:
          <table className="admin-table"><thead><tr><th>Strategy</th><th>Fee</th><th>Account value</th><th>Subscribers</th><th></th></tr></thead><tbody>
            {adminStrategies.map(s=><tr key={s.id}>
              <td><b style={{color:"var(--text)"}}>{s.name}</b><div className="admin-note">{s.description}</div></td>
              <td>${s.fee.toLocaleString()}</td>
              <td>${s.totalValue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}<div className="admin-note">${s.cashBalance.toLocaleString(undefined,{maximumFractionDigits:2})} cash</div></td>
              <td>{s.subscribers}</td>
              <td><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button className="btn btn-ghost btn-sm" onClick={()=>setFundTarget(s)}>Fund</button>
                <button className="btn btn-action btn-sm" onClick={()=>setTradeTarget(s)}>Log trade</button>
                <button className="btn btn-ghost btn-sm" onClick={()=>openTradesView(s)}>History</button>
              </div></td>
            </tr>)}
          </tbody></table>}
        </div>
        <div className="gcard">
          <div className="stitle">Create strategy</div>
          <div className="admin-note" style={{marginBottom:12}}>Trades you log against a strategy mirror proportionally into every subscriber's own account.</div>
          <input className="inp" placeholder="Strategy name" value={newStratName} onChange={e=>setNewStratName(e.target.value)} style={{marginBottom:10}}/>
          <textarea className="inp" placeholder="Description shown to users" value={newStratDesc} onChange={e=>setNewStratDesc(e.target.value)} style={{minHeight:80,resize:"vertical",marginBottom:10}}/>
          <input className="inp" type="number" placeholder="Connect fee ($)" value={newStratFee} onChange={e=>setNewStratFee(e.target.value)} style={{marginBottom:12}}/>
          <button className="btn btn-primary" style={{width:"100%"}} onClick={createStrategy}>Create strategy</button>
        </div>
        <div className="gcard admin-table-wrap" style={{gridColumn:"1 / -1"}}>
          <div className="stitle">Mirror recovery</div>
          <div className="admin-note" style={{marginBottom:12}}>Failed or skipped subscriber mirrors stay here until reviewed. Fix the balance or holding issue, then retry safely.</div>
          {mirrorRecoveryLoading?<PanelLoading rows={3} label="Loading mirror recovery jobs"/>:
          mirrorRecoveryJobs.length===0?<div className="admin-note" style={{padding:"14px 0",textAlign:"center"}}>All strategy mirrors are healthy.</div>:
          <table className="admin-table"><thead><tr><th>Strategy</th><th>Trade</th><th>Status</th><th>Reason</th><th></th></tr></thead><tbody>
            {mirrorRecoveryJobs.map(job=><tr key={job.id}>
              <td><b style={{color:"var(--text)"}}>{job.strategy_name}</b><div className="admin-note">Portfolio #{job.portfolio_id}</div></td>
              <td>{job.side.toUpperCase()} {job.symbol}<div className="admin-note">Trade #{job.strategy_trade_id}</div></td>
              <td><span className={`admin-status ${job.status}`}>{job.status}</span><div className="admin-note">{job.attempt_count} attempt{job.attempt_count===1?"":"s"}</div></td>
              <td className="admin-note">{job.last_error||"No error detail"}</td>
              <td><button className="btn btn-action btn-sm" disabled={retryingMirrorJob===job.id} onClick={()=>retryMirrorJob(job.id)}>{retryingMirrorJob===job.id?"Queuing…":"Retry"}</button></td>
            </tr>)}
          </tbody></table>}
        </div>
      </div>}

      {tab==="managed"&&<div className="admin-grid">
        <div className="gcard admin-table-wrap">
          {managedTabLoading?<PanelLoading rows={4} label="Loading managed accounts"/>:
          adminManaged.length===0?<div className="admin-note" style={{padding:"18px 0",textAlign:"center"}}>No managed accounts yet — create one for a user.</div>:
          <table className="admin-table"><thead><tr><th>User</th><th>Account value</th><th></th></tr></thead><tbody>
            {adminManaged.map(m=><tr key={m.portfolioId}>
              <td><b style={{color:"var(--text)"}}>{m.name}</b><div className="admin-note">{m.email}</div></td>
              <td>${m.totalValue.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}<div className="admin-note">${m.cashBalance.toLocaleString(undefined,{maximumFractionDigits:2})} cash</div></td>
              <td><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button className="btn btn-ghost btn-sm" onClick={()=>setManagedFundTarget(m)}>Fund</button>
                <button className="btn btn-action btn-sm" onClick={()=>setManagedAllocTarget(m)}>Allocate</button>
              </div></td>
            </tr>)}
          </tbody></table>}
        </div>
        <div className="gcard">
          <div className="stitle">Create managed account</div>
          <div className="admin-note" style={{marginBottom:12}}>Search for a user, then create their managed account. Fund it and allocate real assets from the table on the left.</div>
          <input className="inp" placeholder="name@email.com or full name" value={managedPickQuery} onChange={e=>setManagedPickQuery(e.target.value)}/>
          {managedPicking&&<div className="admin-note" style={{padding:"10px 0"}}>Searching…</div>}
          {!managedPicking&&managedPickQuery.trim()&&managedPickResults.length===0&&<div className="admin-note" style={{padding:"10px 0"}}>No users match "{managedPickQuery.trim()}".</div>}
          {managedPickResults.map(u=><div key={u.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid var(--border)"}}>
            <div><b style={{color:"var(--text)",fontSize:13}}>{u.name}</b><div className="admin-note">{u.email}</div></div>
            <button className="btn btn-primary btn-sm" onClick={()=>createManagedFor(u)}>Create</button>
          </div>)}
        </div>
      </div>}

      {tab==="promotions"&&<div className="admin-grid">
        <div className="gcard admin-table-wrap">
          {promotionsLoading?<PanelLoading rows={4} label="Loading promotions"/>:
          promotions.length===0?<div className="admin-note" style={{padding:"18px 0",textAlign:"center"}}>No promotions yet.</div>:
          <table className="admin-table"><thead><tr><th>Promotion</th><th>Terms</th><th>Window</th><th></th></tr></thead><tbody>
            {promotions.map(p=>{const active=new Date(p.end_at)>new Date()&&new Date(p.start_at)<=new Date();return(
              <tr key={p.id}>
                <td><b style={{color:"var(--text)"}}>{p.name}</b><div className="admin-note">{active?"🟢 Active":"⚪ Ended"}</div></td>
                <td>{(p.bonus_pct*100).toFixed(0)}% bonus<div className="admin-note">{p.min_tier}+ tier · ${p.min_deposit.toLocaleString()} min · {p.lock_days}d lock</div></td>
                <td className="admin-note">{p.start_at.slice(0,10)} → {p.end_at.slice(0,10)}</td>
                <td>{active&&<button className="btn btn-danger btn-sm" onClick={()=>endPromotion(p.id)}>End now</button>}</td>
              </tr>
            );})}
          </tbody></table>}
        </div>
        <div className="gcard">
          <div className="stitle">Create promotion</div>
          <div className="admin-note" style={{marginBottom:12}}>Users at/above the minimum tier who deposit at least the minimum amount while this is active get the bonus credited immediately, locked from withdrawal for the lock period.</div>
          <input className="inp" placeholder="Promotion name" value={promoName} onChange={e=>setPromoName(e.target.value)} style={{marginBottom:10}}/>
          <input className="inp" type="number" placeholder="Bonus % (e.g. 10 for 10%)" value={promoBonusPct} onChange={e=>setPromoBonusPct(e.target.value)} style={{marginBottom:10}}/>
          <div className="tlab">Minimum tier</div>
          <select className="sel" value={promoMinTier} onChange={e=>setPromoMinTier(e.target.value)} style={{width:"100%",marginBottom:10}}>
            {["bronze","silver","gold","platinum"].map(t=><option key={t} value={t}>{t}</option>)}
          </select>
          <input className="inp" type="number" placeholder="Minimum deposit ($)" value={promoMinDeposit} onChange={e=>setPromoMinDeposit(e.target.value)} style={{marginBottom:10}}/>
          <input className="inp" type="number" placeholder="Lock days" value={promoLockDays} onChange={e=>setPromoLockDays(e.target.value)} style={{marginBottom:10}}/>
          <div className="tlab">Start</div>
          <input className="inp" type="datetime-local" value={promoStart} onChange={e=>setPromoStart(e.target.value)} style={{marginBottom:10}}/>
          <div className="tlab">End</div>
          <input className="inp" type="datetime-local" value={promoEnd} onChange={e=>setPromoEnd(e.target.value)} style={{marginBottom:12}}/>
          <button className="btn btn-primary" style={{width:"100%"}} onClick={createPromotion}>Create promotion</button>
        </div>
      </div>}

      {tab==="security"&&<div className="admin-grid">
        <div className="gcard admin-table-wrap">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div className="stitle" style={{marginBottom:0}}>Security Events</div>
            <select className="sel" value={securityTypeFilter} onChange={e=>{setSecurityTypeFilter(e.target.value);refreshSecurityEvents(e.target.value);}} style={{width:220}}>
              <option value="">All types</option>
              {["LOGIN_SUCCESS","LOGIN_FAILED","LOGIN_BLOCKED","TURNSTILE_FAILED","SIGNUP_SUCCESS","SIGNUP_BLOCKED","NEW_DEVICE_LOGIN","RISK_ASSESSED","WITHDRAWAL_COMPLETED","WITHDRAWAL_BLOCKED","PASSWORD_CHANGED","TWOFA_DISABLED","PHONE_VERIFIED","DEVICE_TRUST_REVOKED"].map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {securityLoading?<PanelLoading rows={4} label="Loading security events"/>:
          securityEvents.length===0?<div className="admin-note" style={{padding:"18px 0",textAlign:"center"}}>No events yet.</div>:
          <table className="admin-table"><thead><tr><th>Type</th><th>User</th><th>IP</th><th>Details</th><th>When</th></tr></thead><tbody>
            {securityEvents.map(ev=>(
              <tr key={ev.id}>
                <td><b style={{color:"var(--text)"}}>{ev.type}</b></td>
                <td className="admin-note">{ev.user_email||"—"}</td>
                <td className="admin-note">{ev.ip||"—"}</td>
                <td className="admin-note" style={{maxWidth:280,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{Object.keys(ev.metadata||{}).length?JSON.stringify(ev.metadata):"—"}</td>
                <td className="admin-note">{new Date(ev.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody></table>}
        </div>
        <div className="gcard admin-table-wrap">
          <div className="stitle">Frontend Crash Reports</div>
          {clientErrorsLoading?<PanelLoading rows={4} label="Loading client errors"/>:
          clientErrors.length===0?<div className="admin-note" style={{padding:"18px 0",textAlign:"center"}}>No crashes reported — good sign.</div>:
          <table className="admin-table"><thead><tr><th>Message</th><th>Boundary</th><th>User</th><th>When</th></tr></thead><tbody>
            {clientErrors.map(ce=>(
              <tr key={ce.id}>
                <td style={{maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ce.message||"—"}</td>
                <td className="admin-note">{ce.boundary||"—"}</td>
                <td className="admin-note">{ce.user_email||"—"}</td>
                <td className="admin-note">{new Date(ce.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody></table>}
        </div>
      </div>}

      {tab==="activity"&&<div className="admin-grid">
        <div className="gcard" style={{gridColumn:"1 / -1"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
            <div>
              <div className="stitle">Stock Market Data</div>
              <div className="admin-note" style={{marginTop:6}}>
                {stockRefresh
                  ? `${stockRefresh.status} · ${stockRefresh.processed}/${stockRefresh.total} checked · ${stockRefresh.updated} updated · ${stockRefresh.skipped} skipped${stockRefresh.lastSymbol?` · last ${stockRefresh.lastSymbol}`:""}`
                  : "No refresh history yet."}
              </div>
              {stockRefresh?.error&&<div style={{color:"var(--red)",fontSize:12,marginTop:6}}>{stockRefresh.error}</div>}
            </div>
            <button
              className="btn btn-primary"
              onClick={startStockRefresh}
              disabled={stockRefreshBusy||stockRefresh?.status==="pending"||stockRefresh?.status==="processing"}
            >
              {stockRefreshBusy?"Queueing…":stockRefresh?.status==="pending"||stockRefresh?.status==="processing"?"Refresh running…":"Refresh stock prices"}
            </button>
          </div>
          {stockRefresh&&stockRefresh.total>0&&(
            <div style={{height:6,borderRadius:99,background:"var(--surface2)",overflow:"hidden",marginTop:14}}>
              <div style={{height:"100%",width:`${Math.min(100,Math.round((stockRefresh.processed/stockRefresh.total)*100))}%`,background:"var(--indigo)",transition:"width .25s ease"}}/>
            </div>
          )}
        </div>
        <div className="gcard admin-table-wrap">
          <div className="stitle">Referrals</div>
          {activityLoading?<PanelLoading rows={4} label="Loading referral activity"/>:
          adminReferrals.length===0?<div className="admin-note" style={{padding:"18px 0",textAlign:"center"}}>No referrals yet.</div>:
          <table className="admin-table"><thead><tr><th>Referrer</th><th>Referee</th><th>Status</th><th>When</th></tr></thead><tbody>
            {adminReferrals.map(r=>(
              <tr key={r.id}>
                <td>{r.referrer_name}<div className="admin-note">{r.referrer_email}</div></td>
                <td>{r.referee_name}<div className="admin-note">{r.referee_email}</div></td>
                <td><span className={`admin-status ${r.status==="completed"?"active":""}`}>{r.status}</span></td>
                <td className="admin-note">{new Date(r.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody></table>}
        </div>
        <div className="gcard admin-table-wrap">
          <div className="stitle">Auto-Invest Plans</div>
          {activityLoading?<PanelLoading rows={4} label="Loading auto-invest activity"/>:
          adminAutoInvest.length===0?<div className="admin-note" style={{padding:"18px 0",textAlign:"center"}}>No plans yet.</div>:
          <table className="admin-table"><thead><tr><th>User</th><th>Plan</th><th>Status</th><th>Next run</th></tr></thead><tbody>
            {adminAutoInvest.map(p=>(
              <tr key={p.id}>
                <td className="admin-note">{p.user_email}</td>
                <td><b style={{color:"var(--text)"}}>${p.weekly_amount}/week</b><div className="admin-note">{p.symbol}</div></td>
                <td><span className={`admin-status ${p.status==="active"?"active":""}`}>{p.status}</span></td>
                <td className="admin-note">{new Date(p.next_run_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody></table>}
        </div>
      </div>}
    </>}

    {confirm&&<Modal open={!!confirm} onClose={()=>confirmBusy?null:setConfirm(null)} title={confirm.kind==="ban"?"Ban user":confirm.kind==="revoke"?"Revoke admin access":"Reject request"}>
      <div style={{fontSize:13,color:"var(--text3)",marginBottom:14,lineHeight:1.5}}>
        You're about to {confirm.label}. {confirm.kind!=="ban"&&"The user will see this reason in their notifications."} This is logged to the admin audit trail.
      </div>
      <div className="tlab">Reason{confirm.kind==="reject"?" (optional)":""}</div>
      <textarea className="inp" placeholder="Explain why…" value={confirmReason} onChange={e=>setConfirmReason(e.target.value)} style={{minHeight:90,resize:"vertical",marginBottom:16}}/>
      <button className="btn btn-danger" style={{width:"100%",justifyContent:"center"}} onClick={submitConfirm} disabled={confirmBusy}>
        {confirmBusy?"Submitting…":`Confirm ${confirm.kind==="ban"?"ban":confirm.kind==="revoke"?"revoke":"reject"}`}
      </button>
    </Modal>}

    {fundTarget&&<Modal open={!!fundTarget} onClose={()=>fundBusy?null:setFundTarget(null)} title={`Fund ${fundTarget.name}`}>
      <div style={{fontSize:13,color:"var(--text3)",marginBottom:14,lineHeight:1.5}}>Adds cash to this strategy's own trading account — separate from any user's transfer. Current value: ${fundTarget.totalValue.toLocaleString()}.</div>
      <div className="tlab">Amount ($)</div>
      <input className="inp" type="number" placeholder="10000" value={fundAmount} onChange={e=>setFundAmount(e.target.value)} style={{marginBottom:16}}/>
      <button className="btn btn-primary" style={{width:"100%",justifyContent:"center"}} onClick={submitFund} disabled={fundBusy}>{fundBusy?"Funding…":"Fund strategy"}</button>
    </Modal>}

    {tradeTarget&&<Modal open={!!tradeTarget} onClose={()=>tradeBusy?null:setTradeTarget(null)} title={`Log trade — ${tradeTarget.name}`}>
      <div style={{fontSize:13,color:"var(--text3)",marginBottom:14,lineHeight:1.5}}>This mirrors proportionally into every subscriber's own copier account. Strategy account value: ${tradeTarget.totalValue.toLocaleString()}.</div>
      <div className="tlab">Symbol</div>
      <input className="inp" placeholder="BTC" value={tradeSymbol} onChange={e=>setTradeSymbol(e.target.value)} style={{marginBottom:12,textTransform:"uppercase"}}/>
      <div className="tlab">Side</div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <button className={`chip ${tradeSide==="buy"?"active":""}`} onClick={()=>setTradeSide("buy")} style={{flex:1}}>Buy</button>
        <button className={`chip ${tradeSide==="sell"?"active":""}`} onClick={()=>setTradeSide("sell")} style={{flex:1}}>Sell</button>
      </div>
      <div className="tlab">Amount (units of {tradeSymbol.trim()||"the symbol"})</div>
      <input className="inp" type="number" placeholder="0.02" value={tradeAmount} onChange={e=>setTradeAmount(e.target.value)} style={{marginBottom:16}}/>
      <button className="btn btn-primary" style={{width:"100%",justifyContent:"center"}} onClick={submitTrade} disabled={tradeBusy}>{tradeBusy?"Logging…":"Log trade & mirror"}</button>
    </Modal>}

    {tradesView&&<Modal open={!!tradesView} onClose={()=>setTradesView(null)} title={`${tradesView.name} — trade history`}>
      {tradesLoading?<PanelLoading rows={4} label="Loading strategy trades"/>:
      strategyTrades.length===0?<div className="admin-note" style={{padding:"18px 0",textAlign:"center"}}>No trades logged yet.</div>:
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Symbol</th><th>Side</th><th>Amount</th><th>Price</th><th>When</th></tr></thead><tbody>
        {strategyTrades.map(t=><tr key={t.id}>
          <td>{t.symbol}</td>
          <td style={{textTransform:"capitalize"}}>{t.side}</td>
          <td>{t.amount}</td>
          <td>${t.price.toLocaleString()}</td>
          <td>{new Date(t.created_at).toLocaleString()}</td>
        </tr>)}
      </tbody></table></div>}
    </Modal>}

    {managedFundTarget&&<Modal open={!!managedFundTarget} onClose={()=>managedFundBusy?null:setManagedFundTarget(null)} title={`Fund ${managedFundTarget.email}`}>
      <div style={{fontSize:13,color:"var(--text3)",marginBottom:14,lineHeight:1.5}}>Adds cash to this user's managed account. Current value: ${managedFundTarget.totalValue.toLocaleString()}.</div>
      <div className="tlab">Amount ($)</div>
      <input className="inp" type="number" placeholder="20000" value={managedFundAmount} onChange={e=>setManagedFundAmount(e.target.value)} style={{marginBottom:16}}/>
      <button className="btn btn-primary" style={{width:"100%",justifyContent:"center"}} onClick={submitManagedFund} disabled={managedFundBusy}>{managedFundBusy?"Funding…":"Fund account"}</button>
    </Modal>}

    {managedAllocTarget&&<Modal open={!!managedAllocTarget} onClose={()=>managedAllocBusy?null:setManagedAllocTarget(null)} title={`Allocate — ${managedAllocTarget.email}`}>
      <div style={{fontSize:13,color:"var(--text3)",marginBottom:14,lineHeight:1.5}}>Buys a real asset into this user's managed account using its cash balance. Available cash: ${managedAllocTarget.cashBalance.toLocaleString()}.</div>
      <div className="tlab">Symbol</div>
      <input className="inp" placeholder="BTC" value={managedAllocSymbol} onChange={e=>setManagedAllocSymbol(e.target.value)} style={{marginBottom:12,textTransform:"uppercase"}}/>
      <div className="tlab">Amount (units)</div>
      <input className="inp" type="number" placeholder="0.2" value={managedAllocAmount} onChange={e=>setManagedAllocAmount(e.target.value)} style={{marginBottom:16}}/>
      <button className="btn btn-primary" style={{width:"100%",justifyContent:"center"}} onClick={submitManagedAllocate} disabled={managedAllocBusy}>{managedAllocBusy?"Allocating…":"Allocate"}</button>
    </Modal>}
  </div>;
}
