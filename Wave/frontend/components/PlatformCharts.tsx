import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BalancePoint } from "../types";
import type { ChartPt } from "../types/platform";

export function AnimatedStat({value,format}:{value:number;format:(n:number)=>string}){
  const[display,setDisplay]=useState(value);
  const prevRef=useRef(value);

  useEffect(()=>{
    const from=prevRef.current;
    const to=value;
    if(from===to){setDisplay(to);return;}
    const duration=600;
    const start=performance.now();
    let raf=0;
    const tick=(now:number)=>{
      const p=Math.min(1,(now-start)/duration);
      const eased=1-Math.pow(1-p,3);
      setDisplay(from+(to-from)*eased);
      if(p<1) raf=requestAnimationFrame(tick);
      else prevRef.current=to;
    };
    raf=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(raf);
  },[value]);

  return <>{format(display)}</>;
}

type WalletHistoryRange="7D"|"30D"|"ALL";

export function WalletBalanceHistoryChart({points,mobile}:{points:BalancePoint[];mobile:boolean}){
  const[range,setRange]=useState<WalletHistoryRange>("ALL");
  const[hoveredPoint,setHoveredPoint]=useState<BalancePoint|null>(null);
  const chronology=[...points].sort((a,b)=>new Date(a.date).getTime()-new Date(b.date).getTime());
  const latestTime=chronology.length?new Date(chronology[chronology.length-1].date).getTime():0;
  const rangeDays=range==="7D"?7:range==="30D"?30:0;
  const ranged=rangeDays&&Number.isFinite(latestTime)
    ?chronology.filter(point=>new Date(point.date).getTime()>=latestTime-rangeDays*86400000)
    :chronology;
  const history=ranged.length>1?ranged:chronology.slice(Math.max(0,chronology.length-(range==="7D"?7:30)));
  const firstBalance=Number(history[0]?.balance||0);
  const latestPoint=history[history.length-1];
  const focalPoint=hoveredPoint??latestPoint;
  const focalBalance=Number(focalPoint?.balance||0);
  const periodChange=focalBalance-firstBalance;
  const percentChange=firstBalance?periodChange/Math.abs(firstBalance)*100:0;
  const money=(value:number)=>`$${Number(value||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const compactMoney=(value:number)=>{
    const abs=Math.abs(value);
    if(abs>=1000000)return `$${(value/1000000).toFixed(abs>=100000000?0:1)}M`;
    if(abs>=1000)return `$${(value/1000).toFixed(abs>=100000?0:1)}K`;
    return `$${Math.round(value)}`;
  };
  const readableDate=(value:string,withTime=false)=>{
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return value;
    return date.toLocaleDateString(undefined,{month:"short",day:"numeric",...(withTime?{hour:"numeric",minute:"2-digit"}:{})});
  };
  const trendUp=periodChange>=0;

  return <div className="gcard wallet-history-card" style={{marginBottom:22,overflow:"hidden"}}>
    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,flexWrap:"wrap",marginBottom:mobile?14:18}}>
      <div style={{minWidth:0}}>
        <div className="stitle" style={{marginBottom:3}}>Main wallet balance history</div>
        <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5,maxWidth:560}}>Explore the balance rebuilt from your deposits, withdrawals, trades, and bonuses.</div>
      </div>
      <div role="group" aria-label="Balance history range" style={{display:"flex",gap:5,padding:4,border:"1px solid var(--border)",background:"var(--surface2)",borderRadius:11}}>
        {(["7D","30D","ALL"] as WalletHistoryRange[]).map(option=><button key={option} type="button" aria-pressed={range===option} onClick={()=>{setRange(option);setHoveredPoint(null);}} style={{border:0,borderRadius:8,padding:"7px 10px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"inherit",background:range===option?"#6366F1":"transparent",color:range===option?"#fff":"var(--text2)",boxShadow:range===option?"0 5px 13px rgba(99,102,241,.22)":"none",transition:"background .18s ease, color .18s ease, box-shadow .18s ease"}}>{option==="ALL"?"All":option}</button>)}
      </div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:mobile?"1fr":"minmax(0,1fr) auto",gap:12,alignItems:"stretch",marginBottom:14}}>
      <div style={{minWidth:0,border:"1px solid var(--border)",background:"linear-gradient(135deg, rgba(99,102,241,.13), transparent 72%)",borderRadius:13,padding:"12px 14px"}}>
        <div style={{display:"flex",alignItems:"center",gap:7,fontSize:10,color:"var(--text3)",fontWeight:800,textTransform:"uppercase",letterSpacing:".65px",marginBottom:5}}><span style={{width:7,height:7,borderRadius:"50%",background:"#6366F1",boxShadow:"0 0 0 4px rgba(99,102,241,.12)"}}/> {hoveredPoint?"Focused balance":"Latest balance"}</div>
        <div style={{fontSize:mobile?24:28,lineHeight:1.12,fontWeight:900,letterSpacing:"-.04em",fontVariantNumeric:"tabular-nums",overflowWrap:"anywhere"}}>{money(focalBalance)}</div>
        <div style={{fontSize:11,color:"var(--text3)",marginTop:5}}>{focalPoint?readableDate(focalPoint.date,true):"No history available"}</div>
      </div>
      <div style={{display:"flex",flexDirection:mobile?"row":"column",justifyContent:"center",gap:mobile?18:5,padding:"12px 14px",border:"1px solid var(--border)",borderRadius:13,minWidth:mobile?0:150}}>
        <div style={{fontSize:10,color:"var(--text3)",fontWeight:800,textTransform:"uppercase",letterSpacing:".65px",whiteSpace:"nowrap"}}>Period movement</div>
        <div style={{fontSize:16,fontWeight:900,color:trendUp?"var(--green)":"var(--red)",fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{trendUp?"+":"-"}{money(Math.abs(periodChange))}</div>
        <div style={{fontSize:11,color:trendUp?"var(--green)":"var(--red)",fontWeight:800,whiteSpace:"nowrap"}}>{trendUp?"↗":"↘"} {Math.abs(percentChange).toFixed(2)}%</div>
      </div>
    </div>

    <div style={{height:mobile?205:250,minWidth:0}}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={history} margin={{top:12,right:mobile?6:18,left:mobile?-13:2,bottom:0}} onMouseMove={(state:any)=>{
          const index=Number(state?.activeTooltipIndex);
          setHoveredPoint(state?.activePayload?.[0]?.payload??(Number.isInteger(index)?history[index]:null)??null);
        }} onMouseLeave={()=>setHoveredPoint(null)}>
          <defs>
            <linearGradient id="wallet-history-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366F1" stopOpacity={.32}/>
              <stop offset="92%" stopColor="#6366F1" stopOpacity={.015}/>
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={.72} strokeDasharray="3 5"/>
          <XAxis dataKey="date" minTickGap={mobile?30:48} tickFormatter={value=>readableDate(value)} tick={{fontSize:10,fill:"var(--text3)"}} axisLine={false} tickLine={false} dy={9}/>
          <YAxis width={mobile?45:58} tick={{fontSize:10,fill:"var(--text3)"}} axisLine={false} tickLine={false} tickFormatter={value=>compactMoney(Number(value))}/>
          <Tooltip cursor={{stroke:"#818CF8",strokeWidth:1,strokeDasharray:"3 4"}} content={({active,payload}:any)=>{
            const point=payload?.[0]?.payload as BalancePoint|undefined;
            if(!active||!point)return null;
            const balance=Number(point.balance||0);
            const change=balance-firstBalance;
            return <div style={{minWidth:164,padding:"10px 12px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:11,boxShadow:"0 14px 32px rgba(15,23,42,.16)",fontFamily:"inherit"}}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:".55px",textTransform:"uppercase",color:"var(--text3)",marginBottom:5}}>{readableDate(point.date,true)}</div>
              <div style={{fontSize:16,fontWeight:900,fontVariantNumeric:"tabular-nums",color:"var(--text)"}}>{money(balance)}</div>
              <div style={{fontSize:11,fontWeight:800,color:change>=0?"var(--green)":"var(--red)",marginTop:4}}>{change>=0?"+":"-"}{money(Math.abs(change))} from period start</div>
            </div>;
          }}/>
          <Area type="monotone" dataKey="balance" stroke="#6366F1" strokeWidth={2.6} fill="url(#wallet-history-fill)" animationDuration={520} activeDot={{r:5,fill:"var(--bg2)",stroke:"#6366F1",strokeWidth:3}}/>
        </AreaChart>
      </ResponsiveContainer>
    </div>
    <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",fontSize:10,color:"var(--text3)",marginTop:8,paddingTop:10,borderTop:"1px solid var(--border)"}}><span>{history.length} recorded balance event{history.length===1?"":"s"}</span><span>Hover any point for an exact balance</span></div>
  </div>;
}

export function TerminalChart({data,symbol}:{data:ChartPt[];symbol:string}){
  const points=(data.length?data:[{t:0,v:0}]).slice(-48);
  const closes=points.map(point=>point.v);
  const minClose=Math.min(...closes);
  const maxClose=Math.max(...closes);
  const spread=Math.max(maxClose-minClose,Math.max(Math.abs(maxClose)*.018,1));
  const floor=minClose-spread*.28;
  const ceiling=maxClose+spread*.28;
  const plotTop=15;
  const plotBottom=232;
  const plotHeight=plotBottom-plotTop;
  const candleGap=1000/points.length;
  const candleWidth=Math.max(4,Math.min(11,candleGap*.52));
  const y=(value:number)=>plotBottom-((value-floor)/(ceiling-floor))*plotHeight;
  const candles=points.map((point,index)=>{
    const open=points[Math.max(0,index-1)]?.v??point.v;
    const close=point.v;
    const variance=Math.max(Math.abs(close-open)*.52,spread*(.025+((index*7)%5)*.006));
    const high=Math.max(open,close)+variance;
    const low=Math.min(open,close)-variance*.88;
    const up=close>=open;
    const volume=18+((Math.abs(close-open)/spread)*45)+((index*13)%19);
    return{open,close,high,low,up,volume};
  });
  const formatPrice=(value:number)=>value>=1000?`$${Math.round(value).toLocaleString()}`:`$${value.toFixed(value<10?3:2)}`;
  const labels=Array.from({length:4},(_,index)=>ceiling-((ceiling-floor)*index/3));

  return <div className="market-terminal-chart" role="img" aria-label={`${symbol} candlestick chart`}>
    <div className="market-terminal-chart-plot">
      <svg viewBox="0 0 1000 320" preserveAspectRatio="none" aria-hidden="true">
        {[0,1,2,3,4].map(index=>{
          const yPos=plotTop+(plotHeight/4)*index;
          return <line key={`grid-${index}`} className="market-terminal-gridline" x1="0" x2="1000" y1={yPos} y2={yPos}/>;
        })}
        {candles.map((candle,index)=>{
          const x=candleGap*index+candleGap/2;
          const openY=y(candle.open);
          const closeY=y(candle.close);
          const highY=y(candle.high);
          const lowY=y(candle.low);
          const bodyTop=Math.min(openY,closeY);
          const bodyHeight=Math.max(2,Math.abs(closeY-openY));
          return <g key={`${points[index].t}-${index}`} className={candle.up?"market-terminal-candle up":"market-terminal-candle down"}>
            <line x1={x} x2={x} y1={highY} y2={lowY}/>
            <rect x={x-candleWidth/2} y={bodyTop} width={candleWidth} height={bodyHeight} rx="1"/>
            <rect className="market-terminal-volume" x={x-candleWidth/2} y={300-candle.volume} width={candleWidth} height={candle.volume} rx="1"/>
          </g>;
        })}
        <line className="market-terminal-latest-line" x1="0" x2="1000" y1={y(candles[candles.length-1].close)} y2={y(candles[candles.length-1].close)}/>
      </svg>
      <div className="market-terminal-price-scale" aria-hidden="true">
        {labels.map((label,index)=><span key={index}>{formatPrice(label)}</span>)}
      </div>
    </div>
    <div className="market-terminal-chart-axis" aria-hidden="true"><span>09:00</span><span>12:00</span><span>15:00</span><span>18:00</span><span>Now</span></div>
  </div>;
}

export function MarketSparkline({data,positive}:{data:ChartPt[];positive:boolean}){
  const points=(data.length?data:[{t:0,v:0},{t:1,v:0}]).slice(-26);
  const values=points.map(point=>point.v);
  const low=Math.min(...values);
  const high=Math.max(...values);
  const span=Math.max(high-low,1);
  const d=points.map((point,index)=>{
    const x=(index/(Math.max(points.length-1,1)))*100;
    const y=21-((point.v-low)/span)*17;
    return `${index===0?"M":"L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return <svg className={`market-sparkline ${positive?"positive":"negative"}`} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d={d}/></svg>;
}
