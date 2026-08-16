import { useEffect, useState, type CSSProperties } from "react";

const STOCK_DOMAINS:Record<string,string>={
  AAPL:"apple.com",MSFT:"microsoft.com",GOOGL:"google.com",AMZN:"amazon.com",
  TSLA:"tesla.com",NVDA:"nvidia.com",META:"meta.com",NFLX:"netflix.com",
  ADBE:"adobe.com",CRM:"salesforce.com",ORCL:"oracle.com",INTC:"intel.com",
  AMD:"amd.com",CSCO:"cisco.com",IBM:"ibm.com",JPM:"jpmorganchase.com",
  V:"visa.com",MA:"mastercard.com",BAC:"bankofamerica.com",WFC:"wellsfargo.com",
  GS:"goldmansachs.com",MS:"morganstanley.com",AXP:"americanexpress.com",
  JNJ:"jnj.com",PFE:"pfizer.com",UNH:"unitedhealthgroup.com",ABBV:"abbvie.com",
  MRK:"merck.com",LLY:"lilly.com",WMT:"walmart.com",PG:"pg.com",
  KO:"coca-colacompany.com",PEP:"pepsico.com",MCD:"mcdonalds.com",NKE:"nike.com",
  SBUX:"starbucks.com",DIS:"thewaltdisneycompany.com",HD:"homedepot.com",
  COST:"costco.com",XOM:"exxonmobil.com",CVX:"chevron.com",BA:"boeing.com",
  CAT:"caterpillar.com",GE:"ge.com",T:"att.com",VZ:"verizon.com",
};

export function StockLogo({symbol,size=40,color="#5b5fe8"}:{symbol:string;size?:number;color?:string}){
  const[failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[symbol]);
  const domain=STOCK_DOMAINS[symbol];
  const initials=symbol.length>3?symbol.slice(0,2):symbol;

  return <span className="stock-logo" style={{width:size,height:size,"--stock-fallback":color} as CSSProperties} aria-hidden="true">
    {!failed&&domain
      ?<img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>
      :<span>{initials}</span>}
  </span>;
}
