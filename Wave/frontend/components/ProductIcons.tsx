import type { ReactElement } from "react";
import { AppIcon } from "./PlatformPrimitives";

export type ProductIconName="sparkle"|"deposit"|"withdraw"|"logout"|"arrowRight"|"trendUp"|"trendDown"|"activity"|"wallet"|"watch";

export function ProductIcon({name,size=18}:{name:ProductIconName;size?:number}){
  const paths:Record<ProductIconName,ReactElement>={
    sparkle:<><path d="m12 3 .9 4.1L17 8l-4.1.9L12 13l-.9-4.1L7 8l4.1-.9L12 3Z"/><path d="m18.5 14 .5 2.1 2 .4-2 .5-.5 2.1-.5-2.1-2-.5 2-.4.5-2.1Z"/><path d="m5.5 15 .5 2.1 2 .4-2 .5-.5 2.1-.5-2.1-2-.5 2-.4.5-2.1Z"/></>,
    deposit:<><path d="M12 3v13"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></>,
    withdraw:<><path d="M12 21V8"/><path d="m7 13 5-5 5 5"/><path d="M5 4h14"/></>,
    logout:<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></>,
    arrowRight:<path d="M5 12h14m-5-5 5 5-5 5"/>,
    trendUp:<><path d="M4 17 9 12l3 3 7-8"/><path d="M14 7h5v5"/></>,
    trendDown:<><path d="m4 7 5 5 3-3 7 8"/><path d="M14 17h5v-5"/></>,
    activity:<><circle cx="12" cy="12" r="8.5"/><path d="M7 12h2l1.2-3 2.3 6 1.5-3H17"/></>,
    wallet:<><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5z"/><path d="M4 9h13a2 2 0 0 1 2 2v2H14a2 2 0 0 0 0 4h5"/><circle cx="14" cy="15" r=".7" fill="currentColor" stroke="none"/></>,
    watch:<path d="m12 3 2.78 5.63 6.22.9-4.5 4.38 1.06 6.19L12 17.18 6.44 20.1 7.5 13.9 3 9.53l6.22-.9L12 3Z"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function ActivityGlyph({type}:{type:string}){
  const isPositive=type==="buy"||type==="deposit";
  const icon=type==="buy"||type==="sell"
    ?<AppIcon name="trade" size={16}/>
    :type==="deposit"
      ?<ProductIcon name="deposit" size={16}/>
      :type==="withdraw"
        ?<ProductIcon name="withdraw" size={16}/>
        :<ProductIcon name="sparkle" size={16}/>;
  return <span className={`activity-glyph ${isPositive?"positive":"negative"}`}>{icon}</span>;
}
