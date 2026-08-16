import type { Tx } from "../types";
import { COINS } from "../data/market";
import { CoinIcon } from "../components/PlatformPrimitives";
import { EmptyState } from "../components/PlatformFeedback";
import { ActivityGlyph } from "../components/ProductIcons";

function statusBadge(status:string){
  if(status==="completed")return{cls:"badge-green",icon:"✓"};
  if(status==="failed"||status==="rejected")return{cls:"badge-red",icon:"✕"};
  return{cls:"badge-gray",icon:"⏳"};
}

export function HistoryPage({transactions:txs,mobile:mob}:{transactions:Tx[];mobile:boolean}){
  return <div className="gcard history-ledger-card" style={{padding:0,overflow:"hidden"}}>
    <div style={{padding:mob?"14px 16px 12px":"22px 24px 16px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
      <div className="stitle" style={{marginBottom:0}}>All Transactions</div>
      <span style={{fontSize:11,color:"var(--text3)",fontWeight:600}}>{txs.length} total</span>
    </div>
    {txs.length===0?<EmptyState title="No transactions yet" description="Your completed trades and transfers will be recorded here."/>:<>
    <div className="txwrap">
      <table className="txt">
        <thead><tr><th>Type</th><th>Asset</th><th>Amount</th><th>Price</th><th>Total</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>
          {txs.map(tx=>{
            const status=statusBadge(tx.status);
            return <tr key={tx.id}>
              <td><span className={`tbadge ${tx.type==="buy"?"badge-green":tx.type==="sell"?"badge-red":tx.type==="deposit"?"badge-blue":"badge-purple"}`}>{tx.type}</span></td>
              <td style={{display:"flex",alignItems:"center",gap:8,color:"var(--text)",fontWeight:700}}><CoinIcon symbol={tx.symbol} size={20}/>{tx.symbol}</td>
              <td>{tx.amount}</td>
              <td>${(tx.price||0).toLocaleString()}</td>
              <td style={{color:tx.type==="buy"||tx.type==="withdraw"?"var(--red)":"var(--green)",fontWeight:700}}>{tx.type==="buy"||tx.type==="withdraw"?"-":"+"}${(tx.total||0).toLocaleString()}</td>
              <td>{(tx.created_at||"").slice(0,10)}</td>
              <td><span className={`badge ${status.cls}`}>{status.icon} {tx.status}</span></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <div className="txcards history-cards" style={{padding:"12px 14px 16px"}}>
      {txs.map(tx=><div key={tx.id} className="txc">
        <div className="txctop">
          <div className="txcidentity">
            <ActivityGlyph type={tx.type}/>
            <div className="txcprimary">
              <div className="txcasset"><CoinIcon symbol={tx.symbol} size={18}/><span className="txcsym" style={{color:COINS[tx.symbol]?.color||"var(--text)"}}>{tx.symbol}</span></div>
              <span className={`tbadge ${tx.type==="buy"?"badge-green":tx.type==="sell"?"badge-red":tx.type==="deposit"?"badge-blue":"badge-purple"}`}>{tx.type}</span>
            </div>
          </div>
          <div className="txcmeta"><span className="txcdate">{(tx.created_at||"").slice(0,10)}</span><span className={`badge ${statusBadge(tx.status).cls}`}>{statusBadge(tx.status).icon} {tx.status}</span></div>
        </div>
        <div className="txcbot">
          <span className="txcamt"><small>Amount</small>{tx.amount} @ ${(tx.price||0).toLocaleString()}</span>
          <span className="txctot" style={{color:tx.type==="buy"||tx.type==="withdraw"?"var(--red)":"var(--green)"}}>{tx.type==="buy"||tx.type==="withdraw"?"-":"+"}${(tx.total||0).toLocaleString()}</span>
        </div>
      </div>)}
    </div>
    </>}
  </div>;
}
