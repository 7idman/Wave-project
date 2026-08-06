const router=require("express").Router();
const { queryOne, queryAll, execute }=require("../db");
const { requirePermission, requireOwner }=require("../middleware/auth");
const { notifyAdmins, configured, notifyUserPush }=require("../services/push");
const { valuePortfolio }=require("../services/portfolioValuation");
const slug=s=>String(s||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,40)||"role";
const parse=v=>{try{return JSON.parse(v||"{}");}catch{return {};}};
// Writes a row the user will see in Notifications > Recent Activity. Reuses
// activity_log (already read by GET /notifications/activity) instead of a new table.
async function notifyUser(userId,type,label){await execute("INSERT INTO activity_log (user_id,type,label,amount) VALUES (?,?,?,0)",[userId,type,label]);}
// Audit trail for admin actions that had nowhere to log a reason (revoke had none;
// ban/reject already partly persisted theirs but weren't in one queryable place).
async function logAdminAction(admin,action,targetUserId,reason){await execute("INSERT INTO admin_actions (admin_id,admin_email,action,target_user_id,reason) VALUES (?,?,?,?,?)",[admin.id,admin.email,action,targetUserId,reason||null]);}
async function applyRequest(r,admin,action,note){if(r.status!=="pending")throw new Error("Request already reviewed");if(action==="approve"){if(r.type==="deposit"){const amt=Number(r.amount||0);await execute("UPDATE users SET cash_balance=cash_balance+?,updated_at=datetime('now') WHERE id=?",[amt,r.user_id]);await execute("INSERT INTO transactions (user_id,type,symbol,amount,price,fee,total,status) VALUES (?,?,?,?,?,?,?,'completed')",[r.user_id,"deposit","USD",amt,1,0,amt]);try{const updated=await queryOne("SELECT cash_balance FROM users WHERE id=?",[r.user_id]);await notifyUserPush(r.user_id,{type:"balance_update",title:"Deposit confirmed",body:`$${amt.toLocaleString()} was added to your balance`,cashBalance:updated.cash_balance});}catch(pushErr){console.error("Deposit approved but balance push failed:",pushErr.message);}}else if(r.type==="kyc"){const p=parse(r.payload);if(p.kind==="id")await execute("UPDATE users SET kyc_id_status='verified',updated_at=datetime('now') WHERE id=?",[r.user_id]);if(p.kind==="address")await execute("UPDATE users SET kyc_addr_status='verified',updated_at=datetime('now') WHERE id=?",[r.user_id]);}else if(r.type==="account_deletion"){await execute("DELETE FROM refresh_tokens WHERE user_id=?",[r.user_id]);await execute("DELETE FROM sessions WHERE user_id=?",[r.user_id]);await execute("DELETE FROM push_subscriptions WHERE user_id=?",[r.user_id]);await execute("DELETE FROM users WHERE id=?",[r.user_id]);}}if(action==="reject")await notifyUser(r.user_id,"request_rejected",`Your ${r.type.replace(/_/g," ")} request was rejected${note?`: ${note}`:""}`);await execute("UPDATE admin_requests SET status=?,reviewed_by=?,reviewed_by_email=?,reviewed_at=datetime('now'),admin_note=? WHERE id=?",[action==="approve"?"approved":"rejected",admin.id,admin.email,note||null,r.id]);}

// ── Strategy trade mirroring ────────────────────────────────────────────
// One admin-logged trade against the strategy's own account gets mirrored,
// proportionally, into every subscriber's own copier portfolio. Proportion
// is (trade $ value) / (strategy account's total value *before* this
// trade) — that ratio then gets applied to each subscriber's own total
// value, so someone who put in $250 and someone who put in $2,500 both see
// the same %, scaled to their own account.
//
// Each subscriber's mirror is applied independently, in its own try/catch —
// one subscriber having an issue (e.g. an edge-case rounding shortfall)
// must never block the others from getting their mirror applied, and must
// never partially apply (guarded atomic UPDATEs mean it's all-or-nothing
// per subscriber, same pattern as buy/sell in trades.js).
async function mirrorStrategyTrade(strategy,trade,admin){
  const subscribers=await queryAll("SELECT id,user_id FROM portfolios WHERE type='copier' AND strategy_id=?",[strategy.id]);
  const results=[];
  for(const sub of subscribers){
    try{
      const before=await valuePortfolio(sub.id);
      if(!before||before.totalValue<=0){results.push({portfolioId:sub.id,skipped:"zero value"});continue;}
      const mirroredDollar=before.totalValue*trade.proportion;
      const mirroredQty=mirroredDollar/trade.price;
      if(trade.side==="buy"){
        const deduct=await execute("UPDATE portfolios SET cash_balance=cash_balance-?,updated_at=datetime('now') WHERE id=? AND cash_balance>=?",[mirroredDollar,sub.id,mirroredDollar]);
        if(deduct.rowsAffected===0){results.push({portfolioId:sub.id,skipped:"insufficient cash"});continue;}
        await execute("INSERT INTO portfolio_holdings (portfolio_id,symbol,amount,updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(portfolio_id,symbol) DO UPDATE SET amount=amount+excluded.amount,updated_at=excluded.updated_at",[sub.id,trade.symbol,mirroredQty]);
      }else{
        const deduct=await execute("UPDATE portfolio_holdings SET amount=amount-?,updated_at=datetime('now') WHERE portfolio_id=? AND symbol=? AND amount>=?",[mirroredQty,sub.id,trade.symbol,mirroredQty]);
        if(deduct.rowsAffected===0){results.push({portfolioId:sub.id,skipped:"insufficient holdings"});continue;}
        await execute("UPDATE portfolios SET cash_balance=cash_balance+?,updated_at=datetime('now') WHERE id=?",[mirroredDollar,sub.id]);
      }
      await execute("INSERT INTO strategy_trade_mirrors (strategy_trade_id,user_id,portfolio_id,mirrored_amount,mirrored_price) VALUES (?,?,?,?,?)",[trade.id,sub.user_id,sub.id,mirroredQty,trade.price]);
      await notifyUser(sub.user_id,"strategy_mirror",`${strategy.name}: ${trade.side==='buy'?'bought':'sold'} ${trade.symbol} mirrored into your copier account`);
      results.push({portfolioId:sub.id,mirroredDollar,mirroredQty});
    }catch(err){
      console.error(`Strategy mirror failed for portfolio ${sub.id}, trade ${trade.id}:`,err.message);
      results.push({portfolioId:sub.id,skipped:"error: "+err.message});
    }
  }
  return results;
}

router.post("/strategies",requirePermission("access_admin"),async(req,res)=>{try{const name=String(req.body.name||"").trim();const description=String(req.body.description||"").trim();const fee=Number(req.body.fee);if(!name||!Number.isFinite(fee)||fee<0)return res.status(400).json({error:"Name and a valid non-negative fee are required"});const portfolio=await execute("INSERT INTO portfolios (user_id,type,cash_balance) VALUES (NULL,'strategy',0)");const portfolioId=portfolio.lastInsertRowid;const strategy=await execute("INSERT INTO strategies (name,description,fee,portfolio_id,status) VALUES (?,?,?,?,'active')",[name,description,fee,portfolioId]);await logAdminAction(req.user,"create_strategy",req.user.id,name);res.status(201).json({message:"Strategy created",strategyId:strategy.lastInsertRowid,portfolioId});}catch(err){res.status(500).json({error:err.message});}});

// Fund the strategy's own trading account so it can actually hold a real
// position (separate from a user's transfer — this is the platform seeding
// its own paper account, e.g. "give Apex Momentum $10,000 to trade with").
router.post("/strategies/:id/fund",requirePermission("access_admin"),async(req,res)=>{try{const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"A positive amount is required"});const strategy=await queryOne("SELECT id,portfolio_id FROM strategies WHERE id=?",[req.params.id]);if(!strategy)return res.status(404).json({error:"Strategy not found"});await execute("UPDATE portfolios SET cash_balance=cash_balance+?,updated_at=datetime('now') WHERE id=?",[amount,strategy.portfolio_id]);await logAdminAction(req.user,"fund_strategy",req.user.id,`$${amount} to strategy ${strategy.id}`);res.json({message:`Funded strategy with $${amount.toLocaleString()}`});}catch(err){res.status(500).json({error:err.message});}});

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

    // Apply the trade to the strategy's OWN account first — same guarded
    // atomic pattern as user buy/sell in trades.js.
    if(side==="buy"){
      const deduct=await execute("UPDATE portfolios SET cash_balance=cash_balance-?,updated_at=datetime('now') WHERE id=? AND cash_balance>=?",[subtotal,strategy.portfolio_id,subtotal]);
      if(deduct.rowsAffected===0)return res.status(400).json({error:"Strategy account has insufficient cash for this trade"});
      await execute("INSERT INTO portfolio_holdings (portfolio_id,symbol,amount,updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(portfolio_id,symbol) DO UPDATE SET amount=amount+excluded.amount,updated_at=excluded.updated_at",[strategy.portfolio_id,symbol,amount]);
    }else{
      const deduct=await execute("UPDATE portfolio_holdings SET amount=amount-?,updated_at=datetime('now') WHERE portfolio_id=? AND symbol=? AND amount>=?",[amount,strategy.portfolio_id,symbol,amount]);
      if(deduct.rowsAffected===0)return res.status(400).json({error:"Strategy account doesn't hold enough of this symbol to sell"});
      await execute("UPDATE portfolios SET cash_balance=cash_balance+?,updated_at=datetime('now') WHERE id=?",[subtotal,strategy.portfolio_id]);
    }

    const inserted=await execute("INSERT INTO strategy_trades (strategy_id,symbol,side,amount,price,admin_id) VALUES (?,?,?,?,?,?)",[strategyId,symbol,side,amount,price,req.user.id]);
    const trade={id:inserted.lastInsertRowid,symbol,side,amount,price,proportion};

    const mirrorResults=await mirrorStrategyTrade(strategy,trade,req.user);
    await logAdminAction(req.user,"log_strategy_trade",req.user.id,`${side} ${amount} ${symbol} on ${strategy.name}`);

    res.status(201).json({
      message:`Logged ${side} ${amount} ${symbol} for ${strategy.name}`,
      tradeId:trade.id,
      proportion,
      mirrored:mirrorResults.length,
      skipped:mirrorResults.filter(r=>r.skipped).length,
      mirrorResults,
    });
  }catch(err){res.status(500).json({error:err.message});}
});

router.get("/strategies",requirePermission("access_admin"),async(req,res)=>{try{const strategies=await queryAll("SELECT id,name,description,fee,portfolio_id,status FROM strategies ORDER BY id DESC");const enriched=[];for(const s of strategies){const value=await valuePortfolio(s.portfolio_id);const subCountRow=await queryOne("SELECT COUNT(*) as c FROM portfolios WHERE type='copier' AND strategy_id=?",[s.id]);enriched.push({id:s.id,name:s.name,description:s.description,fee:s.fee,status:s.status,cashBalance:value?.cashBalance??0,holdingsValue:value?.holdingsValue??0,totalValue:value?.totalValue??0,subscribers:subCountRow.c});}res.json({strategies:enriched});}catch(err){res.status(500).json({error:err.message});}});

router.get("/strategies/:id/trades",requirePermission("access_admin"),async(req,res)=>{try{const trades=await queryAll("SELECT id,symbol,side,amount,price,created_at FROM strategy_trades WHERE strategy_id=? ORDER BY created_at DESC LIMIT 50",[req.params.id]);res.json({trades});}catch(err){res.status(500).json({error:err.message});}});

// ── Managed accounts (admin-set-up, not self-service) ──────────────────
async function getOrCreateManagedPortfolio(userId){
  let portfolio=await queryOne("SELECT id FROM portfolios WHERE user_id=? AND type='managed'",[userId]);
  if(portfolio)return portfolio.id;
  const created=await execute("INSERT INTO portfolios (user_id,type,cash_balance) VALUES (?, 'managed', 0)",[userId]);
  return created.lastInsertRowid;
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
  await execute("UPDATE portfolios SET cash_balance=cash_balance+?,updated_at=datetime('now') WHERE id=?",[amount,portfolioId]);
  await logAdminAction(req.user,"fund_managed_account",targetUser.id,`$${amount} to ${targetUser.email}`);
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
  const deduct=await execute("UPDATE portfolios SET cash_balance=cash_balance-?,updated_at=datetime('now') WHERE id=? AND cash_balance>=?",[cost,portfolioId,cost]);
  if(deduct.rowsAffected===0)return res.status(400).json({error:"Managed account has insufficient cash — fund it first"});
  await execute("INSERT INTO portfolio_holdings (portfolio_id,symbol,amount,updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(portfolio_id,symbol) DO UPDATE SET amount=amount+excluded.amount,updated_at=excluded.updated_at",[portfolioId,symbol,amount]);
  await logAdminAction(req.user,"allocate_managed_account",targetUser.id,`${amount} ${symbol} for ${targetUser.email}`);
  await notifyUser(targetUser.id,"managed_allocation",`Your managed account allocated ${amount} ${symbol}`);
  res.status(201).json({message:`Allocated ${amount} ${symbol} to ${targetUser.email}'s managed account`});
}catch(err){res.status(500).json({error:err.message});}});
router.get("/summary",requirePermission("access_admin"),async(req,res)=>{try{const requests=await queryAll("SELECT * FROM admin_requests ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 100");const roles=(await queryAll("SELECT role_key,name,permissions,is_owner FROM roles ORDER BY is_owner DESC,name")).map(r=>({...r,permissions:parse(r.permissions)}));const adminRoleRows=await queryAll("SELECT role_key FROM roles WHERE is_owner=1 OR permissions LIKE '%\"access_admin\":true%' ORDER BY role_key");const adminRoles=adminRoleRows.map(r=>r.role_key).filter(Boolean);const members=adminRoles.length ? await queryAll(`SELECT id,email,name,avatar_url,role,account_status,created_at FROM users WHERE role IN (${adminRoles.map(()=>"?").join(",")}) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at DESC LIMIT 200`, adminRoles) : [];const updates=await queryAll("SELECT id,title,body,created_at FROM site_updates ORDER BY created_at DESC LIMIT 20");const violations=await queryAll(`SELECT u.id,u.email,u.name,u.account_status,'Multiple rejected admin requests' AS reason,'medium' AS severity FROM users u JOIN admin_requests ar ON ar.user_id=u.id AND ar.status='rejected' GROUP BY u.id HAVING COUNT(ar.id)>=3 UNION ALL SELECT id,email,name,account_status,COALESCE(ban_reason,'Account is terminated') AS reason,'high' AS severity FROM users WHERE account_status='banned'`);res.json({requests,roles,members,updates,violations});}catch(err){res.status(500).json({error:err.message});}});
router.get("/users/search",requirePermission("access_admin"),async(req,res)=>{try{const q=String(req.query.q||"").trim();if(!q)return res.json({users:[]});const like=`%${q}%`;const users=await queryAll("SELECT id,email,name,avatar_url,phone,role,account_status,created_at FROM users WHERE email LIKE ? OR name LIKE ? OR phone LIKE ? ORDER BY created_at DESC LIMIT 25",[like,like,like]);res.json({users});}catch(err){res.status(500).json({error:err.message});}});
router.patch("/requests/:id",requirePermission("manage_requests"),async(req,res)=>{try{const action=req.body.action;if(!["approve","reject"].includes(action))return res.status(400).json({error:"Action must be approve or reject"});const r=await queryOne("SELECT * FROM admin_requests WHERE id=?",[req.params.id]);if(!r)return res.status(404).json({error:"Request not found"});await applyRequest(r,req.user,action,req.body.note);res.json({message:`Request ${action}d`});}catch(err){res.status(500).json({error:err.message});}});
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

module.exports=router;
