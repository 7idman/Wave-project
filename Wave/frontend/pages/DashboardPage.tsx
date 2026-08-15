import type { Dispatch, SetStateAction } from "react";
import type { Portfolio, Price } from "../types";
import type { Activity, ChartPt, SiteUpdate } from "../types/platform";
import type { Range } from "../data/market";
import { COINS } from "../data/market";
import { TradingViewTicker } from "../components/TradingViewTicker";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { AppIcon, CoinIcon } from "../components/PlatformPrimitives";
import { AnimatedStat, MarketSparkline, TerminalChart } from "../components/PlatformCharts";
import { ActivityGlyph, ProductIcon } from "../components/ProductIcons";
import { EmptyState, PanelLoading } from "../components/PlatformFeedback";

type DashboardPageProps={
  mobile:boolean;
  theme:"Light"|"Dark";
  accountLoading:boolean;
  portfolio:Portfolio;
  dayPnl:number;
  dayPnlPercent:number;
  compactStats:boolean;
  currency:(value:number)=>string;
  compactCurrency:(value:number)=>string;
  selectedCoin:string;
  selectedPrice:number;
  prices:Record<string,Price>;
  priceDirection:Record<string,boolean>;
  chartRange:Range;
  charts:Record<string,ChartPt[]>;
  selectedChart:ChartPt[];
  watchlist:string[];
  showWatchlist:boolean;
  notificationLoading:boolean;
  activities:Activity[];
  siteUpdates:SiteUpdate[];
  onDeposit:()=>void;
  onTrade:(type:string)=>void;
  onNavigate:(page:string)=>void;
  onSelectCoin:(symbol:string)=>void;
  onRangeChange:(range:Range)=>void;
  setShowWatchlist:Dispatch<SetStateAction<boolean>>;
  onToggleWatch:(symbol:string)=>void;
  onOpenCoin:(symbol:string)=>void;
};

export function DashboardPage({
  mobile:mob,theme,accountLoading,portfolio:port,dayPnl,dayPnlPercent:dayPnlPct,
  compactStats:useCompactStats,currency:cur,compactCurrency:compactCur,selectedCoin:selCoin,
  selectedPrice:lp,prices,priceDirection:priceDir,chartRange,charts,selectedChart:lcd,
  watchlist,showWatchlist,notificationLoading:notifLoading,activities,siteUpdates,onDeposit:goToDeposit,
  onTrade,onNavigate:nav,onSelectCoin:setSelCoin,onRangeChange:setChartRange,setShowWatchlist,
  onToggleWatch:toggleWatch,onOpenCoin:openCoin,
}:DashboardPageProps){
  return <div className="dashboard-page">
    <div className="dashboard-ticker" style={{marginBottom:mob?12:16}}><ErrorBoundary boundaryName="tradingview-ticker" fallback={null}><TradingViewTicker colorTheme={theme==="Light"?"light":"dark"}/></ErrorBoundary></div>
    <div className="stats dashboard-stats" style={{marginTop:mob?12:0}}>
      {accountLoading?[0,1,2,3].map(index=><div key={index} className="stat skeleton" style={{minHeight:88}}/>):[
        {l:"Portfolio Value",raw:port.totalPortfolioValue,s:"Invested",pos:null,glow:"#35C7F2",tone:"portfolio",tip:"Current market value of your holdings only, excluding cash"},
        {l:"Cash Balance",raw:port.cashBalance,s:"Available",pos:null,glow:"#22D3A5",tone:"cash",tip:"Uninvested cash available to trade or withdraw",cash:true},
        {l:"24h P&L",raw:dayPnl,s:`${dayPnl>=0?"+":""}${dayPnlPct.toFixed(2)}%`,pos:dayPnl>=0,glow:dayPnl>=0?"#22D3A5":"#F35D78",tone:dayPnl>=0?"positive":"negative",tip:"Unrealized 24h price movement on your current holdings. Doesn't separate out trades made earlier today — cash isn't included since it doesn't move in price.",signed:true},
        {l:"Buying Power",raw:port.cashBalance,s:"Ready to trade",pos:null,glow:"#A99BFF",tone:"buying",tip:"Funds currently available for your next trade",cash:true},
      ].map((stat,index)=><div key={index} className={`stat kpi-${stat.tone} ${stat.cash?"balance-link":""}`} onClick={stat.cash?goToDeposit:undefined} title={`${stat.tip} (${cur(stat.raw)})`} aria-label={`${stat.l}: ${cur(stat.raw)}. ${stat.tip}`}>
        <div className="stat-glow" style={{background:stat.glow}}/>
        <div className="stat-label">{stat.l}</div>
        <div className="stat-value">{stat.signed&&stat.raw<0?"-":stat.signed?"+":""}<AnimatedStat value={Math.abs(stat.raw)} format={useCompactStats?compactCur:cur}/></div>
        <div className="stat-sub" style={{color:stat.pos===true?"var(--green)":stat.pos===false?"var(--red)":"var(--text3)"}}>{stat.pos===true&&<ProductIcon name="trendUp" size={12}/>} {stat.pos===false&&<ProductIcon name="trendDown" size={12}/>} {stat.s}</div>
      </div>)}
    </div>

    <div className="quick-actions dashboard-actions" style={{display:"flex",gap:10,flexWrap:"wrap",margin:"16px 0"}}>
      <button className="btn btn-primary btn-sm" onClick={()=>onTrade("buy")} title="Buy crypto"><AppIcon name="plus" size={15}/>Buy</button>
      <button className="btn btn-ghost btn-sm" onClick={goToDeposit} title="Add funds to your cash balance"><ProductIcon name="deposit" size={15}/>Deposit</button>
      <button className="btn btn-ghost btn-sm" onClick={()=>onTrade("withdraw")} title="Withdraw cash"><ProductIcon name="withdraw" size={15}/>Withdraw</button>
      <button className="btn btn-ghost btn-sm" onClick={()=>nav("portfolio")} title="View full portfolio"><AppIcon name="portfolio" size={15}/>Portfolio</button>
    </div>

    <div className="crow dashboard-market-layout">
      <div className="gcard dashboard-market-chart" style={{padding:26}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontSize:12,color:"var(--text3)",fontWeight:500,marginBottom:4}}>{COINS[selCoin]?.name} / USD</div>
            <div className="pbig">${lp.toLocaleString()}</div>
            <div className="pchg" style={{color:(prices[selCoin]?.change24h||0)>=0?"var(--green)":"var(--red)"}}><ProductIcon name={priceDir[selCoin]?"trendUp":"trendDown"} size={14}/> {Math.abs(prices[selCoin]?.change24h||0).toFixed(2)}% <span style={{color:"var(--text3)",fontSize:11}}>24h</span></div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"flex-end"}}>
            <div className="coin-pills">{Object.keys(COINS).map(symbol=><button key={symbol} className={`chip ${selCoin===symbol?"active":""}`} onClick={()=>setSelCoin(symbol)} style={{display:"flex",alignItems:"center",gap:5}}><CoinIcon symbol={symbol} size={14}/>{symbol}</button>)}</div>
            <div className="range-pills">{(["1H","1D","1W","1M"] as Range[]).map(range=><button key={range} className={`chip ${chartRange===range?"active":""}`} style={{padding:"4px 10px",fontSize:10}} onClick={()=>setChartRange(range)}>{range}</button>)}</div>
          </div>
        </div>
        <TerminalChart data={lcd} symbol={selCoin}/>
      </div>

      <div className="gcard dashboard-market-list" style={{padding:mob?"14px":"20px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:14}}>
          <div style={{fontSize:11,color:"var(--text3)",fontWeight:700,letterSpacing:".8px",textTransform:"uppercase"}}>Live Markets</div>
          <button className="btn btn-ghost btn-sm" onClick={()=>setShowWatchlist(value=>!value)} style={{padding:"5px 9px",fontSize:10}}>{showWatchlist?"All markets":<><ProductIcon name="watch" size={13}/>Watchlist</>}</button>
        </div>
        <div className="mlist">
          {(showWatchlist?watchlist:Object.keys(COINS)).map(symbol=>{
            const meta=COINS[symbol];
            const data=charts[symbol]||[];
            const value=data[data.length-1]?.v||prices[symbol]?.price||0;
            const positive=(prices[symbol]?.change24h||0)>=0;
            return <div key={symbol} className="mitem" onClick={()=>openCoin(symbol)}>
              <div style={{display:"flex",alignItems:"center",gap:10}}><CoinIcon symbol={symbol} size={32}/><div><div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{mob?symbol:meta.name}</div><div style={{fontSize:10,color:"var(--text3)",fontWeight:500}}>{symbol}</div></div></div>
              <MarketSparkline data={data} positive={positive}/>
              <button className={`market-watch-toggle ${watchlist.includes(symbol)?"active":""}`} aria-label={`${watchlist.includes(symbol)?"Remove":"Add"} ${symbol} ${watchlist.includes(symbol)?"from":"to"} watchlist`} onClick={event=>{event.stopPropagation();toggleWatch(symbol);}}><ProductIcon name="watch" size={15}/></button>
              <div style={{textAlign:"right"}}><div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>${value.toLocaleString()}</div><div style={{fontSize:10,fontWeight:700,color:positive?"var(--green)":"var(--red)",marginTop:2}}>{positive?"+":""}{(prices[symbol]?.change24h||0).toFixed(2)}%</div></div>
            </div>;
          })}
          {showWatchlist&&watchlist.length===0&&<EmptyState compact title="Your watchlist is empty" description="Star a market to keep it close."/>}
        </div>
      </div>
    </div>

    <div className="dashboard-section-head" style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"nowrap",gap:8}}>
      <div className="stitle" style={{marginBottom:0,flexShrink:0}}>My Holdings</div>
      <button className="btn btn-ghost btn-sm" style={{borderRadius:100,padding:"7px 14px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",flexShrink:0,border:"1px solid var(--border2)"}} onClick={()=>nav("portfolio")}>View all →</button>
    </div>
    <div className="hgrid dashboard-holdings-grid">
      {port.holdings.filter(holding=>holding.amount>0).map(holding=>{
        const meta=COINS[holding.symbol];
        const percentage=port.totalPortfolioValue>0?(holding.value/port.totalPortfolioValue*100).toFixed(1):"0";
        const positive=(holding.change24h||0)>=0;
        return <div key={holding.symbol} className="hi" onClick={()=>openCoin(holding.symbol)}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${meta?.color},transparent)`,borderRadius:"18px 18px 0 0"}}/>
          <div className="hitop"><CoinIcon symbol={holding.symbol} size={32}/><div><div className="hsym">{holding.symbol}</div><div className="hnm">{meta?.name}</div></div><div style={{marginLeft:"auto",flexShrink:0}}><span className={positive?"badge badge-green":"badge badge-red"} style={{fontSize:9,padding:"2px 7px"}}>{positive?"▲":"▼"} {Math.abs(holding.change24h||0).toFixed(2)}%</span></div></div>
          <div className="hamt">{holding.amount}</div>
          <div className="husd">${holding.value.toLocaleString("en-US",{minimumFractionDigits:2})}</div>
          <div className="hbar-bg"><div className="hbar" style={{width:`${percentage}%`,background:`linear-gradient(90deg,${meta?.color},${meta?.color}88)`}}/></div>
        </div>;
      })}
    </div>

    <div className="dashboard-bottom-grid">
      <div className="gcard dashboard-activity-card" style={{marginTop:20}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}><div className="panel-eyebrow"><ProductIcon name="activity" size={15}/>Recent Activity</div><button className="btn btn-ghost btn-sm panel-link" onClick={()=>nav("notifications")}>View all <ProductIcon name="arrowRight" size={13}/></button></div>
        {notifLoading?<PanelLoading rows={4} label="Loading recent activity"/>:activities.length===0?<EmptyState compact title="No activity yet" description="Trades and transfers will appear here."/>:activities.slice(0,5).map((activity,index)=><div key={index} className="setting-row" style={{borderBottom:index<Math.min(4,activities.length-1)?"1px solid var(--border)":"none",paddingTop:12,paddingBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}><ActivityGlyph type={activity.type}/><div><div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{activity.type==="investment"?`${activity.label} activated`:`${activity.type.charAt(0).toUpperCase()+activity.type.slice(1)} ${activity.label}`}</div><div style={{fontSize:11,color:"var(--text3)"}}>{new Date(activity.created_at).toLocaleString()}</div></div></div>
          <div style={{fontSize:13,fontWeight:700,color:activity.type==="buy"||activity.type==="withdraw"?"var(--red)":"var(--green)"}}>{activity.type==="buy"||activity.type==="withdraw"||activity.type==="investment"?"-":"+"}${Number(activity.amount||0).toLocaleString()}</div>
        </div>)}
      </div>

      <DashboardInsights portfolio={port} dayPnl={dayPnl} dayPnlPercent={dayPnlPct}/>

      <div className="gcard dashboard-notifications-card" style={{marginTop:20}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}><div className="panel-eyebrow"><AppIcon name="notifications" size={15}/>Notifications</div><button className="btn btn-ghost btn-sm panel-link" onClick={()=>nav("notifications")}>View all <ProductIcon name="arrowRight" size={13}/></button></div>
        {notifLoading?<PanelLoading rows={3} label="Loading notifications"/>:siteUpdates.length===0?<EmptyState compact title="You're all caught up" description="New account notices will appear here."/>:siteUpdates.slice(0,3).map((update,index)=><div key={index} style={{padding:"10px 0",borderBottom:index<Math.min(2,siteUpdates.length-1)?"1px solid var(--border)":"none"}}><div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{update.title}</div><div style={{fontSize:12,color:"var(--text3)",marginTop:2}}>{update.body}</div></div>)}
      </div>
    </div>
  </div>;
}

function DashboardInsights({portfolio:port,dayPnl,dayPnlPercent:dayPnlPct}:{portfolio:Portfolio;dayPnl:number;dayPnlPercent:number}){
  const heldOnly=port.holdings.filter(holding=>holding.amount>0);
  const topHolding=heldOnly.length?heldOnly.reduce((a,b)=>a.value>b.value?a:b):null;
  const topPercentage=topHolding&&port.totalPortfolioValue>0?(topHolding.value/port.totalPortfolioValue*100):0;
  const cashPercentage=port.totalValue>0?(port.cashBalance/port.totalValue*100):0;
  const insights=[
    topHolding?{icon:<AppIcon name="portfolio" size={17}/>,tone:"violet",text:<>Your largest position is <b>{topHolding.symbol}</b>, {topPercentage.toFixed(0)}% of your portfolio.</>}:{icon:<ProductIcon name="sparkle" size={17}/>,tone:"violet",text:<>You don't hold any assets yet — head to Trade to make your first buy.</>},
    {icon:<ProductIcon name={dayPnl>=0?"trendUp":"trendDown"} size={17}/>,tone:dayPnl>=0?"green":"red",text:<>Your holdings are <b style={{color:dayPnl>=0?"var(--green)":"var(--red)"}}>{dayPnl>=0?"up":"down"} {Math.abs(dayPnlPct).toFixed(2)}%</b> over the last 24h.</>},
    {icon:<ProductIcon name="wallet" size={17}/>,tone:"cyan",text:cashPercentage>40?<><b>{cashPercentage.toFixed(0)}%</b> of your account is sitting in cash — consider putting it to work.</>:<>{cashPercentage.toFixed(0)}% of your account is in cash — the rest is invested.</>},
  ];
  return <div className="gcard dashboard-insights-card" style={{marginTop:20}}>
    <div className="panel-eyebrow"><ProductIcon name="sparkle" size={15}/>Insights</div>
    {insights.map((insight,index)=><div key={index} style={{display:"flex",alignItems:"flex-start",gap:12,padding:"10px 0",borderBottom:index<insights.length-1?"1px solid var(--border)":"none"}}><span className={`insight-glyph ${insight.tone}`}>{insight.icon}</span><span style={{fontSize:13,color:"var(--text2)",lineHeight:1.5}}>{insight.text}</span></div>)}
  </div>;
}
