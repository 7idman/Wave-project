import type { Price } from "../types";

export interface CoinMeta { name:string; color:string; symbol:string; }
export type Range = "1H"|"1D"|"1W"|"1M";
export type LandingChartPoint={label:string;value:number};
export type LandingRange="1W"|"1M"|"1Y";

export const COINS:Record<string,CoinMeta>={BTC:{name:"Bitcoin",color:"#F7931A",symbol:"BTC"},ETH:{name:"Ethereum",color:"#627EEA",symbol:"ETH"},SOL:{name:"Solana",color:"#9945FF",symbol:"SOL"},ADA:{name:"Cardano",color:"#0D3B9A",symbol:"ADA"},LINK:{name:"Chainlink",color:"#2A5ADA",symbol:"LINK"}};
export const RANGE_POINTS:Record<Range,number>={"1H":20,"1D":40,"1W":80,"1M":120};
export const RANGE_VOL:Record<Range,number>={"1H":.003,"1D":.008,"1W":.018,"1M":.035};
export const FB_PRICES:Record<string,Price>={BTC:{price:67420.50,change24h:2.34},ETH:{price:3521.80,change24h:-1.12},SOL:{price:178.40,change24h:5.67},ADA:{price:0.612,change24h:-0.45},LINK:{price:18.92,change24h:3.21}};
export const LANDING_CHARTS:Record<LandingRange,LandingChartPoint[]>={"1W":[{label:"Mon",value:23120},{label:"Tue",value:23280},{label:"Wed",value:23090},{label:"Thu",value:23740},{label:"Fri",value:23980},{label:"Sat",value:23860},{label:"Sun",value:24180}],"1M":[{label:"Week 1",value:21580},{label:"Week 1",value:21840},{label:"Week 2",value:21730},{label:"Week 2",value:22260},{label:"Week 3",value:22120},{label:"Week 3",value:22940},{label:"Week 4",value:22820},{label:"Today",value:24850}],"1Y":[{label:"Jan",value:16200},{label:"Feb",value:17100},{label:"Mar",value:16840},{label:"Apr",value:18520},{label:"May",value:19430},{label:"Jun",value:18990},{label:"Jul",value:20760},{label:"Aug",value:21520},{label:"Sep",value:21140},{label:"Oct",value:22910},{label:"Nov",value:23880},{label:"Dec",value:24850}]};
export const LANDING_META:Record<LandingRange,string>={"1W":"+2.14% this week","1M":"+3.82% this month","1Y":"+53.40% this year"};
export const COIN_STATS:Record<string,{cap:string;vol:string;supply:string}>={BTC:{cap:"$1.32T",vol:"$48.2B",supply:"19.7M"},ETH:{cap:"$423B",vol:"$22.1B",supply:"120.2M"},SOL:{cap:"$82B",vol:"$5.4B",supply:"445M"},ADA:{cap:"$22B",vol:"$1.1B",supply:"35.2B"},LINK:{cap:"$11B",vol:"$720M",supply:"587M"}};
export const COIN_DETAILS:Record<string,{about:string;rank:string;ath:string}>={BTC:{about:"The original decentralized digital asset, designed for secure peer-to-peer value transfer.",rank:"#1",ath:"$73,737"},ETH:{about:"A programmable blockchain powering decentralized apps, digital assets, and smart contracts.",rank:"#2",ath:"$4,878"},SOL:{about:"A high-performance blockchain built for fast, low-cost applications and digital markets.",rank:"#5",ath:"$260"},ADA:{about:"A research-led blockchain focused on scalable, secure, and sustainable financial infrastructure.",rank:"#10",ath:"$3.10"},LINK:{about:"A decentralized oracle network that connects smart contracts with real-world data.",rank:"#15",ath:"$52.88"}};
