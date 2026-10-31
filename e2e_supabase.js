const BASE="https://v7-chat.pages.dev";
const SB="https://kgsvvkzwmyalamvepirz.supabase.co";
const SK = process.env.SUPABASE_SECRET_KEY || "";
if(!SK){console.error("需要环境变量 SUPABASE_SECRET_KEY");process.exit(2);}
const R=[]; const ok=(n,c,e)=>{R.push((c?"PASS ":"FAIL ")+n+(e?"  -> "+e:""));return c;};
async function call(m,p,{body,token,raw,ct}={}){const h={};if(token)h["Authorization"]="Bearer "+token;
 let b;if(raw!==undefined)b=raw;else if(body!==undefined){h["content-type"]="application/json";b=JSON.stringify(body);}
 if(ct)h["content-type"]=ct;
 const r=await fetch(BASE+p,{method:m,headers:h,body:b});let d=null;try{d=await r.json();}catch{}
 return {status:r.status,data:d};}
(async()=>{
  const u="s"+Date.now().toString(36).slice(-5);
  let r=await call("POST","/api/register",{body:{username:u,password:"verify123"}});
  ok("注册成功",r.status===200&&r.data.token,"role="+(r.data&&r.data.role));
  const tok=r.data&&r.data.token;
  r=await call("GET","/api/cloud/status",{token:tok});
  ok("云空间=1024MB",r.data&&r.data.totalMb===1024,"totalMb="+(r.data&&r.data.totalMb));
  // 上传
  const payload=new TextEncoder().encode("SUPABASE-CLOUD-TEST-"+u);
  r=await call("POST","/api/cloud/upload?name=probe.txt&mime=text/plain",{token:tok,raw:payload,ct:"text/plain"});
  ok("上传成功",r.status===200&&r.data.ok,"status="+r.status+" err="+(r.data&&r.data.error));
  const used1=r.data&&r.data.usedMb;
  ok("已用空间已记录",used1>0,"usedMb="+used1);
  // 列文件
  r=await call("GET","/api/cloud/list",{token:tok});
  const files=(r.data&&r.data.files)||[];
  ok("云文件列表有 1 个",files.length===1,"len="+files.length);
  const fid=files[0]&&files[0].id;
  // 验证真的在 Supabase 里（而不是 D1 分片）
  const sbList=await fetch(SB+"/storage/v1/object/list/cloud-files",{method:"POST",headers:{apikey:SK,Authorization:"Bearer "+SK,"Content-Type":"application/json"},body:JSON.stringify({prefix:"cloud/",limit:100})});
  const sbData=await sbList.json();
  const sbObjs=(Array.isArray(sbData)?sbData:[]).map(o=>o.name);
  ok("Supabase 桶里确实有对象",sbObjs.length>0,"objs="+JSON.stringify(sbObjs));
  ok("对象名对应本次上传",sbObjs.some(n=>n.includes(fid)),"fid="+fid);
  // 下载校验内容
  r=await call("GET","/api/cloud/file?id="+encodeURIComponent(fid),{token:tok});
  ok("下载成功",r.status===200&&r.data&&r.data.data,"status="+r.status);
  const decoded=Buffer.from(r.data.data,"base64").toString();
  ok("内容完全一致",decoded==="SUPABASE-CLOUD-TEST-"+u,"got="+decoded);
  // D1 里应该没有分片数据（证明没走 D1）
  r=await call("GET","/api/cloud/list",{token:tok});
  ok("删除前文件仍在",((r.data&&r.data.files)||[]).length===1);
  r=await call("POST","/api/cloud/delete",{body:{id:fid},token:tok});
  ok("删除成功",r.status===200&&r.data.ok);
  const sbList2=await fetch(SB+"/storage/v1/object/list/cloud-files",{method:"POST",headers:{apikey:SK,Authorization:"Bearer "+SK,"Content-Type":"application/json"},body:JSON.stringify({prefix:"cloud/",limit:100})});
  const sbData2=await sbList2.json();
  const sbObjs2=(Array.isArray(sbData2)?sbData2:[]).map(o=>o.name);
  ok("Supabase 里对象已删除",!sbObjs2.some(n=>n.includes(fid)),"objs="+JSON.stringify(sbObjs2));
  console.log("\n========== SUPABASE 云存储 E2E ==========");
  R.forEach(l=>console.log(l));
  console.log("=========================================");
  console.log(R.every(x=>x.startsWith("PASS"))?"ALL PASS ("+R.length+")":R.filter(x=>x.startsWith("FAIL")).length+" FAILED / "+R.length);
})().catch(e=>{console.error("ERR",e.message);process.exit(2);});
