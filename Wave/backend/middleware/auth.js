const jwt=require("jsonwebtoken");
const crypto=require("crypto");
const { queryOne, execute }=require("../db");
const JWT_SECRET=process.env.JWT_SECRET||"wave_jwt_secret_change_in_prod";
const TERMINATED_MESSAGE="You have violated our terms and conditions and your account is terminated";
const signAccessToken=(userId,sessionId=null)=>jwt.sign({sub:userId,sid:sessionId},JWT_SECRET,{expiresIn:"15m"});
const signRefreshToken=async(userId,sessionId=null)=>{const token=jwt.sign({sub:userId,type:"refresh",jti:crypto.randomUUID()},JWT_SECRET,{expiresIn:"7d"});const expires=new Date(Date.now()+7*24*60*60*1000).toISOString();await execute("INSERT INTO refresh_tokens (user_id, token, expires_at, session_id) VALUES (?, ?, ?, ?)",[userId,token,expires,sessionId]);return token;};
async function perms(role){const row=await queryOne("SELECT permissions,is_owner FROM roles WHERE role_key=?",[role||"user"]);if(!row)return {};if(row.is_owner)return {access_admin:true,manage_requests:true,manage_roles:true,manage_members:true,manage_announcements:true,ban_users:true};try{return JSON.parse(row.permissions||"{}");}catch{return {};}}
const authenticate=async(req,res,next)=>{const header=req.headers.authorization;if(!header?.startsWith("Bearer "))return res.status(401).json({error:"Missing token"});try{const payload=jwt.verify(header.slice(7),JWT_SECRET);const user=await queryOne("SELECT * FROM users WHERE id=?",[payload.sub]);if(!user)return res.status(401).json({error:"User not found"});if(user.account_status==="banned"){await execute("DELETE FROM refresh_tokens WHERE user_id=?",[user.id]);return res.status(403).json({error:user.ban_reason||TERMINATED_MESSAGE,code:"ACCOUNT_TERMINATED"});}if(payload.sid!=null){const active=await queryOne("SELECT id FROM sessions WHERE id=? AND user_id=? AND logout_at IS NULL",[payload.sid,user.id]);if(!active)return res.status(401).json({error:"Session has ended"});}req.user=user;req.sessionId=payload.sid??null;req.permissions=await perms(user.role);next();}catch{return res.status(401).json({error:"Invalid or expired token"});}};
const requirePermission=perm=>(req,res,next)=>req.user?.role==="owner"||req.permissions?.[perm]?next():res.status(403).json({error:"Admin permission required"});
const requireOwner=(req,res,next)=>req.user?.role==="owner"?next():res.status(403).json({error:"Owner permission required"});
const requireAdmin=requirePermission("access_admin");
module.exports={authenticate,signAccessToken,signRefreshToken,JWT_SECRET,requirePermission,requireOwner,requireAdmin,TERMINATED_MESSAGE};
