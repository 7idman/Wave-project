import type { Activity, AppSettings, LoginEvent, SiteUpdate } from "../types/platform";
import { AppIcon, Toggle } from "../components/PlatformPrimitives";
import { PanelLoading } from "../components/PlatformFeedback";
import { ActivityGlyph, ProductIcon } from "../components/ProductIcons";

type NotificationsPageProps={
  settings:AppSettings;
  isAdmin:boolean;
  balancePushSubscribed:boolean;
  balancePushBusy:boolean;
  pushSubscribed:boolean;
  pushBusy:boolean;
  loading:boolean;
  siteUpdates:SiteUpdate[];
  loginHistory:LoginEvent[];
  activities:Activity[];
  onToggleLoginNotifications:()=>void;
  onTradeAlerts:()=>void;
  onManagePriceAlerts:()=>void;
  onToggleBalancePush:()=>void;
  onToggleAdminPush:()=>void;
  onSignOutDevice:(session:LoginEvent)=>void;
  onRevokeDeviceTrust:(session:LoginEvent)=>void;
  onLogout:()=>void;
};

export function NotificationsPage({
  settings,isAdmin,balancePushSubscribed,balancePushBusy,pushSubscribed,pushBusy,loading:notificationLoading,
  siteUpdates,loginHistory,activities,onToggleLoginNotifications,onTradeAlerts,onManagePriceAlerts,
  onToggleBalancePush,onToggleAdminPush,onSignOutDevice,onRevokeDeviceTrust,onLogout,
}:NotificationsPageProps){
  return <div className="product-notifications-page" style={{maxWidth:600}}>
    <div className="gcard" style={{marginBottom:14}}>
      <div className="panel-eyebrow" style={{marginBottom:4}}><AppIcon name="notifications" size={15}/>Notification Preferences</div>
      <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>Control what alerts you receive</div>

      <div className="setting-row">
        <div><div className="setting-label">Login Notifications</div><div className="setting-desc">Email alert whenever a new sign-in is detected</div></div>
        <Toggle on={settings.notifications} onToggle={onToggleLoginNotifications}/>
      </div>
      <div className="setting-row">
        <div><div className="setting-label">Trade Alerts</div><div className="setting-desc">Notify when a buy/sell order is completed</div></div>
        <Toggle on={true} onToggle={onTradeAlerts}/>
      </div>
      <div className="setting-row">
        <div><div className="setting-label">Price Alerts</div><div className="setting-desc">Get notified when a coin or stock hits your target price</div></div>
        <button className="btn btn-ghost btn-sm" onClick={onManagePriceAlerts}>Manage</button>
      </div>
      <div className="setting-row" style={{borderBottom:isAdmin?undefined:"none"}}>
        <div><div className="setting-label">Live Balance Updates</div><div className="setting-desc">See your balance update on this device the moment a deposit is confirmed, even if you're already on the page</div></div>
        <Toggle label="Toggle live balance updates" on={balancePushSubscribed} onToggle={()=>{if(!balancePushBusy)onToggleBalancePush();}}/>
      </div>
      {isAdmin&&<div className="setting-row" style={{borderBottom:"none"}}>
        <div><div className="setting-label">Admin Device Alerts</div><div className="setting-desc">Push notification on this device for new pending requests</div></div>
        <Toggle label="Toggle admin device alerts" on={pushSubscribed} onToggle={()=>{if(!pushBusy)onToggleAdminPush();}}/>
      </div>}
    </div>

    <div className="gcard" style={{marginBottom:14}}>
      <div className="panel-eyebrow" style={{marginBottom:16}}><ProductIcon name="sparkle" size={15}/>Site Updates</div>
      {notificationLoading?<PanelLoading rows={3} label="Loading site updates"/>:siteUpdates.length===0?<div style={{fontSize:12,color:"var(--text3)"}}>No updates yet — you'll see new Wave features and announcements here.</div>:siteUpdates.map((update,index)=><div key={update.id} className="setting-row" style={{alignItems:"flex-start",borderBottom:index<siteUpdates.length-1?"1px solid var(--border)":"none",display:"block",paddingTop:12,paddingBottom:12}}>
        <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:2}}>{update.title}</div>
        <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.5,marginBottom:4}}>{update.body}</div>
        <div style={{fontSize:11,color:"var(--text3)"}}>{new Date(update.created_at).toLocaleString()}</div>
      </div>)}
    </div>

    <div className="gcard" style={{marginBottom:14}}>
      <div className="panel-eyebrow" style={{marginBottom:16}}><ProductIcon name="activity" size={15}/>Login Activity</div>
      {notificationLoading?<PanelLoading rows={3} label="Loading login activity"/>:loginHistory.length===0?<div style={{fontSize:12,color:"var(--text3)"}}>No login history yet — sign-ins across your devices will appear here.</div>:loginHistory.map((session,index)=><div key={session.id} className="setting-row" style={{borderBottom:index<loginHistory.length-1?"1px solid var(--border)":"none",paddingTop:12,paddingBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,borderRadius:"50%",background:"rgba(99,102,241,.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{/\bmobile\b/i.test(session.device)?"📱":"💻"}</div>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{session.device}{session.current&&<span className="badge badge-green" style={{marginLeft:8,fontSize:9}}>This device</span>}{session.trusted&&<span className="badge badge-blue" style={{marginLeft:8,fontSize:9}}>Trusted</span>}</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>Signed in {new Date(session.login_at).toLocaleString()}</div>
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <button className="btn btn-danger btn-sm" onClick={()=>onSignOutDevice(session)}>{session.current?"Sign out":"Sign out device"}</button>
              {session.trusted&&!session.current&&<button className="btn btn-ghost btn-sm" onClick={()=>onRevokeDeviceTrust(session)}>Revoke trust</button>}
            </div>
          </div>
        </div>
        <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,textAlign:"right"}}>{session.logout_at?`Signed out ${new Date(session.logout_at).toLocaleString()}`:<span style={{color:"var(--green)"}}>● Active</span>}</div>
      </div>)}
    </div>

    <div className="gcard">
      <div className="panel-eyebrow" style={{marginBottom:16}}><ProductIcon name="activity" size={15}/>Recent Activity</div>
      {activities.slice(0,5).map((activity,index)=><div key={index} className="setting-row" style={{borderBottom:index<4?"1px solid var(--border)":"none",paddingTop:12,paddingBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}><ActivityGlyph type={activity.type}/><div><div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{activity.type==="investment"?`${activity.label} activated`:`${activity.type.charAt(0).toUpperCase()+activity.type.slice(1)} ${activity.label}`}</div><div style={{fontSize:11,color:"var(--text3)"}}>{new Date(activity.created_at).toLocaleString()}</div></div></div>
        <div style={{fontSize:13,fontWeight:700,color:activity.type==="buy"||activity.type==="withdraw"?"var(--red)":"var(--green)"}}>{activity.type==="buy"||activity.type==="withdraw"||activity.type==="investment"?"-":"+"}${Number(activity.amount||0).toLocaleString()}</div>
      </div>)}
    </div>

    <div style={{marginTop:14}}><button className="btn btn-danger" style={{width:"100%",justifyContent:"center"}} onClick={onLogout}><ProductIcon name="logout" size={16}/>Sign Out</button></div>
  </div>;
}
