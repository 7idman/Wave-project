const { queryAll, execute } = require("../db");
let webpush=null;try{webpush=require("web-push");}catch{webpush=null;}
function configured(){return Boolean(webpush&&process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY);}
function setup(){if(configured())webpush.setVapidDetails(process.env.VAPID_SUBJECT||"mailto:admin@example.com",process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);}
async function notifyAdmins(payload){if(!configured())return {sent:0,disabled:true};setup();const rows=await queryAll(`SELECT ps.id, ps.subscription_json FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id LEFT JOIN roles r ON r.role_key=u.role WHERE u.account_status='active' AND (u.role='owner' OR json_extract(r.permissions,'$.access_admin')=1)`);let sent=0;for(const row of rows){try{await webpush.sendNotification(JSON.parse(row.subscription_json),JSON.stringify(payload));sent++;}catch(err){if(err.statusCode===404||err.statusCode===410)await execute("DELETE FROM push_subscriptions WHERE id=?",[row.id]);}}return {sent};}
module.exports={configured,notifyAdmins};
