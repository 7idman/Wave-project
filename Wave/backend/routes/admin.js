const router=require("express").Router();
const { queryOne, queryAll, execute, withTransaction }=require("../db");
const { requirePermission, requireOwner }=require("../middleware/auth");
const { notifyAdmins, configured, notifyUserPush }=require("../services/push");
const { valuePortfolio }=require("../services/portfolioValuation");
const { checkReferralBonus }=require("../services/referrals");
const { applyDepositBonus }=require("../services/promotions");
const {
  enqueueStrategyMirrorJobs,
  processStrategyMirrorJobsForTrade,
  retryStrategyMirrorJob,
  listStrategyMirrorJobs,
}=require("../services/strategyMirroring");
const { generateReferenceId }=require("../utils/referenceId");
const slug=s=>String(s||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,40)||"role";
const parse=v=>{try{return JSON.parse(v||"{}");}catch{return {};}};
// Writes a row the user will see in Notifications > Recent Activity. Reuses
// activity_log (already read by GET /notifications/activity) instead of a new table.
async function notifyUser(userId,type,label){await execute("INSERT INTO activity_log (user_id,type,label,amount) VALUES (?,?,?,0)",[userId,type,label]);}
// Audit trail for admin actions that had nowhere to log a reason (revoke had none;
// ban/reject already partly persisted theirs but weren't in one queryable place).
async function logAdminAction(admin,action,targetUserId,reason){await execute("INSERT INTO admin_actions (admin_id,admin_email,action,target_user_id,reason) VALUES (?,?,?,?,?)",[admin.id,admin.email,action,targetUserId,reason||null]);}
function requestError(message,status=409){const error=new Error(message);error.status=status;return error;}
async function applyRequest(r,admin,action,note){
  const postCommit=await withTransaction(async tx=>{
    const claim=await tx.execute("UPDATE admin_requests SET status='processing' WHERE id=? AND status='pending'",[r.id]);
    if(claim.rowsAffected===0)throw requestError("Request already reviewed");

    let result=null;
    if(action==="approve"){
      if(r.type==="deposit"){
        const amount=Number(r.amount||0);
        if(!Number.isFinite(amount)||amount<=0)throw requestError("Deposit request has an invalid amount",400);
        const credited=await tx.execute("UPDATE users SET cash_balance=cash_balance+?,updated_at=datetime('now') WHERE id=?",[amount,r.user_id]);
        if(credited.rowsAffected===0)throw requestError("Deposit user no longer exists",404);
        const inserted=await tx.execute("INSERT INTO transactions (user_id,type,symbol,amount,price,fee,total,status,reference_id) VALUES (?,?,?,?,?,?,?,'completed',?)",[r.user_id,"deposit","USD",amount,1,0,amount,generateReferenceId("DEP")]);
        const user=await tx.queryOne("SELECT cash_balance FROM users WHERE id=?",[r.user_id]);
        result={type:"deposit",amount,transactionId:inserted.lastInsertRowid,cashBalance:user.cash_balance};
      }else if(r.type==="withdraw"){
        const payload=parse(r.payload);
        const transaction=await tx.queryOne("SELECT id FROM transactions WHERE id=? AND status='awaiting_review'",[payload.transactionId]);
        if(!transaction)throw requestError("This withdrawal is no longer awaiting review — it may have already been processed.");
        const deducted=await tx.execute(`UPDATE users SET cash_balance=cash_balance-?,updated_at=datetime('now') WHERE id=? AND cash_balance>=? AND (cash_balance-(SELECT COALESCE(SUM(amount),0) FROM bonus_grants WHERE user_id=? AND unlock_at>datetime('now'))-(SELECT COALESCE(SUM(amount),0) FROM referral_bonus_grants WHERE user_id=? AND unlock_at>datetime('now')))>=?`,[payload.total,r.user_id,payload.total,r.user_id,r.user_id,payload.total]);
        if(deducted.rowsAffected===0)throw requestError("Cannot approve — this user no longer has sufficient available balance for this withdrawal.",400);
        const completed=await tx.execute("UPDATE transactions SET status='completed' WHERE id=? AND status='awaiting_review'",[payload.transactionId]);
        if(completed.rowsAffected===0)throw requestError("This withdrawal was processed by another reviewer.");
        const user=await tx.queryOne("SELECT cash_balance FROM users WHERE id=?",[r.user_id]);
        result={type:"withdraw",amount:Number(payload.amount),cashBalance:user.cash_balance};
      }else if(r.type==="kyc"){
        const payload=parse(r.payload);
        if(payload.kind==="id")await tx.execute("UPDATE users SET kyc_id_status='verified',updated_at=datetime('now') WHERE id=?",[r.user_id]);
        if(payload.kind==="address")await tx.execute("UPDATE users SET kyc_addr_status='verified',updated_at=datetime('now') WHERE id=?",[r.user_id]);
      }else if(r.type==="account_deletion"){
        await tx.execute("DELETE FROM refresh_tokens WHERE user_id=?",[r.user_id]);
        await tx.execute("DELETE FROM sessions WHERE user_id=?",[r.user_id]);
        await tx.execute("DELETE FROM push_subscriptions WHERE user_id=?",[r.user_id]);
        await tx.execute("DELETE FROM users WHERE id=?",[r.user_id]);
      }
    }else{
      if(r.type==="withdraw"){
        const payload=parse(r.payload);
        await tx.execute("UPDATE transactions SET status='rejected' WHERE id=? AND status='awaiting_review'",[payload.transactionId]);
      }
      await tx.execute("INSERT INTO activity_log (user_id,type,label,amount) VALUES (?,?,?,0)",[r.user_id,"request_rejected",`Your ${r.type.replace(/_/g," ")} request was rejected${note?`: ${note}`:""}`]);
    }

    if(!(action==="approve"&&r.type==="account_deletion")){
      const reviewed=await tx.execute("UPDATE admin_requests SET status=?,reviewed_by=?,reviewed_by_email=?,reviewed_at=datetime('now'),admin_note=? WHERE id=? AND status='processing'",[action==="approve"?"approved":"rejected",admin.id,admin.email,note||null,r.id]);
      if(reviewed.rowsAffected===0)throw requestError("Request could not be finalized");
    }
    return result;
  });

  if(postCommit?.type==="deposit"){
    try{await notifyUserPush(r.user_id,{type:"balance_update",title:"Deposit confirmed",body:`$${postCommit.amount.toLocaleString()} was added to your balance`,cashBalance:postCommit.cashBalance});}catch(error){console.error("Deposit approved but balance push failed:",error.message);}
    try{await applyDepositBonus(r.user_id,postCommit.amount,postCommit.transactionId);}catch(error){console.error("Deposit bonus check failed (deposit itself still succeeded):",error.message);}
    try{await checkReferralBonus(r.user_id);}catch(error){console.error("Referral bonus check failed (deposit itself still succeeded):",error.message);}
  }else if(postCommit?.type==="withdraw"){
    try{await notifyUserPush(r.user_id,{type:"balance_update",title:"Withdrawal approved",body:`$${postCommit.amount.toLocaleString()} withdrawal approved`,cashBalance:postCommit.cashBalance});}catch(error){console.error("Withdrawal approved but balance push failed:",error.message);}
  }
}

// ── Strategy trade mirroring ────────────────────────────────────────────
// One admin-logged trade against the strategy's own account gets mirrored,
// proportionally, into every subscriber's own copier portfolio. Proportion
// is (trade $ value) / (strategy account's total value *before* this
// trade) — that ratio then gets applied to each subscriber's own total
// value, so someone who put in $250 and someone who put in $2,500 both see
// the same %, scaled to their own account.
//
// The strategy trade writes durable subscriber jobs in the same database
// transaction. services/strategyMirroring.js applies each job atomically and
// resumes pending or stale work after a restart.
router.post("/strategies",requirePermission("access_admin"),async(req,res)=>{try{const name=String(req.body.name||"").trim();const description=String(req.body.description||"").trim();const fee=Number(req.body.fee);if(!name||!Number.isFinite(fee)||fee<0)return res.status(400).json({error:"Name and a valid non-negative fee are required"});const created=await withTransaction(async tx=>{const portfolio=await tx.execute("INSERT INTO portfolios (user_id,type,cash_balance) VALUES (NULL,'strategy',0)");const strategy=await tx.execute("INSERT INTO strategies (name,description,fee,portfolio_id,status) VALUES (?,?,?,?,'active')",[name,description,fee,portfolio.lastInsertRowid]);await tx.execute("INSERT INTO admin_actions (admin_id,admin_email,action,target_user_id,reason) VALUES (?,?,?,?,?)",[req.user.id,req.user.email,"create_strategy",req.user.id,name]);return {strategyId:strategy.lastInsertRowid,portfolioId:portfolio.lastInsertRowid};});res.status(201).json({message:"Strategy created",...created});}catch(err){res.status(500).json({error:err.message});}});

// Fund the strategy's own trading account so it can actually hold a real
// position (separate from a user's transfer — this is the platform seeding
// its own paper account, e.g. "give Apex Momentum $10,000 to trade with").
router.post("/strategies/:id/fund",requirePermission("access_admin"),async(req,res)=>{try{const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"A positive amount is required"});const outcome=await withTransaction(async tx=>{const strategy=await tx.queryOne("SELECT id,portfolio_id FROM strategies WHERE id=?",[req.params.id]);if(!strategy)return {error:"Strategy not found"};await tx.execute("UPDATE portfolios SET cash_balance=cash_balance+?,updated_at=datetime('now') WHERE id=?",[amount,strategy.portfolio_id]);await tx.execute("INSERT INTO admin_actions (admin_id,admin_email,action,target_user_id,reason) VALUES (?,?,?,?,?)",[req.user.id,req.user.email,"fund_strategy",req.user.id,`$${amount} to strategy ${strategy.id}`]);return {};});if(outcome.error)return res.status(404).json({error:outcome.error});res.json({message:`Funded strategy with $${amount.toLocaleString()}`});}catch(err){res.status(500).json({error:err.message});}});

router.post("/strategies/:id/trades",requirePermission("access_admin"),async(req,res)=>{
  try{
    const strategyId=parseInt(req.params.id,10);
    const symbol=String(req.body.symbol||"").toUpperCase().trim();
    const side=String(req.body.side||"").toLowerCase();
    const amount=Number(req.body.amount);
    if(!symbol||!["buy","sell"].includes(side)||!Number.isFinite(amount)||amount<=0)
      return res.status(400).json({error:"symbol, side (buy/sell), and a positive amount are required"});

    const strategy=await queryOne("SELECT id,name,portfolio_id FROM strategies WHERE id=?",[strategyId]);
    if(!strategy)return res.status(404).json({error:"Strategy not found"});

    const priceRow=await queryOne("SELECT price FROM price_cache WHERE symbol=?",[symbol]);
    if(!priceRow)return res.status(404).json({error:`Unknown symbol: ${symbol}`});
    const price=priceRow.price;
    const subtotal=amount*price;

    const before=await valuePortfolio(strategy.portfolio_id);
    if(!before||before.totalValue<=0)
      return res.status(400).json({error:"Fund the strategy's account before logging trades against it"});
    const proportion=subtotal/before.totalValue;

    const outcome=await withTransaction(async tx=>{
      if(side==="buy"){
        const deduct=await tx.execute("UPDATE portfolios SET cash_balance=cash_balance-?,updated_at=datetime('now') WHERE id=? AND cash_balance>=?",[subtotal,strategy.portfolio_id,subtotal]);
        if(deduct.rowsAffected===0)return {error:"Strategy account has insufficient cash for this trade"};
        await tx.execute("INSERT INTO portfolio_holdings (portfolio_id,symbol,amount,updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(portfolio_id,symbol) DO UPDATE SET amount=amount+excluded.amount,updated_at=excluded.updated_at",[strategy.portfolio_id,symbol,amount]);
      }else{
        const deduct=await tx.execute("UPDATE portfolio_holdings SET amount=amount-?,updated_at=datetime('now') WHERE portfolio_id=? AND symbol=? AND amount>=?",[amount,strategy.portfolio_id,symbol,amount]);
        if(deduct.rowsAffected===0)return {error:"Strategy account doesn't hold enough of this symbol to sell"};
        await tx.execute("UPDATE portfolios SET cash_balance=cash_balance+?,updated_at=datetime('now') WHERE id=?",[subtotal,strategy.portfolio_id]);
      }
      const inserted=await tx.execute("INSERT INTO strategy_trades (strategy_id,symbol,side,amount,price,admin_id) VALUES (?,?,?,?,?,?)",[strategyId,symbol,side,amount,price,req.user.id]);
      await tx.execute("INSERT INTO admin_actions (admin_id,admin_email,action,target_user_id,reason) VALUES (?,?,?,?,?)",[req.user.id,req.user.email,"log_strategy_trade",req.user.id,`${side} ${amount} ${symbol} on ${strategy.name}`]);
      const queued=await enqueueStrategyMirrorJobs(tx,{strategyId,tradeId:inserted.lastInsertRowid,proportion});
      return {tradeId:inserted.lastInsertRowid,queued};
    });
    if(outcome.error)return res.status(400).json({error:outcome.error});
    let mirrorResults=[];
    let recoveryScheduled=false;
    try{
      mirrorResults=await processStrategyMirrorJobsForTrade(outcome.tradeId);
    }catch(error){
      // The core trade and jobs are already committed. Report success so an
      // admin retry cannot duplicate the strategy trade; the worker resumes it.
      recoveryScheduled=true;
      console.error(`Immediate strategy mirror processing failed for trade ${outcome.tradeId}:`,error.message);
    }
    res.status(201).json({
      message:`Logged ${side} ${amount} ${symbol} for ${strategy.name}`,
      tradeId:outcome.tradeId,
      proportion,
      queued:outcome.queued,
      mirrored:mirrorResults.filter(result=>result.status==="completed").length,
      skipped:mirrorResults.filter(result=>result.status==="skipped").length,
      recoveryScheduled,
      mirrorResults,
    });
  }catch(err){res.status(500).json({error:err.message});}
});

router.get("/strategies",requirePermission("access_admin"),async(req,res)=>{try{const strategies=await queryAll("SELECT id,name,description,fee,portfolio_id,status FROM strategies ORDER BY id DESC");const enriched=[];for(const s of strategies){const value=await valuePortfolio(s.portfolio_id);const subCountRow=await queryOne("SELECT COUNT(*) as c FROM portfolios WHERE type='copier' AND strategy_id=?",[s.id]);enriched.push({id:s.id,name:s.name,description:s.description,fee:s.fee,status:s.status,cashBalance:value?.cashBalance??0,holdingsValue:value?.holdingsValue??0,totalValue:value?.totalValue??0,subscribers:subCountRow.c});}res.json({strategies:enriched});}catch(err){res.status(500).json({error:err.message});}});

router.get("/strategies/mirror-jobs",requirePermission("access_admin"),async(req,res)=>{try{
  const status=req.query.status?String(req.query.status):null;
  const allowed=["pending","processing","retry","completed","skipped","failed"];
  if(status&&!allowed.includes(status))return res.status(400).json({error:`status must be one of: ${allowed.join(", ")}`});
  const jobs=await listStrategyMirrorJobs({status,limit:req.query.limit});
  res.json({jobs});
}catch(err){res.status(500).json({error:err.message});}});

router.post("/strategies/mirror-jobs/:jobId/retry",requirePermission("access_admin"),async(req,res)=>{try{
  const retried=await retryStrategyMirrorJob(req.params.jobId);
  if(!retried)return res.status(409).json({error:"Only failed or skipped mirror jobs can be retried"});
  res.json({message:"Mirror job queued for retry"});
}catch(err){res.status(500).json({error:err.message});}});

router.get("/strategies/:id/trades",requirePermission("access_admin"),async(req,res)=>{try{const trades=await queryAll("SELECT id,symbol,side,amount,price,created_at FROM strategy_trades WHERE strategy_id=? ORDER BY created_at DESC LIMIT 50",[req.params.id]);res.json({trades});}catch(err){res.status(500).json({error:err.message});}});

// ── Managed accounts (admin-set-up, not self-service) ──────────────────
async function getOrCreateManagedPortfolio(userId){
  return withTransaction(async tx=>{
    const portfolio=await tx.queryOne("SELECT id FROM portfolios WHERE user_id=? AND type='managed'",[userId]);
    if(portfolio)return portfolio.id;
    const created=await tx.execute("INSERT INTO portfolios (user_id,type,cash_balance) VALUES (?, 'managed', 0)",[userId]);
    return created.lastInsertRowid;
  });
}

router.get("/managed",requirePermission("access_admin"),async(req,res)=>{try{
  const rows=await queryAll("SELECT p.id,p.user_id,u.email,u.name,p.created_at FROM portfolios p JOIN users u ON u.id=p.user_id WHERE p.type='managed' ORDER BY p.created_at DESC");
  const enriched=[];
  for(const r of rows){const value=await valuePortfolio(r.id);enriched.push({portfolioId:r.id,userId:r.user_id,email:r.email,name:r.name,cashBalance:value.cashBalance,holdingsValue:value.holdingsValue,totalValue:value.totalValue,createdAt:r.created_at});}
  res.json({accounts:enriched});
}catch(err){res.status(500).json({error:err.message});}});

router.post("/managed/:userId",requirePermission("access_admin"),async(req,res)=>{try{
  const targetUser=await queryOne("SELECT id,email FROM users WHERE id=?",[req.params.userId]);
  if(!targetUser)return res.status(404).json({error:"User not found"});
  const portfolioId=await getOrCreateManagedPortfolio(targetUser.id);
  await logAdminAction(req.user,"create_managed_account",targetUser.id,targetUser.email);
  res.status(201).json({message:`Managed account ready for ${targetUser.email}`,portfolioId});
}catch(err){res.status(500).json({error:err.message});}});

router.post("/managed/:userId/fund",requirePermission("access_admin"),async(req,res)=>{try{
  const amount=Number(req.body.amount);
  if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"A positive amount is required"});
  const targetUser=await queryOne("SELECT id,email FROM users WHERE id=?",[req.params.userId]);
  if(!targetUser)return res.status(404).json({error:"User not found"});
  const portfolioId=await getOrCreateManagedPortfolio(targetUser.id);
  await withTransaction(async tx=>{
    await tx.execute("UPDATE portfolios SET cash_balance=cash_balance+?,updated_at=datetime('now') WHERE id=?",[amount,portfolioId]);
    await tx.execute("INSERT INTO admin_actions (admin_id,admin_email,action,target_user_id,reason) VALUES (?,?,?,?,?)",[req.user.id,req.user.email,"fund_managed_account",targetUser.id,`$${amount} to ${targetUser.email}`]);
  });
  res.json({message:`Added $${amount.toLocaleString()} to ${targetUser.email}'s managed account`});
}catch(err){res.status(500).json({error:err.message});}});

// Allocate real assets into a managed account — same guarded atomic
// deduct-then-hold pattern as strategy trades, just with no mirroring
// (a managed account has no subscribers, it's just that one user's account).
router.post("/managed/:userId/allocate",requirePermission("access_admin"),async(req,res)=>{try{
  const symbol=String(req.body.symbol||"").toUpperCase().trim();
  const amount=Number(req.body.amount);
  if(!symbol||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"symbol and a positive amount are required"});
  const targetUser=await queryOne("SELECT id,email FROM users WHERE id=?",[req.params.userId]);
  if(!targetUser)return res.status(404).json({error:"User not found"});
  const priceRow=await queryOne("SELECT price FROM price_cache WHERE symbol=?",[symbol]);
  if(!priceRow)return res.status(404).json({error:`Unknown symbol: ${symbol}`});
  const portfolioId=await getOrCreateManagedPortfolio(targetUser.id);
  const cost=amount*priceRow.price;
  const outcome=await withTransaction(async tx=>{
    const deduct=await tx.execute("UPDATE portfolios SET cash_balance=cash_balance-?,updated_at=datetime('now') WHERE id=? AND cash_balance>=?",[cost,portfolioId,cost]);
    if(deduct.rowsAffected===0)return {error:"Managed account has insufficient cash — fund it first"};
    await tx.execute("INSERT INTO portfolio_holdings (portfolio_id,symbol,amount,updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(portfolio_id,symbol) DO UPDATE SET amount=amount+excluded.amount,updated_at=excluded.updated_at",[portfolioId,symbol,amount]);
    await tx.execute("INSERT INTO admin_actions (admin_id,admin_email,action,target_user_id,reason) VALUES (?,?,?,?,?)",[req.user.id,req.user.email,"allocate_managed_account",targetUser.id,`${amount} ${symbol} for ${targetUser.email}`]);
    await tx.execute("INSERT INTO activity_log (user_id,type,label,amount) VALUES (?,?,?,0)",[targetUser.id,"managed_allocation",`Your managed account allocated ${amount} ${symbol}`]);
    return {};
  });
  if(outcome.error)return res.status(400).json({error:outcome.error});
  res.status(201).json({message:`Allocated ${amount} ${symbol} to ${targetUser.email}'s managed account`});
}catch(err){res.status(500).json({error:err.message});}});
router.get("/summary",requirePermission("access_admin"),async(req,res)=>{try{const requests=await queryAll("SELECT * FROM admin_requests ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 100");const roles=(await queryAll("SELECT role_key,name,permissions,is_owner FROM roles ORDER BY is_owner DESC,name")).map(r=>({...r,permissions:parse(r.permissions)}));const adminRoleRows=await queryAll("SELECT role_key FROM roles WHERE is_owner=1 OR permissions LIKE '%\"access_admin\":true%' ORDER BY role_key");const adminRoles=adminRoleRows.map(r=>r.role_key).filter(Boolean);const members=adminRoles.length ? await queryAll(`SELECT id,email,name,avatar_url,role,account_status,created_at FROM users WHERE role IN (${adminRoles.map(()=>"?").join(",")}) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at DESC LIMIT 200`, adminRoles) : [];const updates=await queryAll("SELECT id,title,body,created_at FROM site_updates ORDER BY created_at DESC LIMIT 20");const violations=await queryAll(`SELECT u.id,u.email,u.name,u.account_status,'Multiple rejected admin requests' AS reason,'medium' AS severity FROM users u JOIN admin_requests ar ON ar.user_id=u.id AND ar.status='rejected' GROUP BY u.id HAVING COUNT(ar.id)>=3 UNION ALL SELECT id,email,name,account_status,COALESCE(ban_reason,'Account is terminated') AS reason,'high' AS severity FROM users WHERE account_status='banned'`);res.json({requests,roles,members,updates,violations});}catch(err){res.status(500).json({error:err.message});}});
router.get("/users/search",requirePermission("access_admin"),async(req,res)=>{try{const q=String(req.query.q||"").trim();if(!q)return res.json({users:[]});const like=`%${q}%`;const users=await queryAll("SELECT id,email,name,avatar_url,phone,role,account_status,created_at FROM users WHERE email LIKE ? OR name LIKE ? OR phone LIKE ? ORDER BY created_at DESC LIMIT 25",[like,like,like]);res.json({users});}catch(err){res.status(500).json({error:err.message});}});
router.patch("/requests/:id",requirePermission("manage_requests"),async(req,res)=>{try{const action=req.body.action;if(!["approve","reject"].includes(action))return res.status(400).json({error:"Action must be approve or reject"});const r=await queryOne("SELECT * FROM admin_requests WHERE id=?",[req.params.id]);if(!r)return res.status(404).json({error:"Request not found"});await applyRequest(r,req.user,action,req.body.note);res.json({message:`Request ${action}d`});}catch(err){res.status(err.status||500).json({error:err.message});}});
router.post("/announcements",requirePermission("manage_announcements"),async(req,res)=>{try{const title=String(req.body.title||"").trim(),body=String(req.body.body||"").trim();if(!title||!body)return res.status(400).json({error:"Title and body are required"});await execute("INSERT INTO site_updates (title,body) VALUES (?,?)",[title,body]);await notifyAdmins({title:"Platform update",body,url:"/"});res.status(201).json({message:"Announcement posted"});}catch(err){res.status(500).json({error:err.message});}});
router.post("/roles",requireOwner,async(req,res)=>{try{const name=String(req.body.name||"").trim();if(!name)return res.status(400).json({error:"Role name required"});const key=slug(name);await execute("INSERT INTO roles (role_key,name,permissions) VALUES (?,?,?)",[key,name,JSON.stringify(req.body.permissions||{})]);res.status(201).json({message:"Role created",role_key:key});}catch(err){res.status(500).json({error:err.message});}});
router.post("/members",requireOwner,async(req,res)=>{try{const email=String(req.body.email||"").trim().toLowerCase(),role=String(req.body.role||"user");const user=await queryOne("SELECT id,role FROM users WHERE email=?",[email]);if(!user)return res.status(404).json({error:"User must create an account before you can add them"});if(user.role==="owner")return res.status(400).json({error:"Owner role cannot be changed"});const targetRole=await queryOne("SELECT role_key,is_owner FROM roles WHERE role_key=?",[role]);if(!targetRole||targetRole.is_owner)return res.status(400).json({error:"Choose a valid non-owner role"});await execute("UPDATE users SET role=?,updated_at=datetime('now') WHERE id=?",[role,user.id]);res.json({message:"Member role updated"});}catch(err){res.status(500).json({error:err.message});}});
router.patch("/members/:id/role",requireOwner,async(req,res)=>{try{const role=String(req.body.role||"user"),reason=req.body.reason?String(req.body.reason).slice(0,240):null;const user=await queryOne("SELECT role FROM users WHERE id=?",[req.params.id]);if(!user)return res.status(404).json({error:"User not found"});if(user.role==="owner")return res.status(400).json({error:"Owner role cannot be changed"});const targetRole=await queryOne("SELECT role_key,is_owner FROM roles WHERE role_key=?",[role]);if(!targetRole||targetRole.is_owner)return res.status(400).json({error:"Choose a valid non-owner role"});await execute("UPDATE users SET role=?,updated_at=datetime('now') WHERE id=?",[role,req.params.id]);if(role==="user"){await execute("DELETE FROM push_subscriptions WHERE user_id=?",[req.params.id]);await logAdminAction(req.user,"revoke_admin",req.params.id,reason);await notifyUser(req.params.id,"admin_revoked",`Your admin access was revoked${reason?`: ${reason}`:""}`);}res.json({message:"Role updated"});}catch(err){res.status(500).json({error:err.message});}});
router.patch("/members/:id/ban",requireOwner,async(req,res)=>{try{const user=await queryOne("SELECT role FROM users WHERE id=?",[req.params.id]);if(!user)return res.status(404).json({error:"User not found"});if(user.role==="owner")return res.status(400).json({error:"Owner cannot be banned"});const reason=String(req.body.reason||"You have violated our terms and conditions and your account is terminated").slice(0,240);await execute("UPDATE users SET account_status='banned',ban_reason=?,updated_at=datetime('now') WHERE id=?",[reason,req.params.id]);await execute("DELETE FROM refresh_tokens WHERE user_id=?",[req.params.id]);await execute("UPDATE sessions SET logout_at=datetime('now') WHERE user_id=? AND logout_at IS NULL",[req.params.id]);await logAdminAction(req.user,"ban",req.params.id,reason);res.json({message:"User banned"});}catch(err){res.status(500).json({error:err.message});}});
router.patch("/members/:id/restore",requireOwner,async(req,res)=>{try{await execute("UPDATE users SET account_status='active',ban_reason=NULL,updated_at=datetime('now') WHERE id=?",[req.params.id]);await logAdminAction(req.user,"restore",req.params.id,null);res.json({message:"User restored"});}catch(err){res.status(500).json({error:err.message});}});
router.get("/push/config",requirePermission("access_admin"),(req,res)=>res.json({publicKey:process.env.VAPID_PUBLIC_KEY||"",enabled:configured()}));
router.post("/push/subscribe",requirePermission("access_admin"),async(req,res)=>{try{if(!req.body?.endpoint)return res.status(400).json({error:"Invalid push subscription"});await execute("INSERT INTO push_subscriptions (user_id,endpoint,subscription_json) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json,updated_at=datetime('now')",[req.user.id,req.body.endpoint,JSON.stringify(req.body)]);res.status(201).json({message:"Admin Notifications ON"});}catch(err){res.status(500).json({error:err.message});}});
router.delete("/push/subscribe",requirePermission("access_admin"),async(req,res)=>{try{if(!req.body?.endpoint)return res.status(400).json({error:"Invalid push subscription"});await execute("DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?",[req.user.id,req.body.endpoint]);res.json({message:"Admin Notifications Turned Off"});}catch(err){res.status(500).json({error:err.message});}});

// ── Deposit-bonus promotions ────────────────────────────────────────────
router.get("/promotions",requirePermission("access_admin"),async(req,res)=>{try{
  const promotions=await queryAll("SELECT * FROM promotions ORDER BY start_at DESC");
  res.json({promotions});
}catch(err){res.status(500).json({error:err.message});}});

router.post("/promotions",requirePermission("access_admin"),async(req,res)=>{try{
  const name=String(req.body.name||"").trim();
  const bonusPct=Number(req.body.bonusPct);
  const minTier=String(req.body.minTier||"bronze");
  const minDeposit=Number(req.body.minDeposit)||0;
  const lockDays=Number(req.body.lockDays)||0;
  const startAt=String(req.body.startAt||"");
  const endAt=String(req.body.endAt||"");
  if(!name||!Number.isFinite(bonusPct)||bonusPct<=0||bonusPct>1)return res.status(400).json({error:"Name and a bonus % between 0 and 1 (e.g. 0.10 for 10%) are required"});
  if(!["bronze","silver","gold","platinum"].includes(minTier))return res.status(400).json({error:"Invalid minTier"});
  if(!startAt||!endAt||new Date(endAt)<=new Date(startAt))return res.status(400).json({error:"A valid start/end range is required, with end after start"});
  const inserted=await execute("INSERT INTO promotions (name,bonus_pct,min_tier,min_deposit,lock_days,start_at,end_at) VALUES (?,?,?,?,?,?,?)",[name,bonusPct,minTier,minDeposit,lockDays,startAt,endAt]);
  try{await logAdminAction(req.user,"create_promotion",req.user.id,`${name} (${(bonusPct*100).toFixed(0)}%)`);}catch(logErr){console.error("Promotion created but admin-action log failed:",logErr.message);}
  res.status(201).json({message:"Promotion created",promotionId:inserted.lastInsertRowid});
}catch(err){res.status(500).json({error:err.message});}});

router.delete("/promotions/:id",requirePermission("access_admin"),async(req,res)=>{try{
  // "Delete" just ends it immediately rather than removing the row — bonus_grants
  // still reference promotion_id, and past grants should stay explainable.
  await execute("UPDATE promotions SET end_at=datetime('now') WHERE id=?",[req.params.id]);
  try{await logAdminAction(req.user,"end_promotion",req.user.id,`promotion ${req.params.id}`);}catch(logErr){console.error("Promotion ended but admin-action log failed:",logErr.message);}
  res.json({message:"Promotion ended"});
}catch(err){res.status(500).json({error:err.message});}});

router.post("/stocks/refresh",requirePermission("access_admin"),async(req,res)=>{try{
  const { fetchStockQuote, STOCK_SYMBOLS }=require("../services/stocks");
  if(!process.env.FINNHUB_API_KEY)return res.status(400).json({error:"FINNHUB_API_KEY is not set on the server"});
  const results=[];
  for(const symbol of STOCK_SYMBOLS){
    try{const q=await fetchStockQuote(symbol);await execute("INSERT INTO price_cache (symbol,price,change_24h,asset_type,updated_at) VALUES (?,?,?,'stock',datetime('now')) ON CONFLICT(symbol) DO UPDATE SET price=excluded.price,change_24h=excluded.change_24h,asset_type='stock',updated_at=excluded.updated_at",[q.symbol,q.price,q.change24h]);results.push({symbol,ok:true,price:q.price});}
    catch(err){results.push({symbol,ok:false,error:err.message});}
  }
  res.json({results,updated:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length});
}catch(err){res.status(500).json({error:err.message});}});

// ── Monitoring tabs: security events, client crash reports, referrals, auto-invest ──
router.get("/security-events",requirePermission("access_admin"),async(req,res)=>{try{
  const type=String(req.query.type||"").trim();
  const rows=type
    ? await queryAll("SELECT se.*, u.email AS user_email FROM security_events se LEFT JOIN users u ON u.id=se.user_id WHERE se.type=? ORDER BY se.created_at DESC LIMIT 100",[type])
    : await queryAll("SELECT se.*, u.email AS user_email FROM security_events se LEFT JOIN users u ON u.id=se.user_id ORDER BY se.created_at DESC LIMIT 100");
  res.json({events:rows.map(r=>({...r,metadata:parse(r.metadata)}))});
}catch(err){res.status(500).json({error:err.message});}});

router.get("/client-errors",requirePermission("access_admin"),async(req,res)=>{try{
  const rows=await queryAll("SELECT ce.*, u.email AS user_email FROM client_errors ce LEFT JOIN users u ON u.id=ce.user_id ORDER BY ce.created_at DESC LIMIT 100");
  res.json({errors:rows});
}catch(err){res.status(500).json({error:err.message});}});

router.get("/referrals",requirePermission("access_admin"),async(req,res)=>{try{
  const rows=await queryAll(
    `SELECT r.id, r.status, r.threshold_amount, r.completed_at, r.created_at,
            ref.email AS referrer_email, ref.name AS referrer_name,
            ree.email AS referee_email, ree.name AS referee_name
     FROM referrals r
     JOIN users ref ON ref.id=r.referrer_id
     JOIN users ree ON ree.id=r.referee_id
     ORDER BY r.created_at DESC LIMIT 100`
  );
  res.json({referrals:rows});
}catch(err){res.status(500).json({error:err.message});}});

router.get("/auto-invest-plans",requirePermission("access_admin"),async(req,res)=>{try{
  const rows=await queryAll(
    `SELECT aip.*, u.email AS user_email FROM auto_invest_plans aip
     JOIN users u ON u.id=aip.user_id
     ORDER BY aip.created_at DESC LIMIT 100`
  );
  res.json({plans:rows});
}catch(err){res.status(500).json({error:err.message});}});

module.exports=router;
