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

export function EmptyState({title,description,compact=false,children}:{title:string;description:string;compact?:boolean;children?:ReactNode}){
  return <div className={`empty-state ${compact?"is-compact":""}`} role="status">
    <span className="empty-state-icon" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5z"/><path d="M8 12h8"/><path d="M12 9v6"/></svg>
    </span>
    <div className="empty-state-copy"><strong>{title}</strong><span>{description}</span></div>
    {children&&<div className="empty-state-action">{children}</div>}
  </div>;
}
