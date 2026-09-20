import { randomId, safeJson } from './crypto.js';
import { awardXP, now } from './db.js';
import { issueCertificate } from './certificates.js';

const textDecoder = new TextDecoder();
const mimeByExt = new Map([
  ['.html','text/html; charset=utf-8'],['.htm','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8'],
  ['.json','application/json'],['.xml','application/xml'],['.svg','image/svg+xml'],['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.gif','image/gif'],['.webp','image/webp'],
  ['.mp4','video/mp4'],['.webm','video/webm'],['.mp3','audio/mpeg'],['.wav','audio/wav'],['.ogg','audio/ogg'],['.pdf','application/pdf'],['.woff','font/woff'],['.woff2','font/woff2'],['.ttf','font/ttf'],['.ico','image/x-icon'],
  ['.txt','text/plain; charset=utf-8'],['.vtt','text/vtt; charset=utf-8']
]);

export function normalizePath(p){
  const parts=String(p||'').replaceAll('\\','/').split('/').filter(x=>x && x!=='.');
  if(parts.includes('..')) throw new Error('Unsafe path in SCORM package');
  return parts.join('/');
}

function u16(view,o){return view.getUint16(o,true)}
function u32(view,o){return view.getUint32(o,true)}
function findEndOfCentralDirectory(bytes){
  const start=Math.max(0,bytes.length-65557);
  for(let i=bytes.length-22;i>=start;i--){
    if(bytes[i]===0x50&&bytes[i+1]===0x4b&&bytes[i+2]===0x05&&bytes[i+3]===0x06)return i;
  }
  throw new Error('Invalid ZIP: end of central directory not found');
}

async function inflateRaw(bytes){
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf=await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function readZip(bytes){
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const eocd=findEndOfCentralDirectory(data);
  const count=u16(view,eocd+10), centralSize=u32(view,eocd+12), centralOffset=u32(view,eocd+16);
  if(count===0xffff||centralSize===0xffffffff||centralOffset===0xffffffff) throw new Error('ZIP64 SCORM packages are not supported in the free Worker parser');
  if(count>800) throw new Error('SCORM package contains too many files for free storage mode (maximum 800 files)');
  const files={};
  let totalUncompressed=0;
  const maxTotalUncompressed=70*1024*1024;
  let p=centralOffset;
  for(let i=0;i<count;i++){
    if(u32(view,p)!==0x02014b50) throw new Error('Invalid ZIP central directory');
    const flags=u16(view,p+8), method=u16(view,p+10), compressedSize=u32(view,p+20), uncompressedSize=u32(view,p+24), nameLen=u16(view,p+28), extraLen=u16(view,p+30), commentLen=u16(view,p+32), localOffset=u32(view,p+42);
    if(flags&0x1) throw new Error('Encrypted SCORM packages are not supported');
    const nameStart=p+46;
    const name=textDecoder.decode(data.slice(nameStart,nameStart+nameLen));
    const path=normalizePath(name);
    p+=46+nameLen+extraLen+commentLen;
    if(!path || path.endsWith('/')) continue;
    if(uncompressedSize>25*1024*1024) throw new Error(`SCORM file exceeds 25 MiB for free storage mode: ${path}`);
    totalUncompressed+=uncompressedSize;
    if(totalUncompressed>maxTotalUncompressed) throw new Error('SCORM package expands beyond the 80 MB free-release safety limit');
    if(u32(view,localOffset)!==0x04034b50) throw new Error('Invalid ZIP local header');
    const localNameLen=u16(view,localOffset+26), localExtraLen=u16(view,localOffset+28);
    const start=localOffset+30+localNameLen+localExtraLen;
    const compressed=data.slice(start,start+compressedSize);
    let content;
    if(method===0) content=compressed;
    else if(method===8) content=await inflateRaw(compressed);
    else throw new Error(`Unsupported ZIP compression method for ${path}`);
    if(content.byteLength!==uncompressedSize) throw new Error(`SCORM size check failed for ${path}`);
    files[path]=content;
  }
  return files;
}

function extractAttr(block,attr){return new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`,'i').exec(block)?.[1]||''}
function joinManifestPath(manifestKey,href){
  const base=manifestKey.split('/').slice(0,-1).join('/');
  return normalizePath(base?`${base}/${href}`:href);
}

export async function inspectManifest(zipBytes){
  const files=await readZip(zipBytes);
  const manifestKey=Object.keys(files).find(k=>/(^|\/)imsmanifest\.xml$/i.test(k));
  if(!manifestKey) throw new Error('SCORM package does not contain imsmanifest.xml');
  const xml=textDecoder.decode(files[manifestKey]);
  const resources=[...xml.matchAll(/<resource\b[\s\S]*?>[\s\S]*?<\/resource>/gi)].map(m=>m[0]);
  const sco=resources.find(b=>/(?:adlcp:)?scormtype\s*=\s*["']sco["']/i.test(b));
  if(!sco) throw new Error('No launchable SCO was found in imsmanifest.xml');
  const href=normalizePath(extractAttr(sco,'href'));
  if(!href) throw new Error('SCORM manifest does not declare an href');
  const launchPath=joinManifestPath(manifestKey,href);
  if(!files[launchPath]) throw new Error(`SCORM launch file not found: ${launchPath}`);
  const version=/schemaversion[^>]*>\s*1\.2/i.test(xml)||/schemaversion\s*=\s*["']1\.2/i.test(xml)?'1.2':'2004';
  const title=[...xml.matchAll(/<title>([\s\S]*?)<\/title>/gi)][0]?.[1]?.replace(/<[^>]+>/g,'').trim()||'SCORM Package';
  return {files,xml,manifestKey,launchPath,version,title};
}

export async function persistScormPackage(env,userId,courseId,filename,bytes,inspected=null){
  inspected=inspected||await inspectManifest(bytes);
  const id=randomId();
  const prefix=`scorm/${id}`;
  for(const [path,data] of Object.entries(inspected.files)){
    const ext='.'+(path.split('.').pop()||'').toLowerCase();
    const contentType=mimeByExt.get(ext)||'application/octet-stream';
    await env.CONTENT.put(`${prefix}/${path}`,data,{metadata:{contentType}});
  }
  const manifestAssetId=randomId();
  await env.DB.prepare(`INSERT INTO assets(id,course_id,storage_key,filename,mime_type,size_bytes,kind,created_by,created_at,title,status,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(manifestAssetId,courseId||null,`${prefix}/${inspected.manifestKey}`,filename,'application/zip',bytes.byteLength,'scorm',userId,now(),inspected.title,'draft',null).run();
  await env.DB.prepare(`INSERT INTO scorm_packages(id,course_id,asset_id,title,version,launch_path,manifest_xml,storage_prefix,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,courseId||null,manifestAssetId,inspected.title,inspected.version,inspected.launchPath,inspected.xml,prefix,now(),userId).run();
  return {id,...inspected,storagePrefix:prefix};
}

export async function getRegistration(env,packageId,userId){
  let row=await env.DB.prepare(`SELECT r.*,p.title,p.version,p.launch_path,p.storage_prefix,p.course_id FROM scorm_registrations r JOIN scorm_packages p ON p.id=r.package_id WHERE r.package_id=? AND r.user_id=?`).bind(packageId,userId).first();
  if(!row){
    const id=randomId(); const created=now();
    await env.DB.prepare(`INSERT INTO scorm_registrations(id,package_id,user_id,lesson_status,score_raw,suspend_data,location,total_time_seconds,cmi_json,started_at,completed_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,packageId,userId,'not attempted',null,'','',0,'{}',null,null,created).run();
    row=await env.DB.prepare(`SELECT r.*,p.title,p.version,p.launch_path,p.storage_prefix,p.course_id FROM scorm_registrations r JOIN scorm_packages p ON p.id=r.package_id WHERE r.id=?`).bind(id).first();
  }
  return row;
}

export async function commitRegistration(env,registration,payload){
  const cmi={...safeJson(registration.cmi_json),...(payload.cmi||{})};
  const lessonStatus=String(payload.lessonStatus??registration.lesson_status);
  const scoreRaw=payload.scoreRaw==null?registration.score_raw:Number(payload.scoreRaw);
  const suspendData=String(payload.suspendData??registration.suspend_data??'');
  const location=String(payload.location??registration.location??'');
  const totalTime=Number(payload.totalTimeSeconds??registration.total_time_seconds??0);
  const normalized=lessonStatus.toLowerCase();
  const complete=['completed','passed'].includes(normalized)||String(payload.completionStatus||'').toLowerCase()==='completed';
  const completedAt=complete?(registration.completed_at||now()):null;
  await env.DB.prepare(`UPDATE scorm_registrations SET lesson_status=?,score_raw=?,suspend_data=?,location=?,total_time_seconds=?,cmi_json=?,started_at=COALESCE(started_at,?),completed_at=?,updated_at=? WHERE id=?`)
    .bind(lessonStatus,Number.isFinite(scoreRaw)?scoreRaw:null,suspendData,location,totalTime,JSON.stringify(cmi),now(),completedAt,now(),registration.id).run();
  return {complete,scoreRaw:Number.isFinite(scoreRaw)?scoreRaw:null};
}

export function playerHtml({registration,user,contentBase,launchPath,version,csrfToken}){
  const is12=version==='1.2';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IRIS LUMERA · ${escapeHtml(registration.title||'SCORM')}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0b1020}iframe{width:100%;height:100%;border:0;display:block}</style></head><body>
<iframe id="scorm-frame" src="${escapeHtml(contentBase+'/'+launchPath)}" allow="fullscreen"></iframe>
<script>
const REG=${JSON.stringify(registration.id)},VERSION=${JSON.stringify(version)},CSRF=${JSON.stringify(csrfToken)};
const prior=${JSON.stringify(safeJson(registration.cmi_json))};
const learnerName=${JSON.stringify(`${user.first_name} ${user.last_name}`.trim())},learnerId=${JSON.stringify(user.employee_id||user.id)};
const cmi12={core:{student_name:learnerName,student_id:learnerId,lesson_status:${JSON.stringify(registration.lesson_status)},credit:'credit',entry:'resume',lesson_mode:'normal',score:{raw:${JSON.stringify(registration.score_raw)},min:'0',max:'100'},suspend_data:${JSON.stringify(registration.suspend_data||'')},lesson_location:${JSON.stringify(registration.location||'')},session_time:'',total_time:'0000:00:00'}};
const cmi04={completion_status:${JSON.stringify(['completed','passed'].includes(String(registration.lesson_status).toLowerCase())?'completed':'incomplete')},success_status:${JSON.stringify(String(registration.lesson_status).toLowerCase()==='passed'?'passed':'unknown')},learner_name:learnerName,learner_id:learnerId,score:{raw:${JSON.stringify(registration.score_raw)},min:'0',max:'100'},suspend_data:${JSON.stringify(registration.suspend_data||'')},location:${JSON.stringify(registration.location||'')},session_time:'PT0S',total_time:'PT0S',entry:'resume'};
function norm(path){return String(path||'').replace(/^cmi\\./,'')}
function get(obj,path){let cur=obj;for(const p of norm(path).split('.')){if(cur==null)return '';cur=cur[p]}return cur==null?'':cur}
function set(obj,path,val){const parts=norm(path).split('.');let cur=obj;for(let i=0;i<parts.length-1;i++){if(typeof cur[parts[i]]!=='object')cur[parts[i]]={};cur=cur[parts[i]]}cur[parts[parts.length-1]]=String(val);return 'true'}
function commit(){
  const payload=VERSION==='1.2'?{lessonStatus:get(cmi12,'cmi.core.lesson_status'),scoreRaw:Number(get(cmi12,'cmi.core.score.raw')||0)||null,suspendData:get(cmi12,'cmi.core.suspend_data'),location:get(cmi12,'cmi.core.lesson_location'),cmi:cmi12}:{lessonStatus:get(cmi04,'cmi.completion_status')==='completed'?(get(cmi04,'cmi.success_status')==='passed'?'passed':'completed'):get(cmi04,'cmi.completion_status'),scoreRaw:Number(get(cmi04,'cmi.score.raw')||0)||null,suspendData:get(cmi04,'cmi.suspend_data'),location:get(cmi04,'cmi.location'),completionStatus:get(cmi04,'cmi.completion_status'),cmi:cmi04};
  return fetch('/api/scorm/registrations/'+REG+'/commit',{method:'POST',headers:{'content-type':'application/json','X-CSRF-Token':CSRF},body:JSON.stringify(payload)}).catch(()=>null).then(()=> 'true');
}
let init=false,done=false;
const API12={LMSInitialize:()=>{init=true;return 'true'},LMSFinish:()=>{done=true;commit();return 'true'},LMSGetValue:(e)=>get(cmi12,e),LMSSetValue:(e,v)=>set(cmi12,e,v),LMSCommit:()=>{commit();return 'true'},LMSGetLastError:()=> '0',LMSGetErrorString:()=>'',LMSGetDiagnostic:()=>''};
const API04={Initialize:()=>{init=true;return 'true'},Terminate:()=>{done=true;commit();return 'true'},GetValue:(e)=>get(cmi04,e),SetValue:(e,v)=>set(cmi04,e,v),Commit:()=>{commit();return 'true'},GetLastError:()=> '0',GetErrorString:()=>'',GetDiagnostic:()=>''};
window.API=${is12?'API12':'undefined'};window.API_1484_11=${is12?'undefined':'API04'};
addEventListener('beforeunload',()=>{if(init&&!done)commit()});
</script></body></html>`;
}
function escapeHtml(v=''){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
