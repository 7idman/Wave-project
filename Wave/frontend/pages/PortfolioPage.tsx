import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Portfolio } from "../types";
import { COINS } from "../data/market";
import { CoinIcon } from "../components/PlatformPrimitives";

type PortfolioPageProps={
  portfolio:Portfolio;
  mobile:boolean;
  tablet:boolean;
  compactStats:boolean;
  currency:(value:number)=>string;
  compactCurrency:(value:number)=>string;
  onOpenCoin:(symbol:string)=>void;
};

export function PortfolioPage({portfolio:port,mobile:mob,tablet:tab,compactStats:useCompactStats,currency:cur,compactCurrency:compactCur,onOpenCoin:openCoin}:PortfolioPageProps){
  const pieData=port.holdings.filter(h=>h.amount>0).map(h=>({name:h.symbol,value:h.value,color:COINS[h.symbol]?.color||"#ccc"}));

  return <div className="page-wrap product-portfolio-page">
    <div className="stats portfolio-stats" style={{marginBottom:mob?14:24}}>
      {[
        {l:"Total Value",v:useCompactStats?compactCur(port.totalValue):cur(port.totalValue),full:cur(port.totalValue),glow:"#6366F1"},
        {l:"Invested",v:useCompactStats?compactCur(port.totalPortfolioValue):cur(port.totalPortfolioValue),full:cur(port.totalPortfolioValue),glow:"#06B6D4"},
        {l:"Cash",v:useCompactStats?compactCur(port.cashBalance):cur(port.cashBalance),full:cur(port.cashBalance),glow:"#10B981"},
        {l:"Assets Held",v:port.holdings.filter(h=>h.amount>0).length,full:undefined,glow:"#8B5CF6"},
      ].map((stat,index)=><div key={index} className="stat" title={stat.full?`${stat.l}: ${stat.full}`:undefined} aria-label={stat.full?`${stat.l}: ${stat.full}`:undefined}>
        <div className="stat-glow" style={{background:stat.glow}}/>
        <div className="stat-label">{stat.l}</div>
        <div className="stat-value">{stat.v}</div>
      </div>)}
    </div>

    <div style={{display:"grid",gridTemplateColumns:tab?"1fr":"1.8fr 1fr",gap:18,marginBottom:22}}>
      <div>
        <div className="stitle">All Holdings</div>
        <div className="hgrid" style={{gridTemplateColumns:"repeat(2,1fr)"}}>
          {Object.entries(COINS).map(([symbol,meta])=>{
            const holding=port.holdings.find(item=>item.symbol===symbol);
            const amount=holding?.amount||0;
            const value=holding?.value||0;
            const percentage=port.totalPortfolioValue>0?((value/port.totalPortfolioValue)*100).toFixed(1):"0";
            return <div key={symbol} className="hi" onClick={()=>openCoin(symbol)}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${meta.color},transparent)`,opacity:amount>0?1:.3,borderRadius:"18px 18px 0 0"}}/>
              <div className="hitop"><CoinIcon symbol={symbol} size={32}/><div><div className="hsym">{symbol}</div><div className="hnm">{meta.name}</div></div><div style={{marginLeft:"auto",fontSize:11,color:"var(--text3)",fontWeight:600}}>{percentage}%</div></div>
              <div className="hamt" style={{color:amount>0?"var(--text)":"var(--text3)",fontSize:18}}>{amount||"—"}</div>
              <div className="husd">${value.toLocaleString("en-US",{minimumFractionDigits:2})}</div>
              <div className="hbar-bg"><div className="hbar" style={{width:`${percentage}%`,background:`linear-gradient(90deg,${meta.color},${meta.color}66)`}}/></div>
            </div>;
          })}
        </div>
      </div>

      {!mob&&<div>
        <div className="stitle">Allocation</div>
        <div className="gcard">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                {pieData.map((entry,index)=><Cell key={index} fill={entry.color}/>)}
              </Pie>
              <Tooltip formatter={(value:any)=>`$${Number(value).toLocaleString()}`} contentStyle={{background:"#1C1E2E",border:"1px solid rgba(255,255,255,.08)",borderRadius:10,color:"#F1F2F8"}}/>
            </PieChart>
          </ResponsiveContainer>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:12}}>
            {pieData.map((entry,index)=><div key={index} style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}><CoinIcon symbol={entry.name} size={18}/><span style={{fontSize:12,fontWeight:700,color:"var(--text)"}}>{entry.name}</span></div>
              <span style={{fontSize:12,color:"var(--text3)",fontWeight:600}}>{port.totalPortfolioValue>0?((entry.value/port.totalPortfolioValue)*100).toFixed(1):0}%</span>
            </div>)}
          </div>
        </div>
      </div>}
    </div>
  </div>;
}
