import { EmptyState, PanelLoading } from "../components/PlatformFeedback";

export type ReferralData={
  code:string|null;
  totalEarned:number;
  referrerBonus:number;
  refereeBonus:number;
  depositThreshold:number;
  referrals:{id:number;refereeName:string;status:string;thresholdAmount:number;completedAt:string|null;createdAt:string}[];
};

type ReferralsPageProps={
  data:ReferralData|null;
  loading:boolean;
  mobile:boolean;
  notify:(message:string)=>void;
};

export function ReferralsPage({data:referralData,loading:referralLoading,mobile:mob,notify}:ReferralsPageProps){
  return <div className="product-referrals-page" style={{display:"grid",gridTemplateColumns:mob?"1fr":"1.1fr .9fr",gap:18}}>
    <div className="gcard" style={{padding:30,background:"linear-gradient(135deg,#1a1035,#2a1245)"}}>
      <div style={{fontSize:11,color:"#d8b4fe",fontWeight:800,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Refer a friend</div>
      <div style={{fontFamily:"'Plus Jakarta Sans',sans-serif",fontSize:26,fontWeight:900,lineHeight:1.2,color:"#fff"}}>Give ${referralData?.refereeBonus??5}, get ${referralData?.referrerBonus??10}.</div>
      <p style={{color:"#e9d5ff",fontSize:13,lineHeight:1.6,marginTop:10}}>Share your code below. When a friend signs up and deposits at least ${referralData?.depositThreshold??100}, you both get a cash bonus — usable for trading right away.</p>
      {referralLoading?<PanelLoading rows={1} label="Loading referral code" className="referral-code-loading"/>:referralData?.code?<>
        <div style={{display:"flex",gap:8,marginTop:20}}>
          <div style={{flex:1,background:"rgba(255,255,255,.1)",borderRadius:10,padding:"12px 16px",fontFamily:"monospace",fontSize:18,fontWeight:800,color:"#fff",letterSpacing:2,textAlign:"center"}}>{referralData.code}</div>
          <button className="btn btn-primary" onClick={()=>{navigator.clipboard?.writeText(referralData.code!);notify("Code copied");}}>Copy</button>
        </div>
        <button className="btn" style={{width:"100%",marginTop:10,background:"rgba(255,255,255,.1)",color:"#fff"}} onClick={()=>{navigator.clipboard?.writeText(`${window.location.origin}?ref=${referralData.code}`);notify("Referral link copied");}}>Copy shareable link</button>
        <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid rgba(255,255,255,.12)",display:"flex",justifyContent:"space-between"}}>
          <div><div style={{fontSize:11,color:"#e9d5ff"}}>Friends referred</div><div style={{fontSize:20,fontWeight:800,color:"#fff"}}>{referralData.referrals.length}</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"#e9d5ff"}}>Total earned</div><div style={{fontSize:20,fontWeight:800,color:"#fff"}}>${referralData.totalEarned.toLocaleString()}</div></div>
        </div>
      </>:<div style={{color:"#e9d5ff",fontSize:13,marginTop:20}}>Couldn't load your referral code — try reopening this page.</div>}
    </div>

    <div className="gcard" style={{padding:0,overflow:"hidden"}}>
      <div style={{padding:mob?"14px 16px 12px":"22px 24px 16px",borderBottom:"1px solid var(--border)"}}><div className="stitle" style={{marginBottom:0}}>Your Referrals</div></div>
      {referralLoading?<PanelLoading rows={3} label="Loading referrals"/>
        :!referralData?.referrals.length?<EmptyState title="No referrals yet" description="Share your code to start earning rewards together."/>
        :<div style={{padding:mob?"8px 16px 16px":"8px 24px 20px"}}>
          {referralData.referrals.map(referral=><div key={referral.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid var(--border)"}}>
            <div><div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{referral.refereeName}</div><div style={{fontSize:11,color:"var(--text3)"}}>Joined {new Date(referral.createdAt).toLocaleDateString()}</div></div>
            {referral.status==="completed"?<span className="badge badge-green">Earned ${referralData.referrerBonus}</span>:<span className="badge badge-blue">Needs ${referral.thresholdAmount} deposit</span>}
          </div>)}
        </div>}
    </div>
  </div>;
}
