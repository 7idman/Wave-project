const API_BASE = import.meta.env.VITE_API_URL || "/api";
let accessToken: string | null = localStorage.getItem("wave_access");
let refreshToken: string | null = localStorage.getItem("wave_refresh");
let refreshInFlight: Promise<boolean> | null = null;
const REQUEST_TIMEOUT_MS=15000;

type ApiError = Error & { code?: string; status?: number };

const clearStoredTokens=()=>{
  accessToken=null;
  refreshToken=null;
  localStorage.removeItem("wave_access");
  localStorage.removeItem("wave_refresh");
};

const makeError=(message:string,code?:string,status?:number):ApiError=>{
  const error=new Error(message) as ApiError;
  error.code=code;
  error.status=status;
  return error;
};

const fetchWithDeadline=async(url:string,opts:RequestInit={}):Promise<Response>=>{
  const controller=new AbortController();
  const callerSignal=opts.signal;
  const forwardAbort=()=>controller.abort();
  if(callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener("abort",forwardAbort,{once:true});
  const timeout=window.setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    return await fetch(url,{...opts,signal:controller.signal});
  }catch(error){
    if(controller.signal.aborted&&!callerSignal?.aborted){
      throw makeError("Wave is taking longer than expected. Please try again.","REQUEST_TIMEOUT");
    }
    throw error;
  }finally{
    window.clearTimeout(timeout);
    callerSignal?.removeEventListener("abort",forwardAbort);
  }
};

// Proxies and infrastructure failures do not always return JSON. Reading the
// response as text first keeps an HTML error page or an empty 204 from masking
// the useful status with an "Unexpected token" parsing exception.
const readResponse=async(response:Response):Promise<any>=>{
  const text=await response.text();
  if(!text) return {};
  try{return JSON.parse(text);}catch{
    if(response.ok) return {data:text};
    const message=response.status>=500
      ?"Wave is temporarily unavailable. Please try again shortly."
      :response.statusText||`Request failed (${response.status})`;
    return {error:message,code:"INVALID_SERVER_RESPONSE"};
  }
};

const expireSession=(message="Your session has expired. Please sign in again.")=>{
  clearStoredTokens();
  window.dispatchEvent(new CustomEvent("wave:session-expired",{detail:{message}}));
};

// Several dashboard panels can receive 401 at the same time. They must share
// one refresh request so future token rotation cannot create a refresh race.
const refreshAccessToken=():Promise<boolean>=>{
  if(refreshInFlight) return refreshInFlight;
  const token=refreshToken;
  if(!token) return Promise.resolve(false);

  refreshInFlight=(async()=>{
    try{
      const response=await fetchWithDeadline(`${API_BASE}/auth/refresh`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({refreshToken:token}),
        credentials:"include",
      });
      const data=await readResponse(response);
      if(response.ok&&typeof data.accessToken==="string"&&data.accessToken){
        accessToken=data.accessToken;
        localStorage.setItem("wave_access",data.accessToken);
        return true;
      }
      if(response.status===400||response.status===401||response.status===403){
        expireSession(data.error||"Your session has expired. Please sign in again.");
      }
      return false;
    }catch(error){
      if((error as ApiError)?.code==="REQUEST_TIMEOUT") throw error;
      // Preserve the session during a transient network outage. A later
      // request can refresh successfully once connectivity returns.
      return false;
    }finally{
      refreshInFlight=null;
    }
  })();
  return refreshInFlight;
};

const request = async (path: string, opts: RequestInit = {}): Promise<any> => {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as Record<string,string> || {}) };
  if(accessToken) headers.Authorization=`Bearer ${accessToken}`;

  let response:Response;
  try{
    response=await fetchWithDeadline(`${API_BASE}${path}`,{...opts,headers,credentials:"include"});
  }catch(error){
    if((error as ApiError)?.code==="REQUEST_TIMEOUT") throw error;
    throw makeError("Unable to reach Wave. Check your connection and try again.","NETWORK_ERROR");
  }

  if(response.status===401&&refreshToken){
    const refreshed=await refreshAccessToken();
    if(refreshed&&accessToken){
      headers.Authorization=`Bearer ${accessToken}`;
      try{
        response=await fetchWithDeadline(`${API_BASE}${path}`,{...opts,headers,credentials:"include"});
      }catch(error){
        if((error as ApiError)?.code==="REQUEST_TIMEOUT") throw error;
        throw makeError("Unable to reach Wave. Check your connection and try again.","NETWORK_ERROR");
      }
    }
  }

  const data=await readResponse(response);
  if(response.status===403&&data.code==="ACCOUNT_TERMINATED"){
    clearStoredTokens();
    window.dispatchEvent(new CustomEvent("wave:account-terminated",{detail:{message:data.error}}));
  }
  if(!response.ok) throw makeError(data.error||"Something went wrong",data.code,response.status);
  return data;
};

export const api={
  hasAccessToken:()=>Boolean(accessToken),
  getRefreshToken:()=>refreshToken,
  setTokens:(access:string,refresh:string)=>{
    accessToken=access;
    refreshToken=refresh;
    localStorage.setItem("wave_access",access);
    localStorage.setItem("wave_refresh",refresh);
  },
  clearTokens:clearStoredTokens,
  request,
  get:(path:string)=>request(path),
  post:(path:string,body:any)=>request(path,{method:"POST",body:JSON.stringify(body)}),
  patch:(path:string,body:any)=>request(path,{method:"PATCH",body:JSON.stringify(body)}),
  delete:(path:string,body:any)=>request(path,{method:"DELETE",body:JSON.stringify(body)}),
};
