const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const ENV_FILE = path.join(ROOT, ".env");

function loadEnv() {
  const env = {};
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return env;
}
const ENV = loadEnv();
const PORT = Number(process.env.PORT || ENV.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_USER = process.env.ADMIN_USERNAME || ENV.ADMIN_USERNAME || "admin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || ENV.ADMIN_PASSWORD || "MTAG-Admin-2026";

function readJson(name, fallback=[]) {
  const p = path.join(DATA, name);
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}
function writeJson(name, data) {
  fs.writeFileSync(path.join(DATA, name), JSON.stringify(data, null, 2), "utf8");
}
function audit(action, username, licenseNumber="") {
  const logs = readJson("audit.json");
  logs.unshift({ id: crypto.randomUUID(), action, username, licenseNumber, timestamp: new Date().toISOString() });
  writeJson("audit.json", logs.slice(0, 2000));
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k,v] = part.trim().split("=");
    if (k && v) out[k] = decodeURIComponent(v);
  }
  return out;
}
const sessions = new Map();

function isAdmin(req) {
  const sid = cookies(req).mtag_session;
  return !!(sid && sessions.has(sid));
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {"Content-Type":"application/json; charset=utf-8"});
  res.end(body);
}
function body(req) {
  return new Promise((resolve,reject)=>{
    let raw="";
    req.on("data", c=>{ raw += c; if(raw.length > 1e6) req.destroy(); });
    req.on("end", ()=>{ try { resolve(raw ? JSON.parse(raw) : {}); } catch(e){ reject(e); }});
    req.on("error",reject);
  });
}
function clean(v, max=200) {
  return String(v ?? "").trim().slice(0,max);
}
function nextLicenseNumber() {
  const licenses = readJson("licenses.json");
  let n = 500000;
  for (const l of licenses) {
    const m = String(l.licenseNumber || "").match(/^077\.(\d{6})\.MTAG$/);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  if (n > 599999) n = 500000;
  let candidate = `077.${String(n).padStart(6,"0")}.MTAG`;
  while (licenses.some(l=>l.licenseNumber===candidate)) {
    n++;
    if (n > 999999) throw new Error("License number space exhausted");
    candidate = `077.${String(n).padStart(6,"0")}.MTAG`;
  }
  return candidate;
}
async function discordNotify(license) {
  const hook = ENV.DISCORD_LICENSE_WEBHOOK_URL;
  if (!hook) return {ok:false, skipped:true};
  const embed = {
    title: "🛫 MTAG | ترخيص جديد",
    description: "تم إصدار ترخيص جديد وتسجيله في سجلات منظومة الطيران العالمي.",
    fields: [
      {name:"رقم الترخيص", value:license.licenseNumber, inline:true},
      {name:"اسم المالك", value:license.holder || "—", inline:true},
      {name:"الشركة / المنظمة", value:license.company || "—", inline:true},
      {name:"نوع الترخيص", value:license.licenseType || "—", inline:true},
      {name:"الفئة", value:license.category || "—", inline:true},
      {name:"تاريخ الإصدار", value:license.issueDate || "—", inline:true},
      {name:"تاريخ الانتهاء", value:license.expirationDate || "—", inline:true},
      {name:"الحالة", value:"🟢 ساري", inline:true},
      {name:"صدر بواسطة", value:license.issuedBy || "—", inline:true}
    ],
    footer:{text:"MTAG | منظومة الطيران العالمي • منظمة خيالية تابعة لروبلكس لا تمثل الواقع ولا تمت له بصلة."},
    timestamp:new Date().toISOString()
  };
  try {
    const r = await fetch(hook, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:"MTAG License System", embeds:[embed]})
    });
    return {ok:r.ok, status:r.status};
  } catch (e) {
    console.error("Discord webhook error:", e.message);
    return {ok:false, error:e.message};
  }
}
function mime(p) {
  return {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml",".json":"application/json"}[path.extname(p)] || "application/octet-stream";
}

const server = http.createServer(async (req,res)=>{
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "POST" && u.pathname === "/api/login") {
      const b = await body(req);
      if (b.username === ADMIN_USER && b.password === ADMIN_PASS) {
        const sid = crypto.randomBytes(32).toString("hex");
        sessions.set(sid, {username:ADMIN_USER, created:Date.now()});
        res.writeHead(200, {"Content-Type":"application/json","Set-Cookie":`mtag_session=${sid}; HttpOnly; SameSite=Lax; Path=/`});
        return res.end(JSON.stringify({ok:true}));
      }
      return json(res,401,{ok:false,error:"بيانات الدخول غير صحيحة"});
    }
    if (req.method === "POST" && u.pathname === "/api/logout") {
      const sid=cookies(req).mtag_session; if(sid) sessions.delete(sid);
      res.writeHead(200, {"Set-Cookie":"mtag_session=; Max-Age=0; Path=/","Content-Type":"application/json"});
      return res.end(JSON.stringify({ok:true}));
    }
    if (req.method === "GET" && u.pathname === "/api/me") {
      return json(res,200,{authenticated:isAdmin(req)});
    }
    if (req.method === "GET" && u.pathname === "/api/licenses") {
      const q=clean(u.searchParams.get("q"),100).toLowerCase();
      const licenses=readJson("licenses.json");
      if (!isAdmin(req)) {
        const found=licenses.find(l=>l.licenseNumber.toLowerCase()===q);
        if(!found) return json(res,404,{ok:false,error:"لم يتم العثور على هذا الترخيص في سجلات MTAG."});
        return json(res,200,{ok:true,license:found});
      }
      const filtered=q ? licenses.filter(l=>JSON.stringify(l).toLowerCase().includes(q)) : licenses;
      return json(res,200,{ok:true,licenses:filtered});
    }
    if (req.method === "POST" && u.pathname === "/api/licenses") {
      if(!isAdmin(req)) return json(res,403,{ok:false,error:"غير مصرح"});
      const b=await body(req);
      const license={
        licenseNumber:nextLicenseNumber(),
        holder:clean(b.holder),
        company:clean(b.company),
        licenseType:clean(b.licenseType),
        category:clean(b.category),
        aircraft:clean(b.aircraft),
        issueDate:clean(b.issueDate,30) || new Date().toISOString().slice(0,10),
        expirationDate:clean(b.expirationDate,30),
        status:"Active",
        issuedBy:ADMIN_USER,
        createdAt:new Date().toISOString(),
        updatedAt:new Date().toISOString()
      };
      if(!license.holder || !license.company || !license.licenseType) return json(res,400,{ok:false,error:"الاسم والشركة ونوع الترخيص مطلوبة."});
      const licenses=readJson("licenses.json");
      if(licenses.some(x=>x.licenseNumber===license.licenseNumber)) return json(res,409,{ok:false,error:"رقم الترخيص مكرر."});
      licenses.unshift(license); writeJson("licenses.json",licenses);
      audit("License created",ADMIN_USER,license.licenseNumber);
      const discord=await discordNotify(license);
      return json(res,201,{ok:true,license,discord});
    }
    if (req.method === "PATCH" && u.pathname.startsWith("/api/licenses/")) {
      if(!isAdmin(req)) return json(res,403,{ok:false,error:"غير مصرح"});
      const num=decodeURIComponent(u.pathname.split("/").pop());
      const b=await body(req);
      const licenses=readJson("licenses.json");
      const i=licenses.findIndex(l=>l.licenseNumber===num);
      if(i<0) return json(res,404,{ok:false,error:"الترخيص غير موجود"});
      const allowed=["Active","Expired","Suspended","Revoked"];
      if(b.status && allowed.includes(b.status)) licenses[i].status=b.status;
      licenses[i].updatedAt=new Date().toISOString();
      writeJson("licenses.json",licenses);
      audit(`License status changed to ${licenses[i].status}`,ADMIN_USER,num);
      return json(res,200,{ok:true,license:licenses[i]});
    }
    if (req.method === "GET" && u.pathname === "/api/stats") {
      if(!isAdmin(req)) return json(res,403,{ok:false,error:"غير مصرح"});
      const ls=readJson("licenses.json");
      const stats={total:ls.length,active:ls.filter(x=>x.status==="Active").length,expired:ls.filter(x=>x.status==="Expired").length,suspended:ls.filter(x=>x.status==="Suspended").length,revoked:ls.filter(x=>x.status==="Revoked").length};
      return json(res,200,stats);
    }
    if (req.method === "GET" && u.pathname === "/api/audit") {
      if(!isAdmin(req)) return json(res,403,{ok:false,error:"غير مصرح"});
      return json(res,200,{logs:readJson("audit.json")});
    }
    if (req.method === "GET") {
      let file = u.pathname === "/" ? "index.html" : u.pathname.slice(1);
      if (file === "admin") file="admin.html";
      const safe=path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
      const fp=path.join(PUBLIC,safe);
      if(fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        res.writeHead(200,{"Content-Type":mime(fp)}); return res.end(fs.readFileSync(fp));
      }
      res.writeHead(404,{"Content-Type":"text/html; charset=utf-8"}); return res.end("404");
    }
  } catch(e) {
    console.error(e);
    return json(res,500,{ok:false,error:"حدث خطأ داخلي في الخادم"});
  }
});
server.listen(PORT, HOST, () => console.log(`MTAG running at http://${HOST}:${PORT}`));
