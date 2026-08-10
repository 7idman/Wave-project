const API_BASE = import.meta.env.VITE_API_URL || "/api";
let accessToken: string | null = localStorage.getItem("wave_access");
let refreshToken: string | null = localStorage.getItem("wave_refresh");

const request = async (path: string, opts: RequestInit = {}): Promise<any> => {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as Record<string,string> || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let response = await fetch(`${API_BASE}${path}`, { ...opts, headers, credentials: "include" });
  if (response.status === 401 && refreshToken) {
    const refreshed = await fetch(`${API_BASE}/auth/refresh`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({refreshToken}), credentials: "include" });
    if (refreshed.ok) { const data=await refreshed.json(); accessToken=data.accessToken; headers.Authorization=`Bearer ${accessToken}`; response=await fetch(`${API_BASE}${path}`,{...opts,headers,credentials:"include"}); }
  }
  const data=await response.json();
  if (response.status === 403 && data.code === "ACCOUNT_TERMINATED") {
    accessToken=null;refreshToken=null;localStorage.removeItem("wave_access");localStorage.removeItem("wave_refresh");
    window.dispatchEvent(new CustomEvent("wave:account-terminated",{detail:{message:data.error}}));
  }
  if (!response.ok) { const err:any = new Error(data.error || "Something went wrong"); err.code = data.code; throw err; }
  return data;
};

export const api={
  hasAccessToken:()=>Boolean(accessToken),
  getRefreshToken:()=>refreshToken,
  setTokens:(access:string,refresh:string)=>{accessToken=access;refreshToken=refresh;localStorage.setItem("wave_access",access);localStorage.setItem("wave_refresh",refresh);},
  clearTokens:()=>{accessToken=null;refreshToken=null;localStorage.removeItem("wave_access");localStorage.removeItem("wave_refresh");},
  request,
  get:(path:string)=>request(path), post:(path:string,body:any)=>request(path,{method:"POST",body:JSON.stringify(body)}), patch:(path:string,body:any)=>request(path,{method:"PATCH",body:JSON.stringify(body)}), delete:(path:string,body:any)=>request(path,{method:"DELETE",body:JSON.stringify(body)}),
};
