const { queryOne, execute } = require("../db");
const { notifyAdmins } = require("./push");
async function createAdminRequest({userId,type,title,details=null,amount=null,payload={}}){const user=await queryOne("SELECT id,email,name FROM users WHERE id=?",[userId]);if(!user)throw new Error("User not found");const r=await execute("INSERT INTO admin_requests (user_id,user_email,user_name,type,title,details,amount,payload) VALUES (?,?,?,?,?,?,?,?)",[user.id,user.email,user.name,type,title,details,amount,JSON.stringify(payload||{})]);await notifyAdmins({title:"New admin request",body:`${user.name} requested ${title}`,url:"/"});return {id:r.lastInsertRowid};}
module.exports={createAdminRequest};
