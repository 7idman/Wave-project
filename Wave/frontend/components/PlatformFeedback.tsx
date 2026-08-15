import type { ReactNode } from "react";

export function PanelLoading({rows=3,label="Loading content",className=""}:{rows?:number;label?:string;className?:string}){
  return <div className={`panel-loading ${className}`} role="status" aria-label={label}>
    <span className="sr-only">{label}</span>
    {Array.from({length:rows},(_,index)=><div className="panel-loading-row" key={index}>
      <span className="panel-loading-avatar"/>
      <span className="panel-loading-lines"><i/><i/><i/></span>
    </div>)}
  </div>;
}

export function BusyText({children}:{children:ReactNode}){
  return <><span className="btn-spinner"/>{children}</>;
}
