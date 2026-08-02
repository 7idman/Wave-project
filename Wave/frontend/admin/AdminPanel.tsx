import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Modal } from "../components/PlatformPrimitives";
import type { User } from "../types";

type Tab="requests"|"members"|"roles"|"violations"|"updates"|"search";
type AdminRequest={id:number;type:string;status:string;amount?:number;title:string;details?:string;user_email:string;user_name:string;created_at:string;reviewed_by_email?:string;reviewed_at?:string;admin_note?:string};
type Role={role_key:string;name:string;permissions:Record<string,boolean>;is_owner?:number};
type Member={id:number;email:string;name:string;role:string;account_status:string;created_at:string};
type Violation={id:number;email:string;name:string;reason:string;severity:string;account_status:string};
type SiteUpdate={id:number|string;title:string;body:string;created_at:string};
type SearchUser={id:number;email:string;name:string;phone?:string;role:string;account_status:string;created_at:string};
type ConfirmAction={kind:"reject"|"ban"|"revoke";id:number;label:string};
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
    <div className="topbar">
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

    <div className="admin-tabs">{(["requests","members","roles","violations","updates","search"] as Tab[]).map(x=><button key={x} className={`chip ${tab===x?"active":""}`} onClick={()=>setTab(x)}>{x}</button>)}</div>

    {loading?<div className="gcard">Loading admin data...</div>:<>
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

      {tab==="members"&&<div className="admin-grid"><div className="gcard admin-table-wrap"><table className="admin-table"><tbody>{members.map(m=>{const isSelfOrOwner=m.role==="owner"||m.id===currentUser?.id;return <tr key={m.id}><td>{m.name}<div className="admin-note">{m.email}</div></td><td>{m.role}</td><td><span className={`admin-status ${m.account_status}`}>{m.account_status}</span></td><td><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{!isSelfOrOwner&&can("manage_members")&&<button className="btn btn-ghost btn-sm" onClick={()=>openConfirm("revoke",m.id,`revoke ${m.name}'s admin access`)}>Revoke admin</button>}{!isSelfOrOwner&&can("ban_users")&&(m.account_status==="banned"?<button className="btn btn-action btn-sm" onClick={()=>restore(m.id)}>Restore</button>:<button className="btn btn-danger btn-sm" onClick={()=>openConfirm("ban",m.id,`ban ${m.name}`)}>Ban</button>)}</div></td></tr>})}</tbody></table></div><div className="gcard"><div className="stitle">Add member</div><div className="admin-form-grid"><input className="inp" placeholder="member@email.com" value={email} onChange={e=>setEmail(e.target.value)}/><select className="sel" value={memberRole} onChange={e=>setMemberRole(e.target.value)}>{roles.filter(r=>!r.is_owner).map(r=><option key={r.role_key} value={r.role_key}>{r.name}</option>)}</select><button className="btn btn-primary admin-plus" onClick={addMember}>+</button></div></div></div>}

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
            <td>{u.name}<div className="admin-note">{u.email}{u.phone?` · ${u.phone}`:""}</div></td>
            <td>{u.role}</td>
            <td><span className={`admin-status ${u.account_status}`}>{u.account_status}</span></td>
            <td>{new Date(u.created_at).toLocaleDateString()}</td>
            <td>{!isSelfOrOwner&&can("ban_users")&&<div style={{display:"flex",gap:8}}>{u.account_status==="banned"?<button className="btn btn-action btn-sm" onClick={()=>restore(u.id)}>Restore</button>:<button className="btn btn-danger btn-sm" onClick={()=>openConfirm("ban",u.id,`ban ${u.name}`)}>Ban</button>}</div>}</td>
          </tr>})}
        </tbody></table></div>}
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
  </div>;
}