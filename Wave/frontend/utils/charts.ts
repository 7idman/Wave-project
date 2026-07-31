export interface ChartPoint { t:number; v:number; }

export const generateChart=(base:number,points:number,volatility:number):ChartPoint[]=>
  Array.from({length:points},(_,index)=>{
    base*=1+(Math.random()-.49)*volatility;
    return {t:index,v:parseFloat(base.toFixed(2))};
  });
