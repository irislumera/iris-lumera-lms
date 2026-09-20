import { randomId } from './crypto.js';
import { now } from './db.js';

export function defaultCertificateConfig(){
  return {
    orientation:'landscape',accent:'#7158ff',eyebrow:'IRIS LUMERA',title:'Certificate of Completion',
    subtitle:'This is proudly presented to',body:'for successfully completing',footer:'Learn. Apply. Become.',nameStyle:'xl'
  };
}
export function certificateNumber(){return `IL-${new Date().getFullYear()}-${Math.floor(Math.random()*900000+100000)}`;}

export async function issueCertificate(env,user,course){
  const existing=await env.DB.prepare('SELECT * FROM certificates WHERE user_id=? AND course_id=?').bind(user.id,course.id).first();
  if(existing)return existing;
  const template=await env.DB.prepare('SELECT * FROM certificate_templates WHERE active=1 ORDER BY updated_at DESC LIMIT 1').first();
  const row={
    id:randomId(),user_id:user.id,course_id:course.id,template_id:template?.id||null,
    certificate_number:certificateNumber(),snapshot_first_name:user.first_name,snapshot_last_name:user.last_name,
    snapshot_course_title:course.title,issued_at:now()
  };
  await env.DB.prepare(
    `INSERT INTO certificates(id,user_id,course_id,template_id,certificate_number,snapshot_first_name,snapshot_last_name,snapshot_course_title,issued_at)
     VALUES(?,?,?,?,?,?,?,?,?)`
  ).bind(row.id,row.user_id,row.course_id,row.template_id,row.certificate_number,row.snapshot_first_name,row.snapshot_last_name,row.snapshot_course_title,row.issued_at).run();
  return row;
}

export function renderCertificateHtml(cert,template,backgroundUrl=''){
  const cfg={...defaultCertificateConfig(),...(template?.config_json?safeParse(template.config_json):{})};
  const fullName=`${cert.snapshot_first_name} ${cert.snapshot_last_name}`.trim();
  const date=new Date(cert.issued_at).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});
  const background=backgroundUrl?`background-image:url(${JSON.stringify(backgroundUrl)})`:'';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(cfg.title)} · ${esc(fullName)}</title>
<style>@page{size:A4 landscape;margin:0}html,body{margin:0;background:#0e1120;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:#161927}.sheet{width:297mm;height:210mm;box-sizing:border-box;padding:15mm;display:grid;place-items:center;background:#f7f5ff;${background};background-size:cover;background-position:center}.frame{width:100%;height:100%;box-sizing:border-box;border-radius:10mm;background:rgba(255,255,255,.94);border:1px solid rgba(113,88,255,.22);display:flex;flex-direction:column;align-items:center;text-align:center;padding:16mm 20mm;position:relative;overflow:hidden;box-shadow:0 25px 80px rgba(22,12,60,.16)}.frame:before{content:"";position:absolute;inset:-30%;background:radial-gradient(circle at 20% 20%,rgba(113,88,255,.14),transparent 26%),radial-gradient(circle at 85% 78%,rgba(39,211,187,.12),transparent 24%)}.eyebrow{position:relative;margin-top:4mm;font-size:11px;letter-spacing:.28em;font-weight:900;color:${esc(cfg.accent)};text-transform:uppercase}.title{position:relative;font-size:42px;font-weight:900;line-height:1.04;margin:10mm 0 5mm}.subtitle{position:relative;font-size:16px;opacity:.72}.name{position:relative;font-size:${cfg.nameStyle==='lg'?'34px':'46px'};font-weight:900;margin:6mm 0 5mm}.body{position:relative;font-size:17px;opacity:.7}.course{position:relative;font-size:26px;font-weight:800;margin-top:3mm}.meta{position:relative;margin-top:auto;font-size:11px;opacity:.62;display:flex;gap:18mm}.footer{position:relative;margin-top:5mm;font-size:10px;letter-spacing:.16em;text-transform:uppercase}@media print{body{background:#fff}.frame{box-shadow:none}}</style></head>
<body><div class="sheet"><div class="frame"><div class="eyebrow">${esc(cfg.eyebrow)}</div><div class="title">${esc(cfg.title)}</div><div class="subtitle">${esc(cfg.subtitle)}</div><div class="name">${esc(fullName)}</div><div class="body">${esc(cfg.body)}</div><div class="course">${esc(cert.snapshot_course_title)}</div><div class="meta"><span>Issued ${esc(date)}</span><span>Certificate ${esc(cert.certificate_number)}</span></div><div class="footer">${esc(cfg.footer)}</div></div></div><script>addEventListener('load',()=>setTimeout(()=>print(),450))</script></body></html>`;
}
function safeParse(v){try{return JSON.parse(v||'{}')}catch{return {}}}
function esc(v=''){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
