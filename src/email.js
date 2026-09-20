const EMAIL_API='https://api.brevo.com/v3/smtp/email';
const DEFAULT_APP_URL='https://iris-lumera-lms.leviiackermann1.workers.dev';

function escEmail(v){
  return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
}
function baseUrl(env){
  return String(env.APP_URL||DEFAULT_APP_URL).replace(/\/$/,'');
}
async function sendTransactional(env,{to,name,subject,html,text}){
  const apiKey=env.BREVO_API_KEY;
  const fromEmail=env.MAIL_FROM_EMAIL;
  if(!apiKey||!fromEmail)return {sent:false,reason:'email_not_configured'};
  const payload={
    sender:{name:String(env.MAIL_FROM_NAME||'IRIS LUMERA'),email:fromEmail},
    to:[{email:to,name:name||to}],
    replyTo:{email:String(env.SUPPORT_EMAIL||fromEmail),name:'IRIS LUMERA Support'},
    subject,htmlContent:html,textContent:text
  };
  const response=await fetch(EMAIL_API,{
    method:'POST',
    headers:{accept:'application/json','api-key':apiKey,'content-type':'application/json'},
    body:JSON.stringify(payload)
  });
  if(!response.ok)throw new Error('Email provider rejected message: '+(await response.text()).slice(0,400));
  const data=await response.json().catch(()=>({}));
  return {sent:true,messageId:data.messageId||null};
}
export async function sendWelcomeEmail(env,user){
  const first=escEmail(user.first_name||user.firstName||'Learner');
  const full=escEmail(((user.first_name||user.firstName||'')+' '+(user.last_name||user.lastName||'')).trim());
  const url=baseUrl(env);
  return sendTransactional(env,{
    to:user.email,name:full,subject:'Welcome to IRIS LUMERA',
    html:'<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#111525"><div style="max-width:640px;margin:0 auto;padding:32px 18px"><div style="background:#0a1020;color:#fff;padding:28px;border-radius:22px"><div style="font-size:13px;font-weight:800;letter-spacing:.16em">IRIS LUMERA</div><div style="font-size:10px;opacity:.65;margin-top:4px;letter-spacing:.18em">LEARN. APPLY. BECOME.</div><h1 style="font-size:30px;margin:26px 0 8px">Welcome, '+first+'.</h1><p style="color:#d9ddeb;line-height:1.7;margin:0">Your learner account is active. Your learning journey starts here.</p></div><div style="background:#fff;padding:28px;border-radius:0 0 22px 22px;border:1px solid #e8ebf3"><p style="line-height:1.7">Sign in to view assigned courses, track progress, earn XP and access certificates.</p><p><a href="'+url+'" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#7a63ff;color:#fff;text-decoration:none;font-weight:800">Open IRIS LUMERA</a></p><p style="font-size:12px;color:#7a8196;line-height:1.6;margin-top:24px">Need help? Contact <b>'+escEmail(env.SUPPORT_EMAIL||'irislumera@hotmail.com')+'</b>.</p></div></div></body></html>',
    text:'Welcome to IRIS LUMERA, '+(user.first_name||user.firstName||'learner')+'. Your learner account is active. Sign in at '+url+' to view assigned courses, track progress, earn XP and access certificates. Need help? '+(env.SUPPORT_EMAIL||'irislumera@hotmail.com')
  });
}
export async function sendCourseAssignedEmail(env,user,course,dueAt){
  const full=(((user.first_name||'')+' '+(user.last_name||'')).trim());
  const url=baseUrl(env);
  const due=dueAt||'No due date';
  return sendTransactional(env,{
    to:user.email,name:full,subject:'New course assigned: '+String(course.title),
    html:'<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#111525"><div style="max-width:640px;margin:0 auto;padding:32px 18px"><div style="background:#fff;border:1px solid #e8ebf3;border-radius:22px;padding:28px"><div style="font-size:13px;font-weight:800;letter-spacing:.16em">IRIS LUMERA</div><h1 style="font-size:26px;margin:20px 0 8px">A course has been assigned to you.</h1><p style="color:#7a8196;line-height:1.7">Hello '+escEmail(user.first_name||'there')+', your administrator has assigned new learning.</p><div style="background:#f7f7fb;border:1px solid #eceef4;border-radius:16px;padding:18px;margin:20px 0"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#7f8698;font-weight:800">Course</div><div style="font-size:20px;font-weight:900;margin-top:6px">'+escEmail(course.title)+'</div><div style="font-size:12px;color:#7a8196;margin-top:8px">Due date: <b>'+escEmail(due)+'</b></div></div><p><a href="'+url+'/?screen=learning" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#7a63ff;color:#fff;text-decoration:none;font-weight:800">View my learning</a></p><p style="font-size:12px;color:#7a8196;line-height:1.6;margin-top:24px">Need help? Contact <b>'+escEmail(env.SUPPORT_EMAIL||'irislumera@hotmail.com')+'</b>.</p></div></div></body></html>',
    text:'Hello '+(user.first_name||'there')+', a new course has been assigned to you: '+course.title+'. Due date: '+due+'. Open your learning at '+url+'/?screen=learning. Need help? '+(env.SUPPORT_EMAIL||'irislumera@hotmail.com')
  });
}
export async function sendCourseCompletedEmail(env,user,course,certificateId){
  const full=(((user.first_name||'')+' '+(user.last_name||'')).trim());
  const url=baseUrl(env);
  const certUrl=certificateId?url+'/api/certificates/'+encodeURIComponent(certificateId):url+'/?screen=certificates';
  return sendTransactional(env,{
    to:user.email,name:full,subject:'Course completed: '+String(course.title),
    html:'<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#111525"><div style="max-width:640px;margin:0 auto;padding:32px 18px"><div style="background:linear-gradient(135deg,#0a1020,#3b2a73);color:#fff;padding:30px;border-radius:22px"><div style="font-size:13px;font-weight:800;letter-spacing:.16em">IRIS LUMERA</div><h1 style="font-size:28px;margin:24px 0 8px">Course completed.</h1><p style="color:#e2e4ef;line-height:1.7;margin:0">Congratulations, '+escEmail(user.first_name||'learner')+'. You completed <b>'+escEmail(course.title)+'</b>.</p></div><div style="background:#fff;padding:28px;border:1px solid #e8ebf3;border-radius:0 0 22px 22px"><p style="line-height:1.7">Your completion has been recorded in IRIS LUMERA. '+(certificateId?'Your certificate is ready.':'Certificate issuance is disabled for this course.')+'</p><p><a href="'+certUrl+'" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#7a63ff;color:#fff;text-decoration:none;font-weight:800">'+(certificateId?'Open certificate':'View certificates')+'</a></p><p style="font-size:12px;color:#7a8196;line-height:1.6;margin-top:24px">Need help? Contact <b>'+escEmail(env.SUPPORT_EMAIL||'irislumera@hotmail.com')+'</b>.</p></div></div></body></html>',
    text:'Congratulations '+(user.first_name||'learner')+'. You completed '+course.title+'. Your completion is recorded in IRIS LUMERA. '+(certificateId?'Open your certificate: '+certUrl:'View certificates: '+url+'/?screen=certificates')+'. Need help? '+(env.SUPPORT_EMAIL||'irislumera@hotmail.com')
  });
}
