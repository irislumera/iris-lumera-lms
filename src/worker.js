import { derivePassword, randomId } from './crypto.js';
import { audit, awardXP, checkCsrf, clearSessionCookie, createSession, currentSession, errorJson, json, now, requireUser, safeUser, sessionCookie } from './db.js';
import { issueCertificate, renderCertificateHtml } from './certificates.js';
import { commitRegistration, getRegistration, inspectManifest, persistScormPackage, playerHtml } from './scorm.js';
import { learningReport } from './reporting.js';
import { sendWelcomeEmail, sendCourseAssignedEmail, sendCourseCompletedEmail } from './email.js';

const MAX_ASSET_BYTES=500*1024*1024;
const KV_VALUE_BYTES=25*1024*1024;
const UPLOAD_CHUNK_BYTES=20*1024*1024;
const MAX_ASSET_CHUNKS=Math.ceil(MAX_ASSET_BYTES/UPLOAD_CHUNK_BYTES);
const FALLBACK_MIME={
  '.pdf':'application/pdf','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg',
  '.ppt':'application/vnd.ms-powerpoint','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml',
  '.txt':'text/plain; charset=utf-8','.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.zip':'application/zip'
};
function ext(name){const n=String(name||'').toLowerCase();const i=n.lastIndexOf('.');return i>=0?n.slice(i):''}
function mimeFor(name,header=''){return header&&header!=='application/octet-stream'?header:(FALLBACK_MIME[ext(name)]||'application/octet-stream')}
function cleanName(name='upload.bin'){return String(name).split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g,'_')||'upload.bin'}
function bodyJson(request){return request.json().catch(()=>({}));}
function route(path){return (path.replace(/\/+$|^\/$/g,'').replace(/^\//,'').split('/').filter(Boolean));}
async function authCsrf(env,request,role=null){const s=await requireUser(env,request,role);checkCsrf(request,s);return s}
async function login(env,request){
  const b=await bodyJson(request);const email=String(b.email||'').trim().toLowerCase();const password=String(b.password||'');
  if(!email||!password)return json({error:'Email and password are required'},400);
  const user=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
  if(!user||user.status!=='active')return json({error:'Invalid credentials or inactive account'},401);
  const pass=await derivePassword(password,user.password_salt);if(pass.hash!==user.password_hash)return json({error:'Invalid credentials'},401);
  const firstLearnerLogin=user.role==='learner'&&!user.last_login_at;
  const session=await createSession(env,user.id);await env.DB.prepare('UPDATE users SET last_login_at=?,updated_at=? WHERE id=?').bind(now(),now(),user.id).run();
  if(firstLearnerLogin)sendWelcomeEmail(env,user).catch(error=>console.error('welcome_email_failed',error));
  return json({ok:true,user:safeUser(user),csrfToken:session.csrf,mustChangePassword:Boolean(user.must_change_password)},200,{'Set-Cookie':sessionCookie(session.token,session.expires)});
}
async function register(env,request){
  const b=await bodyJson(request);
  const email=String(b.email||'').trim().toLowerCase();
  const firstName=String(b.firstName||'').trim();
  const lastName=String(b.lastName||'').trim();
  const employeeId=String(b.employeeId||'').trim()||null;
  const department=String(b.department||'').trim();
  const jobTitle=String(b.jobTitle||'').trim();
  const password=String(b.password||'');
  if(!email||!firstName||!lastName||password.length<10)return json({error:'First name, last name, email and a 10+ character password are required'},400);
  if(await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first())return json({error:'An account with that email already exists'},409);
  if(employeeId&&await env.DB.prepare('SELECT id FROM users WHERE employee_id=?').bind(employeeId).first())return json({error:'Employee ID already exists'},409);
  const pass=await derivePassword(password),id=randomId(),t=now();
  await env.DB.prepare(`INSERT INTO users(id,email,password_hash,password_salt,first_name,last_name,employee_id,department,job_title,role,status,must_change_password,xp,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'learner','active',0,0,?,?)`).bind(id,email,pass.hash,pass.salt,firstName,lastName,employeeId,department,jobTitle,t,t).run();
  await audit(env,null,'learner.self_registered','user',id,{email,employeeId,department,jobTitle});
  return json({ok:true,user:{id,email,firstName,lastName,employeeId,department,jobTitle,role:'learner',status:'active',mustChangePassword:false,xp:0}});
}
async function logout(env,request){const s=await currentSession(env,request);if(s)await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(s.id).run();return json({ok:true},200,{'Set-Cookie':clearSessionCookie()});}
async function me(env,request){const s=await currentSession(env,request);if(!s)return json({authenticated:false});return json({authenticated:true,user:safeUser(s),csrfToken:s.csrf_token});}
async function setup(env,request){
  const b=await bodyJson(request);const supplied=request.headers.get('X-Setup-Secret')||b.setupSecret||'';if(!env.SETUP_SECRET||supplied!==env.SETUP_SECRET)return json({error:'Setup secret rejected'},403);
  const admin=await env.DB.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();if(admin)return json({error:'Admin already exists'},409);
  const email=String(b.email||'').trim().toLowerCase(),firstName=String(b.firstName||'').trim(),lastName=String(b.lastName||'').trim(),password=String(b.password||'');
  if(!email||!firstName||!lastName||password.length<10)return json({error:'First name, last name, email and a 10+ character password are required'},400);
  const pass=await derivePassword(password),id=randomId(),t=now();
  await env.DB.prepare(`INSERT INTO users(id,email,password_hash,password_salt,first_name,last_name,role,status,must_change_password,xp,created_at,updated_at) VALUES(?,?,?,?,?,?,'admin','active',0,0,?,?)`).bind(id,email,pass.hash,pass.salt,firstName,lastName,t,t).run();
  return json({ok:true,id});
}

async function admins(env,request){
  await authCsrf(env,request,'admin');
  const rows=await env.DB.prepare("SELECT id,email,first_name,last_name,role,status,must_change_password,created_at,last_login_at FROM users WHERE role='admin' ORDER BY last_name,first_name").all();
  return json({admins:rows.results||[]});
}
async function createAdmin(env,request){
  const s=await authCsrf(env,request,'admin');
  const b=await bodyJson(request);
  const email=String(b.email||'').trim().toLowerCase();
  const firstName=String(b.firstName||'').trim();
  const lastName=String(b.lastName||'').trim();
  const password=String(b.password||'');
  if(!email||!firstName||!lastName||password.length<10)return json({error:'First name, last name, email and a 10+ character password are required'},400);
  if(await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first())return json({error:'A user with that email already exists'},409);
  const pass=await derivePassword(password),id=randomId(),t=now();
  await env.DB.prepare("INSERT INTO users(id,email,password_hash,password_salt,first_name,last_name,role,status,must_change_password,xp,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,email,pass.hash,pass.salt,firstName,lastName,'admin','active',1,0,t,t).run();
  await audit(env,s.id,'admin.created','user',id,{email});
  return json({ok:true,id,user:{id,email,firstName,lastName,role:'admin',status:'active',mustChangePassword:true}},201);
}
async function adminStatus(env,request,id){
  const s=await authCsrf(env,request,'admin');
  const b=await bodyJson(request);
  const status=b.status==='active'?'active':'inactive';
  if(id===s.id&&status==='inactive')return json({error:'You cannot deactivate your own administrator account'},400);
  const target=await env.DB.prepare("SELECT id,status FROM users WHERE id=? AND role='admin'").bind(id).first();
  if(!target)return json({error:'Administrator not found'},404);
  if(status==='inactive'&&target.status==='active'){
    const active=await env.DB.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND status='active'").first();
    if(Number(active?.n||0)<=1)return json({error:'At least one active administrator must remain'},400);
  }
  await env.DB.prepare("UPDATE users SET status=?,updated_at=? WHERE id=? AND role='admin'").bind(status,now(),id).run();
  if(status==='inactive')await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
  await audit(env,s.id,`admin.${status}`,'user',id,{});
  return json({ok:true,status});
}
async function resetAdminPassword(env,request,id){
  const s=await authCsrf(env,request,'admin');
  const b=await bodyJson(request);
  const password=String(b.password||'');
  if(password.length<10)return json({error:'Password must be at least 10 characters'},400);
  if(!(await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='admin'").bind(id).first()))return json({error:'Administrator not found'},404);
  const pass=await derivePassword(password);
  await env.DB.prepare("UPDATE users SET password_hash=?,password_salt=?,must_change_password=1,updated_at=? WHERE id=? AND role='admin'").bind(pass.hash,pass.salt,now(),id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
  await audit(env,s.id,'admin.password_reset','user',id,{});
  return json({ok:true});
}
async function overview(env,request){
  const s=await authCsrf(env,request,'admin');
  const [learners,courses,enrollments,certificates,scorm]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) n FROM users WHERE role='learner'").first(),env.DB.prepare("SELECT COUNT(*) n FROM courses WHERE status!='archived'").first(),
    env.DB.prepare("SELECT COUNT(*) n FROM enrollments WHERE status='active'").first(),env.DB.prepare('SELECT COUNT(*) n FROM certificates').first(),env.DB.prepare('SELECT COUNT(*) n FROM scorm_packages').first()
  ]);
  const recent=await env.DB.prepare("SELECT id,email,first_name,last_name,employee_id,department,status,xp,created_at,last_login_at FROM users WHERE role='learner' ORDER BY created_at DESC LIMIT 12").all();
  const top=await env.DB.prepare("SELECT id,first_name,last_name,employee_id,xp FROM users WHERE role='learner' AND status='active' ORDER BY xp DESC,last_name ASC LIMIT 10").all();
  return json({brand:env.APP_NAME,supportEmail:env.SUPPORT_EMAIL,actor:safeUser(s),totals:{learners:Number(learners?.n||0),courses:Number(courses?.n||0),activeEnrollments:Number(enrollments?.n||0),certificates:Number(certificates?.n||0),scormPackages:Number(scorm?.n||0)},recentLearners:recent.results||[],leaderboard:top.results||[]});
}

async function learners(env,request){
  await authCsrf(env,request,'admin');const q=new URL(request.url).searchParams.get('q')?.trim()||'';const p=`%${q}%`;
  const rows=await env.DB.prepare(`SELECT u.id,u.email,u.first_name,u.last_name,u.employee_id,u.department,u.job_title,u.status,u.must_change_password,u.xp,u.created_at,u.last_login_at,
    (SELECT COUNT(*) FROM enrollments e WHERE e.user_id=u.id AND e.status='active') active_courses,
    (SELECT COUNT(*) FROM certificates c WHERE c.user_id=u.id) certificates
    FROM users u WHERE u.role='learner' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR COALESCE(u.employee_id,'') LIKE ? OR COALESCE(u.department,'') LIKE ?) ORDER BY u.last_name,u.first_name`).bind(p,p,p,p,p).all();
  return json({learners:rows.results||[]});
}
async function createLearner(env,request){
  const s=await authCsrf(env,request,'admin');const b=await bodyJson(request);const email=String(b.email||'').trim().toLowerCase(),firstName=String(b.firstName||'').trim(),lastName=String(b.lastName||'').trim(),employeeId=String(b.employeeId||'').trim()||null,department=String(b.department||'').trim(),jobTitle=String(b.jobTitle||'').trim(),password=String(b.password||'');
  if(!email||!firstName||!lastName||password.length<10)return json({error:'First name, last name, email and a 10+ character password are required'},400);
  if(await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first())return json({error:'A user with that email already exists'},409);
  if(employeeId&&await env.DB.prepare('SELECT id FROM users WHERE employee_id=?').bind(employeeId).first())return json({error:'Employee ID already exists'},409);
  const pass=await derivePassword(password),id=randomId(),t=now();
  await env.DB.prepare(`INSERT INTO users(id,email,password_hash,password_salt,first_name,last_name,employee_id,department,job_title,role,status,must_change_password,xp,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'learner','active',1,0,?,?)`).bind(id,email,pass.hash,pass.salt,firstName,lastName,employeeId,department,jobTitle,t,t).run();
  await audit(env,s.id,'learner.created','user',id,{email,employeeId,department,jobTitle});
  return json({ok:true,user:{id,email,firstName,lastName,employeeId,department,jobTitle,status:'active',mustChangePassword:true,xp:0},initialPassword:password},201);
}
async function learnerDetail(env,request,id){
  await authCsrf(env,request,'admin');const user=await env.DB.prepare("SELECT id,email,first_name,last_name,employee_id,department,job_title,role,status,must_change_password,xp,created_at,last_login_at FROM users WHERE id=?").bind(id).first();
  if(!user)return json({error:'Learner not found'},404);
  const enroll=await env.DB.prepare(`SELECT e.*,c.title,c.slug,c.status course_status FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.user_id=? ORDER BY e.enrolled_at DESC`).bind(id).all();
  const certs=await env.DB.prepare(`SELECT ce.*,c.title course_title FROM certificates ce JOIN courses c ON c.id=ce.course_id WHERE ce.user_id=? ORDER BY issued_at DESC`).bind(id).all();
  const xp=await env.DB.prepare('SELECT event_type,reference_id,points,reason,created_at FROM xp_events WHERE user_id=? ORDER BY created_at DESC LIMIT 100').bind(id).all();
  return json({user,enrollments:enroll.results||[],certificates:certs.results||[],xpEvents:xp.results||[]});
}
async function learnerStatus(env,request,id){const s=await authCsrf(env,request,'admin');const b=await bodyJson(request);const status=b.status==='active'?'active':'inactive';await env.DB.prepare("UPDATE users SET status=?,updated_at=? WHERE id=? AND role='learner'").bind(status,now(),id).run();if(status==='inactive')await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();await audit(env,s.id,`learner.${status}`,'user',id,{});return json({ok:true,status});}
async function resetPassword(env,request,id){const s=await authCsrf(env,request,'admin');const b=await bodyJson(request);const password=String(b.password||'');if(password.length<10)return json({error:'Password must be at least 10 characters'},400);const pass=await derivePassword(password);await env.DB.prepare('UPDATE users SET password_hash=?,password_salt=?,must_change_password=1,updated_at=? WHERE id=? AND role=\'learner\'').bind(pass.hash,pass.salt,now(),id).run();await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();await audit(env,s.id,'learner.password_reset','user',id,{});return json({ok:true,initialPassword:password});}
async function updateLearnerAdmin(env,request,id){const s=await authCsrf(env,request,'admin');const b=await bodyJson(request);const first=String(b.firstName||'').trim(),last=String(b.lastName||'').trim();if(!first||!last)return json({error:'First and last name are required'},400);await env.DB.prepare(`UPDATE users SET first_name=?,last_name=?,employee_id=?,department=?,job_title=?,updated_at=? WHERE id=? AND role='learner'`).bind(first,last,String(b.employeeId||'').trim()||null,String(b.department||'').trim(),String(b.jobTitle||'').trim(),now(),id).run();await audit(env,s.id,'learner.updated','user',id,{});return json({ok:true});}

function courseSlug(title){return String(title||'course').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||`course-${Date.now()}`}
async function uniqueSlug(env,base,id=null){let slug=courseSlug(base),n=2;while(true){const row=await env.DB.prepare('SELECT id FROM courses WHERE slug=?').bind(slug).first();if(!row||row.id===id)return slug;slug=`${courseSlug(base)}-${n++}`;}}
async function listCourses(env,request,admin=false){await authCsrf(env,request,admin?'admin':null);const q=new URL(request.url).searchParams.get('q')?.trim()||'';const p=`%${q}%`;const sql=admin?`SELECT c.*,COUNT(DISTINCT CASE WHEN e.status='active' THEN e.user_id END) learners,COUNT(DISTINCT m.id) modules FROM courses c LEFT JOIN enrollments e ON e.course_id=c.id LEFT JOIN modules m ON m.course_id=c.id WHERE c.title LIKE ? OR c.category LIKE ? GROUP BY c.id ORDER BY c.updated_at DESC`:`SELECT * FROM courses WHERE status='published' AND (title LIKE ? OR category LIKE ?) ORDER BY updated_at DESC`;const rows=await env.DB.prepare(sql).bind(p,p).all();return json({courses:rows.results||[]});}
async function saveCourse(env,request,id=null){const s=await authCsrf(env,request,'admin');const b=await bodyJson(request);const title=String(b.title||'').trim();if(!title)return json({error:'Course title is required'},400);const slug=await uniqueSlug(env,b.slug||title,id);const values=[title,String(b.shortDescription||''),String(b.description||''),String(b.category||'Professional Skills'),['Foundation','Intermediate','Expert'].includes(b.level)?b.level:'Foundation',['draft','published','archived'].includes(b.status)?b.status:'draft',b.coverAssetId||null,Math.max(0,Number(b.xpReward||200)),b.certificateEnabled===false?0:1,Math.min(100,Math.max(0,Number(b.passingScore||70))),now()];
  if(id){await env.DB.prepare(`UPDATE courses SET slug=?,title=?,short_description=?,description=?,category=?,level=?,status=?,cover_asset_id=?,xp_reward=?,certificate_enabled=?,passing_score=?,updated_at=? WHERE id=?`).bind(slug,...values,id).run();await audit(env,s.id,'course.updated','course',id,{title});return json({ok:true,id});}
  const cid=randomId();await env.DB.prepare(`INSERT INTO courses(id,slug,title,short_description,description,category,level,status,cover_asset_id,xp_reward,certificate_enabled,passing_score,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(cid,slug,...values,now()).run();await audit(env,s.id,'course.created','course',cid,{title});return json({ok:true,id:cid},201);
}
async function courseDetail(env,request,id,admin=false){
  await authCsrf(env,request,admin?'admin':null);const c=await env.DB.prepare('SELECT * FROM courses WHERE id=?').bind(id).first();if(!c)return json({error:'Course not found'},404);
  if(!admin&&c.status!=='published')return json({error:'Course not found'},404);
  if(!admin){const s=await requireUser(env,request);if(!(await env.DB.prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND status IN ('active','completed')").bind(s.id,c.id).first()))return json({error:'Enrollment required'},403);}
  const mods=await env.DB.prepare('SELECT * FROM modules WHERE course_id=? ORDER BY position').bind(id).all();const modules=[];for(const m of mods.results||[]){const ls=await env.DB.prepare(`SELECT l.*,lp.completed,lp.score,sp.title scorm_title FROM lessons l LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=? LEFT JOIN scorm_packages sp ON sp.id=l.scorm_package_id WHERE l.module_id=? ORDER BY l.position`).bind(admin?'':(await currentSession(env,request))?.user_id||'',m.id).all();modules.push({...m,lessons:ls.results||[]});}return json({course:c,modules});
}
async function saveModule(env,request,courseId,id=null){const s=await authCsrf(env,request,'admin');if(id&&!courseId){courseId=(await env.DB.prepare('SELECT course_id FROM modules WHERE id=?').bind(id).first())?.course_id;}const b=await bodyJson(request);const title=String(b.title||'').trim();if(!title)return json({error:'Module title is required'},400);const position=Math.max(1,Number(b.position||1)),xp=Math.max(0,Number(b.xpReward||40));if(id){await env.DB.prepare('UPDATE modules SET title=?,description=?,position=?,xp_reward=?,updated_at=? WHERE id=? AND course_id=?').bind(title,String(b.description||''),position,xp,now(),id,courseId).run();await audit(env,s.id,'module.updated','module',id,{courseId});return json({ok:true,id});}const mid=randomId();await env.DB.prepare('INSERT INTO modules(id,course_id,title,description,position,xp_reward,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(mid,courseId,title,String(b.description||''),position,xp,now(),now()).run();await audit(env,s.id,'module.created','module',mid,{courseId});return json({ok:true,id:mid},201);}
async function deleteModule(env,request,id){const s=await authCsrf(env,request,'admin');const row=await env.DB.prepare('SELECT course_id FROM modules WHERE id=?').bind(id).first();if(!row)return json({error:'Module not found'},404);await env.DB.prepare('DELETE FROM modules WHERE id=?').bind(id).run();await audit(env,s.id,'module.deleted','module',id,{});return json({ok:true});}
async function saveLesson(env,request,moduleId,id=null){const s=await authCsrf(env,request,'admin');if(id&&!moduleId){moduleId=(await env.DB.prepare('SELECT module_id FROM lessons WHERE id=?').bind(id).first())?.module_id;}const b=await bodyJson(request);const title=String(b.title||'').trim();if(!title)return json({error:'Lesson title is required'},400);const type=['text','video','audio','pdf','presentation','external','quiz','scorm'].includes(b.type)?b.type:'text';const vals=[title,type,String(b.body||''),b.assetId||null,b.externalUrl||null,b.quizId||null,b.scormPackageId||null,Math.max(1,Number(b.durationMinutes||10)),Math.max(1,Number(b.position||1)),b.required===false?0:1,Math.max(0,Number(b.xpReward||20))];if(id){await env.DB.prepare('UPDATE lessons SET title=?,type=?,body=?,asset_id=?,external_url=?,quiz_id=?,scorm_package_id=?,duration_minutes=?,position=?,is_required=?,xp_reward=?,updated_at=? WHERE id=? AND module_id=?').bind(...vals,now(),id,moduleId).run();await audit(env,s.id,'lesson.updated','lesson',id,{moduleId});return json({ok:true,id});}const lid=randomId();await env.DB.prepare(`INSERT INTO lessons(id,module_id,title,type,body,asset_id,external_url,quiz_id,scorm_package_id,duration_minutes,position,is_required,xp_reward,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(lid,moduleId,...vals,now(),now()).run();await audit(env,s.id,'lesson.created','lesson',lid,{moduleId});return json({ok:true,id:lid},201);}
async function deleteLesson(env,request,id){const s=await authCsrf(env,request,'admin');await env.DB.prepare('DELETE FROM lessons WHERE id=?').bind(id).run();await audit(env,s.id,'lesson.deleted','lesson',id,{});return json({ok:true});}
async function enrollAdmin(env,request,id=null){
  const s=await authCsrf(env,request,'admin');
  const b=await bodyJson(request);
  const userId=String(b.userId||'').trim();
  const courseId=String(b.courseId||'').trim();
  if(!userId||!courseId)return json({error:'Learner and course are required'},400);
  const user=await env.DB.prepare("SELECT id,email,first_name,last_name,status,role FROM users WHERE id=? AND role='learner'").bind(userId).first();
  if(!user)return json({error:'Learner not found'},404);
  const course=await env.DB.prepare("SELECT * FROM courses WHERE id=?").bind(courseId).first();
  if(!course)return json({error:'Course not found'},404);
  const existing=await env.DB.prepare('SELECT id FROM enrollments WHERE user_id=? AND course_id=?').bind(userId,courseId).first();
  const t=now(),dueAt=String(b.dueAt||'').trim()||null,expiresAt=String(b.expiresAt||'').trim()||null;
  let enrollmentId;
  if(existing){
    enrollmentId=existing.id;
    await env.DB.prepare("UPDATE enrollments SET status='active',due_at=?,expires_at=?,enrolled_at=COALESCE(enrolled_at,?) WHERE id=?").bind(dueAt,expiresAt,t,existing.id).run();
    await audit(env,s.id,'enrollment.reactivated','enrollment',existing.id,{userId,courseId,dueAt,expiresAt});
  }else{
    enrollmentId=randomId();
    await env.DB.prepare('INSERT INTO enrollments(id,user_id,course_id,status,enrolled_at,due_at,expires_at,completed_at) VALUES(?,?,?,?,?,?,?,?)').bind(enrollmentId,userId,courseId,'active',t,dueAt,expiresAt,null).run();
    await audit(env,s.id,'enrollment.granted','enrollment',enrollmentId,{userId,courseId,dueAt,expiresAt});
  }
  sendCourseAssignedEmail(env,user,course,dueAt).catch(error=>console.error('assignment_email_failed',error));
  return json({ok:true,id:enrollmentId},existing?200:201);
}

async function enrollmentStatus(env,request,id){const s=await authCsrf(env,request,'admin');const b=await bodyJson(request);const status=['active','revoked','completed'].includes(b.status)?b.status:'revoked';await env.DB.prepare('UPDATE enrollments SET status=?,completed_at=CASE WHEN ?=\'completed\' THEN COALESCE(completed_at,?) ELSE completed_at END WHERE id=?').bind(status,status,now(),id).run();await audit(env,s.id,`enrollment.${status}`,'enrollment',id,{});return json({ok:true,status});}
async function enrollments(env,request){await authCsrf(env,request,'admin');const q=new URL(request.url).searchParams.get('q')?.trim()||'';const p=`%${q}%`;const rows=await env.DB.prepare(`SELECT e.*,u.email,u.first_name,u.last_name,u.employee_id,c.title course_title FROM enrollments e JOIN users u ON u.id=e.user_id JOIN courses c ON c.id=e.course_id WHERE u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR c.title LIKE ? ORDER BY e.enrolled_at DESC LIMIT 500`).bind(p,p,p,p).all();return json({enrollments:rows.results||[]});}

async function assets(env,request){
  const s=await authCsrf(env,request,'admin');
  const url=new URL(request.url);
  const path=route(url.pathname).slice(0);
  if(request.method==='GET'){
    const courseId=url.searchParams.get('courseId');
    const rows=courseId?await env.DB.prepare('SELECT * FROM assets WHERE course_id=? OR course_id IS NULL ORDER BY created_at DESC LIMIT 500').bind(courseId).all():await env.DB.prepare('SELECT * FROM assets ORDER BY created_at DESC LIMIT 500').all();
    return json({assets:rows.results||[]});
  }
  if(request.method==='POST'){
    const filename=cleanName(url.searchParams.get('filename')||'upload.bin');
    const courseId=url.searchParams.get('courseId')||null;
    const kind=url.searchParams.get('kind')||'general';
    if(!request.body)return json({error:'Upload body is empty'},400);
    const bytes=await request.arrayBuffer();
    const size=bytes.byteLength;
    if(size<=0)return json({error:'File is empty'},400);
    if(size>MAX_ASSET_BYTES)return json({error:'File exceeds the 500 MB content limit'},413);
    if(size>KV_VALUE_BYTES)return json({error:'Files above 25 MiB must use the chunked upload flow'},413);
    const id=randomId(),key=`uploads/${new Date().toISOString().slice(0,10)}/${id}-${filename}`,mime=mimeFor(filename,request.headers.get('Content-Type')||'');
    await env.CONTENT.put(key,bytes,{metadata:{contentType:mime}});
    await env.DB.prepare('INSERT INTO assets(id,course_id,storage_key,filename,mime_type,size_bytes,kind,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,courseId,key,filename,mime,size,kind,s.user_id,now()).run();
    await audit(env,s.user_id,'asset.uploaded','asset',id,{filename,kind,size,courseId,storage:'kv'});
    return json({ok:true,asset:{id,courseId,filename,mimeType:mime,sizeBytes:size,kind}},201);
  }
  return json({error:'Method not allowed'},405);
}
async function assetUploadStart(env,request){
  const s=await authCsrf(env,request,'admin');
  const b=await bodyJson(request);
  const filename=cleanName(String(b.filename||'upload.bin'));
  const courseId=String(b.courseId||'').trim()||null;
  const kind=String(b.kind||'general').trim()||'general';
  const size=Number(b.size||0);
  const mime=mimeFor(filename,String(b.mimeType||''));
  if(!Number.isFinite(size)||size<=KV_VALUE_BYTES||size>MAX_ASSET_BYTES)return json({error:'Chunked uploads must be larger than 25 MiB and no larger than 500 MB'},413);
  const totalChunks=Math.ceil(size/UPLOAD_CHUNK_BYTES);
  if(totalChunks>MAX_ASSET_CHUNKS)return json({error:'File has too many chunks'},413);
  const uploadId=randomId(20);
  const manifest={
    uploadId,createdBy:s.user_id,filename,courseId,kind,size,mime,totalChunks,createdAt:now()
  };
  await env.CONTENT.put(`uploads/meta/${uploadId}`,JSON.stringify(manifest),{metadata:{contentType:'application/json'}});
  return json({ok:true,uploadId,totalChunks,chunkSize:UPLOAD_CHUNK_BYTES});
}
async function assetUploadChunk(env,request){
  const s=await authCsrf(env,request,'admin');
  const url=new URL(request.url);
  const uploadId=String(url.searchParams.get('uploadId')||'').trim();
  const index=Number(url.searchParams.get('index'));
  if(!uploadId||!Number.isInteger(index))return json({error:'Upload ID and chunk index are required'},400);
  const meta=await env.CONTENT.get(`uploads/meta/${uploadId}`,{type:'json'});
  if(!meta||meta.createdBy!==s.user_id)return json({error:'Upload not found'},404);
  if(index<0||index>=meta.totalChunks)return json({error:'Invalid chunk index'},400);
  if(!request.body)return json({error:'Chunk body is empty'},400);
  const bytes=await request.arrayBuffer();
  if(bytes.byteLength<=0||bytes.byteLength>UPLOAD_CHUNK_BYTES)return json({error:'Invalid chunk size'},413);
  await env.CONTENT.put(`uploads/chunks/${uploadId}/${index}`,bytes,{metadata:{contentType:meta.mime}});
  return json({ok:true,index});
}

async function assetUploadFinalize(env,request){
  const s=await authCsrf(env,request,'admin');
  const b=await bodyJson(request);
  const uploadId=String(b.uploadId||'').trim();
  const meta=await env.CONTENT.get(`uploads/meta/${uploadId}`,{type:'json'});
  if(!meta||meta.createdBy!==s.id)return json({error:'Upload not found'},404);
  for(let i=0;i<meta.totalChunks;i++){
    const exists=await env.CONTENT.get(`uploads/chunks/${uploadId}/${i}`,{type:'arrayBuffer'});
    if(!exists?.value)return json({error:`Upload is incomplete. Missing chunk ${i+1} of ${meta.totalChunks}.`},409);
  }
  const id=randomId(),key=`uploads/chunked/${uploadId}`;
  await env.DB.prepare('INSERT INTO assets(id,course_id,storage_key,filename,mime_type,size_bytes,kind,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,meta.courseId,key,meta.filename,meta.mime,meta.size,meta.kind,s.user_id,now()).run();
  await env.CONTENT.delete(`uploads/meta/${uploadId}`);
  await audit(env,s.user_id,'asset.uploaded','asset',id,{filename:meta.filename,kind:meta.kind,size:meta.size,courseId:meta.courseId,storage:'kv-chunked',chunks:meta.totalChunks});
  return json({ok:true,asset:{id,courseId:meta.courseId,filename:meta.filename,mimeType:meta.mime,sizeBytes:meta.size,kind:meta.kind}},201);
}
async function deleteAsset(env,request,id){
  const s=await authCsrf(env,request,'admin');
  const asset=await env.DB.prepare('SELECT * FROM assets WHERE id=?').bind(id).first();
  if(!asset)return json({error:'Asset not found'},404);
  if(String(asset.storage_key||'').startsWith('uploads/chunked/')){
    const uploadId=String(asset.storage_key).replace('uploads/chunked/','');
    const total=Math.ceil(Number(asset.size_bytes||0)/UPLOAD_CHUNK_BYTES);
    for(let i=0;i<total;i++)await env.CONTENT.delete(`uploads/chunks/${uploadId}/${i}`);
    await env.CONTENT.delete(`uploads/meta/${uploadId}`);
  }else{
    await env.CONTENT.delete(asset.storage_key);
  }
  await env.DB.prepare('DELETE FROM assets WHERE id=?').bind(id).run();
  await audit(env,s.id,'asset.deleted','asset',id,{filename:asset.filename});
  return json({ok:true});
}
async function scormUpload(env,request){
  const s=await authCsrf(env,request,'admin');
  const url=new URL(request.url);
  const selectedCourseId=url.searchParams.get('courseId')||null;
  const requestedModuleId=url.searchParams.get('moduleId')||null;
  const filename=cleanName(url.searchParams.get('filename')||'package.zip');
  const limit=Math.min(Number(env.SCORM_MAX_BYTES||26214400),25*1024*1024);
  const declaredSize=Number(request.headers.get('Content-Length')||0);
  if(declaredSize>limit)return json({error:`SCORM package must be no larger than ${Math.round(limit/1048576)} MiB in this free release`},413);
  if(!request.body)return json({error:'SCORM upload body is empty'},400);
  const bytes=await request.arrayBuffer();
  if(bytes.byteLength<=0||bytes.byteLength>limit)return json({error:`SCORM package must be between 1 byte and ${Math.round(limit/1048576)} MiB in this free release`},413);

  const inspected=await inspectManifest(bytes);
  let courseId=selectedCourseId;

  if(!courseId){
    const title=String(inspected.title||filename.replace(/\.zip$/i,'')||'Imported SCORM course').trim();
    courseId=randomId();
    const slug=await uniqueSlug(env,title);
    const created=now();
    await env.DB.prepare(`INSERT INTO courses(id,slug,title,short_description,description,category,level,status,cover_asset_id,xp_reward,certificate_enabled,passing_score,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(courseId,slug,title,'Imported SCORM learning package','Course created automatically from an imported SCORM package.','Imported content','Foundation','draft',null,200,1,70,created,created).run();
    await audit(env,s.id,'course.created_from_scorm','course',courseId,{title,filename});
  }

  const pkg=await persistScormPackage(env,s.id,courseId,filename,bytes,inspected);
  let targetModule=requestedModuleId&&await env.DB.prepare('SELECT id FROM modules WHERE id=? AND course_id=?').bind(requestedModuleId,courseId).first();
  if(!targetModule){
    const m=randomId();
    const position=Number((await env.DB.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM modules WHERE course_id=?').bind(courseId).first())?.p||1);
    await env.DB.prepare('INSERT INTO modules(id,course_id,title,description,position,xp_reward,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(m,courseId,'Interactive Modules','SCORM learning packages',position,40,now(),now()).run();
    targetModule={id:m};
  }

  const lessonId=randomId();
  const lp=Number((await env.DB.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM lessons WHERE module_id=?').bind(targetModule.id).first())?.p||1);
  await env.DB.prepare(`INSERT INTO lessons(id,module_id,title,type,body,scorm_package_id,duration_minutes,position,is_required,xp_reward,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(lessonId,targetModule.id,inspected.title,'scorm','',pkg.id,Number(url.searchParams.get('duration')||15),lp,1,50,now(),now()).run();
  await audit(env,s.id,'scorm.imported','scorm_package',pkg.id,{courseId,moduleId:targetModule.id,lessonId,version:inspected.version,autoCourse:!selectedCourseId});
  return json({ok:true,autoCreatedCourse:!selectedCourseId,course:{id:courseId,title:inspected.title},package:{id:pkg.id,title:pkg.title,version:pkg.version,launchPath:pkg.launchPath,courseId,moduleId:targetModule.id,lessonId}},201);
}

async function scormPackages(env,request){await authCsrf(env,request,'admin');const rows=await env.DB.prepare(`SELECT p.*,c.title course_title,(SELECT COUNT(*) FROM lessons l WHERE l.scorm_package_id=p.id) lessons FROM scorm_packages p LEFT JOIN courses c ON c.id=p.course_id ORDER BY p.created_at DESC`).all();return json({packages:rows.results||[]});}

async function createQuiz(env,request){const s=await authCsrf(env,request,'admin');const b=await bodyJson(request);if(!String(b.title||'').trim())return json({error:'Quiz title required'},400);const id=randomId();await env.DB.prepare('INSERT INTO quizzes(id,title,description,passing_score,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id,String(b.title).trim(),String(b.description||''),Math.min(100,Math.max(0,Number(b.passingScore||70))),now(),now()).run();await audit(env,s.id,'quiz.created','quiz',id,{});return json({ok:true,id},201);}
async function quizzesAdmin(env,request){await authCsrf(env,request,'admin');const rows=await env.DB.prepare(`SELECT q.*,COUNT(qq.id) question_count FROM quizzes q LEFT JOIN quiz_questions qq ON qq.quiz_id=q.id GROUP BY q.id ORDER BY q.updated_at DESC`).all();return json({quizzes:rows.results||[]});}
async function adminQuiz(env,request,id){const s=await authCsrf(env,request,'admin');if(request.method==='GET'){const q=await env.DB.prepare('SELECT * FROM quizzes WHERE id=?').bind(id).first();if(!q)return json({error:'Quiz not found'},404);const qs=await env.DB.prepare('SELECT * FROM quiz_questions WHERE quiz_id=? ORDER BY position').bind(id).all();const out=[];for(const item of qs.results||[]){const opts=await env.DB.prepare('SELECT * FROM quiz_options WHERE question_id=? ORDER BY position').bind(item.id).all();out.push({...item,options:opts.results||[]});}return json({quiz:q,questions:out});}if(request.method==='DELETE'){await env.DB.prepare('DELETE FROM quizzes WHERE id=?').bind(id).run();return json({deleted:true});}const b=await bodyJson(request);await env.DB.prepare('UPDATE quizzes SET title=?,description=?,passing_score=?,updated_at=? WHERE id=?').bind(String(b.title||''),String(b.description||''),Math.min(100,Math.max(0,Number(b.passingScore||70))),now(),id).run();return json({ok:true,id});}
async function question(env,request,id){const s=await authCsrf(env,request,'admin');if(request.method==='DELETE'){await env.DB.prepare('DELETE FROM quiz_questions WHERE id=?').bind(id).run();return json({deleted:true});}const b=await bodyJson(request);const questionId=id||randomId();const type=['single','multiple','boolean','short_answer'].includes(b.questionType)?b.questionType:'single';if(id)await env.DB.prepare('UPDATE quiz_questions SET question_text=?,question_type=?,points=?,position=?,updated_at=? WHERE id=?').bind(String(b.questionText||''),type,Math.max(1,Number(b.points||1)),Math.max(1,Number(b.position||1)),now(),id).run();else await env.DB.prepare('INSERT INTO quiz_questions(id,quiz_id,question_text,question_type,points,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(questionId,String(b.quizId),String(b.questionText||''),type,Math.max(1,Number(b.points||1)),Math.max(1,Number(b.position||1)),now(),now()).run();await audit(env,s.id,id?'quiz.question.updated':'quiz.question.created','quiz_question',questionId,{});return json({ok:true,id:questionId});}
async function option(env,request,id){await authCsrf(env,request,'admin');if(request.method==='DELETE'){await env.DB.prepare('DELETE FROM quiz_options WHERE id=?').bind(id).run();return json({deleted:true});}const b=await bodyJson(request);const oid=id||randomId();if(id)await env.DB.prepare('UPDATE quiz_options SET option_text=?,is_correct=?,position=? WHERE id=?').bind(String(b.optionText||''),b.isCorrect?1:0,Math.max(1,Number(b.position||1)),id).run();else await env.DB.prepare('INSERT INTO quiz_options(id,question_id,option_text,is_correct,position) VALUES(?,?,?,?,?)').bind(oid,String(b.questionId),String(b.optionText||''),b.isCorrect?1:0,Math.max(1,Number(b.position||1))).run();return json({ok:true,id:oid});}

async function templates(env,request,id=null){const s=await authCsrf(env,request,'admin');if(request.method==='GET'){const rows=await env.DB.prepare('SELECT * FROM certificate_templates ORDER BY active DESC,updated_at DESC').all();return json({templates:rows.results||[]});}if(request.method==='DELETE'){await env.DB.prepare('UPDATE certificate_templates SET active=0,updated_at=? WHERE id=?').bind(now(),id).run();return json({ok:true});}const b=await bodyJson(request);const config=JSON.stringify(b.config||{}),templateId=id||randomId(),active=b.active===false?0:1;if(active===1)await env.DB.prepare('UPDATE certificate_templates SET active=0,updated_at=? WHERE id<>?').bind(now(),templateId).run();if(id)await env.DB.prepare('UPDATE certificate_templates SET name=?,description=?,background_asset_id=?,config_json=?,active=?,updated_at=? WHERE id=?').bind(String(b.name||''),String(b.description||''),b.backgroundAssetId||null,config,active,now(),id).run();else await env.DB.prepare('INSERT INTO certificate_templates(id,name,description,background_asset_id,config_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(templateId,String(b.name||'Untitled template'),String(b.description||''),b.backgroundAssetId||null,config,1,now(),now()).run();await audit(env,s.id,id?'certificate.template.updated':'certificate.template.created','certificate_template',templateId,{});return json({ok:true,id:templateId});}
async function certificatesAdmin(env,request){await authCsrf(env,request,'admin');const rows=await env.DB.prepare(`SELECT ce.*,u.email,u.first_name,u.last_name,c.title course_title FROM certificates ce JOIN users u ON u.id=ce.user_id JOIN courses c ON c.id=ce.course_id ORDER BY ce.issued_at DESC LIMIT 500`).all();return json({certificates:rows.results||[]});}
async function reports(env,request){await authCsrf(env,request,'admin');const courses=await env.DB.prepare(`SELECT c.id,c.title,c.status,c.xp_reward,COUNT(DISTINCT CASE WHEN e.status='active' THEN e.user_id END) learners,COUNT(DISTINCT ce.id) certificates,COUNT(DISTINCT l.id) lessons FROM courses c LEFT JOIN enrollments e ON e.course_id=c.id LEFT JOIN certificates ce ON ce.course_id=c.id LEFT JOIN modules m ON m.course_id=c.id LEFT JOIN lessons l ON l.module_id=m.id GROUP BY c.id ORDER BY learners DESC,c.updated_at DESC`).all();return json({courses:courses.results||[]});}
async function auditLog(env,request){await authCsrf(env,request,'admin');const rows=await env.DB.prepare(`SELECT a.*,u.first_name,u.last_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 500`).all();return json({audit:rows.results||[]});}

async function refreshCompletions(env,userId,courseId,moduleId){
  const module=await env.DB.prepare('SELECT * FROM modules WHERE id=? AND course_id=?').bind(moduleId,courseId).first();
  if(module){
    const required=await env.DB.prepare('SELECT COUNT(*) n FROM lessons WHERE module_id=? AND is_required=1').bind(moduleId).first();
    const done=await env.DB.prepare('SELECT COUNT(*) n FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id WHERE lp.user_id=? AND l.module_id=? AND l.is_required=1 AND lp.completed=1').bind(userId,moduleId).first();
    if(Number(required?.n||0)>0&&Number(done?.n||0)>=Number(required.n))await awardXP(env,userId,'module',moduleId,Number(module.xp_reward||40),'Completed '+module.title);
  }
  const requiredCourse=await env.DB.prepare('SELECT COUNT(*) n FROM lessons l JOIN modules m ON m.id=l.module_id WHERE m.course_id=? AND l.is_required=1').bind(courseId).first();
  const doneCourse=await env.DB.prepare('SELECT COUNT(*) n FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id JOIN modules m ON m.id=l.module_id WHERE lp.user_id=? AND m.course_id=? AND l.is_required=1 AND lp.completed=1').bind(userId,courseId).first();
  if(Number(requiredCourse?.n||0)>0&&Number(doneCourse?.n||0)>=Number(requiredCourse.n)){
    const enrollment=await env.DB.prepare('SELECT status FROM enrollments WHERE user_id=? AND course_id=?').bind(userId,courseId).first();
    const wasCompleted=enrollment?.status==='completed';
    const completionTime=now();
    await env.DB.prepare("UPDATE enrollments SET status='completed',completed_at=COALESCE(completed_at,?) WHERE user_id=? AND course_id=?").bind(completionTime,userId,courseId).run();
    const course=await env.DB.prepare('SELECT * FROM courses WHERE id=?').bind(courseId).first();
    let certificateId=null;
    if(course){
      await awardXP(env,userId,'course',course.id,Number(course.xp_reward||200),'Completed '+course.title);
      const user=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first();
      if(user&&course.certificate_enabled){
        await issueCertificate(env,user,course);
        const cert=await env.DB.prepare('SELECT id FROM certificates WHERE user_id=? AND course_id=?').bind(userId,courseId).first();
        certificateId=cert?.id||null;
      }
      if(!wasCompleted&&user)sendCourseCompletedEmail(env,user,course,certificateId).catch(error=>console.error('completion_email_failed',error));
    }
    return true;
  }
  return false;
}

async function markLessonComplete(env,userId,lessonId,score=null){const lesson=await env.DB.prepare('SELECT l.*,m.course_id,m.id module_id,c.title course_title FROM lessons l JOIN modules m ON m.id=l.module_id JOIN courses c ON c.id=m.course_id WHERE l.id=?').bind(lessonId).first();if(!lesson)return null;const old=await env.DB.prepare('SELECT * FROM lesson_progress WHERE user_id=? AND lesson_id=?').bind(userId,lessonId).first();const doneAt=old?.completed_at||now();await env.DB.prepare(`INSERT INTO lesson_progress(id,user_id,lesson_id,completed,score,started_at,completed_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,lesson_id) DO UPDATE SET completed=excluded.completed,score=COALESCE(excluded.score,lesson_progress.score),completed_at=COALESCE(lesson_progress.completed_at,excluded.completed_at),updated_at=excluded.updated_at`).bind(old?.id||randomId(),userId,lessonId,1,score,old?.started_at||now(),doneAt,now()).run();if(!old?.completed)await awardXP(env,userId,'lesson',lessonId,Number(lesson.xp_reward||20),`Completed ${lesson.title}`);const complete=await refreshCompletions(env,userId,lesson.course_id,lesson.module_id);return {lesson,courseComplete:complete};}
async function learnerLearning(env,request){const s=await requireUser(env,request);const rows=await env.DB.prepare(`SELECT c.*,e.status enrollment_status,e.enrolled_at,e.completed_at,(SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id=l.module_id WHERE m.course_id=c.id AND l.is_required=1) required_count,(SELECT COUNT(*) FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id JOIN modules m ON m.id=l.module_id WHERE lp.user_id=? AND m.course_id=c.id AND l.is_required=1 AND lp.completed=1) completed_count FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.user_id=? AND e.status IN ('active','completed') ORDER BY e.completed_at DESC,e.enrolled_at DESC`).bind(s.id,s.id).all();const achievements=await env.DB.prepare(`SELECT a.*,ua.awarded_at FROM user_achievements ua JOIN achievements a ON a.id=ua.achievement_id WHERE ua.user_id=? ORDER BY ua.awarded_at DESC`).bind(s.id).all();const certs=await env.DB.prepare(`SELECT ce.id,ce.certificate_number,ce.snapshot_course_title,ce.issued_at,c.slug FROM certificates ce JOIN courses c ON c.id=ce.course_id WHERE ce.user_id=? ORDER BY ce.issued_at DESC`).bind(s.id).all();return json({user:safeUser(s),courses:(rows.results||[]).map(c=>({...c,progress:Number(c.required_count||0)?Math.round(Number(c.completed_count||0)/Number(c.required_count||1)*100):0})),achievements:achievements.results||[],certificates:certs.results||[]});}
async function lesson(env,request,id){const s=await requireUser(env,request);const row=await env.DB.prepare(`SELECT l.*,m.course_id,m.title module_title,c.title course_title,c.slug,c.status course_status,sp.title scorm_title FROM lessons l JOIN modules m ON m.id=l.module_id JOIN courses c ON c.id=m.course_id LEFT JOIN scorm_packages sp ON sp.id=l.scorm_package_id WHERE l.id=?`).bind(id).first();if(!row)return json({error:'Lesson not found'},404);if(!(await env.DB.prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND status IN ('active','completed')").bind(s.id,row.course_id).first()))return json({error:'Enrollment required'},403);return json({lesson:row});}
async function completeLesson(env,request,id){const s=await authCsrf(env,request);const row=await env.DB.prepare('SELECT l.id,m.course_id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.id=?').bind(id).first();if(!row)return json({error:'Lesson not found'},404);if(!(await env.DB.prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND status IN ('active','completed')").bind(s.id,row.course_id).first()))return json({error:'Enrollment required'},403);const result=await markLessonComplete(env,s.id,id,bodyScore(await bodyJson(request)));return json({ok:true,courseComplete:Boolean(result?.courseComplete)});}
function bodyScore(b){return b&&b.score!=null?Number(b.score):null;}
async function quizDetail(env,request,id){const s=await requireUser(env,request);const q=await env.DB.prepare('SELECT * FROM quizzes WHERE id=?').bind(id).first();if(!q)return json({error:'Quiz not found'},404);const lesson=await env.DB.prepare('SELECT l.id,m.course_id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.quiz_id=? LIMIT 1').bind(id).first();if(lesson&&!(await env.DB.prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND status IN ('active','completed')").bind(s.id,lesson.course_id).first()))return json({error:'Enrollment required'},403);const qs=await env.DB.prepare('SELECT * FROM quiz_questions WHERE quiz_id=? ORDER BY position').bind(id).all();const out=[];for(const item of qs.results||[]){const opts=await env.DB.prepare('SELECT id,option_text,position FROM quiz_options WHERE question_id=? ORDER BY position').bind(item.id).all();out.push({...item,options:opts.results||[]});}return json({quiz:q,questions:out});}
async function submitQuiz(env,request,id){const s=await authCsrf(env,request);const b=await bodyJson(request);const quiz=await env.DB.prepare('SELECT * FROM quizzes WHERE id=?').bind(id).first();if(!quiz)return json({error:'Quiz not found'},404);const qs=await env.DB.prepare('SELECT * FROM quiz_questions WHERE quiz_id=? ORDER BY position').bind(id).all();let earned=0,total=0;const answers=b.answers||{};for(const q of qs.results||[]){const pts=Number(q.points||1);total+=pts;const options=await env.DB.prepare('SELECT * FROM quiz_options WHERE question_id=?').bind(q.id).all();const correct=(options.results||[]).filter(o=>o.is_correct).map(o=>o.id);const answer=answers[q.id];let ok=false;if(q.question_type==='multiple')ok=JSON.stringify([...(Array.isArray(answer)?answer:[])].sort())===JSON.stringify([...correct].sort());else if(q.question_type==='boolean'||q.question_type==='single')ok=correct.includes(answer);else ok=(options.results||[]).filter(o=>o.is_correct).some(o=>String(o.option_text).trim().toLowerCase()===String(answer||'').trim().toLowerCase());if(ok)earned+=pts;}const score=total?Math.round(earned/total*100):0,passed=score>=Number(quiz.passing_score||70);await env.DB.prepare('INSERT INTO quiz_attempts(id,quiz_id,user_id,score,passed,answers_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(randomId(),id,s.id,score,passed?1:0,JSON.stringify(answers),now()).run();let courseComplete=false;if(passed){await awardXP(env,s.id,'quiz',id,50,`Passed ${quiz.title}`);const lesson=await env.DB.prepare('SELECT id FROM lessons WHERE quiz_id=? LIMIT 1').bind(id).first();if(lesson){const marked=await markLessonComplete(env,s.id,lesson.id,score);courseComplete=Boolean(marked?.courseComplete);}}return json({ok:true,score,passed,total,earned,courseComplete});}
async function profile(env,request){const s=await authCsrf(env,request);const b=await bodyJson(request);const first=String(b.firstName||'').trim(),last=String(b.lastName||'').trim();if(!first||!last)return json({error:'First and last name are required'},400);await env.DB.prepare('UPDATE users SET first_name=?,last_name=?,department=?,job_title=?,must_change_password=CASE WHEN ?=1 THEN 0 ELSE must_change_password END,updated_at=? WHERE id=?').bind(first,last,String(b.department||s.department||''),String(b.jobTitle||s.job_title||''),b.clearMustChange?1:0,now(),s.id).run();return json({ok:true});}
async function changePassword(env,request){const s=await authCsrf(env,request);const b=await bodyJson(request),next=String(b.newPassword||''),current=String(b.currentPassword||'');if(next.length<10)return json({error:'New password must be at least 10 characters'},400);const user=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(s.id).first();const old=await derivePassword(current,user.password_salt);if(old.hash!==user.password_hash)return json({error:'Current password is incorrect'},400);const pass=await derivePassword(next);await env.DB.prepare('UPDATE users SET password_hash=?,password_salt=?,must_change_password=0,updated_at=? WHERE id=?').bind(pass.hash,pass.salt,now(),s.id).run();return json({ok:true});}
async function learnerCertificates(env,request){const s=await requireUser(env,request);const rows=await env.DB.prepare(`SELECT ce.*,c.slug,c.title course_title,ct.config_json,ct.background_asset_id FROM certificates ce JOIN courses c ON c.id=ce.course_id LEFT JOIN certificate_templates ct ON ct.id=ce.template_id WHERE ce.user_id=? ORDER BY ce.issued_at DESC`).bind(s.id).all();return json({certificates:rows.results||[]});}
async function certificatePage(env,request,id){const s=await requireUser(env,request);const cert=await env.DB.prepare('SELECT * FROM certificates WHERE id=?').bind(id).first();if(!cert)return new Response('Not found',{status:404});if(s.role!=='admin'&&cert.user_id!==s.id)return new Response('Forbidden',{status:403});const template=cert.template_id?await env.DB.prepare('SELECT * FROM certificate_templates WHERE id=?').bind(cert.template_id).first():null;const bg=template?.background_asset_id?`/api/assets/${template.background_asset_id}`:'';return new Response(renderCertificateHtml(cert,template,bg),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});}
async function serveAsset(env,request,id){
  await requireUser(env,request);
  const asset=await env.DB.prepare('SELECT * FROM assets WHERE id=?').bind(id).first();
  if(!asset)return new Response('Not found',{status:404});
  const headersBase=new Headers();
  headersBase.set('Content-Type',asset.mime_type||'application/octet-stream');
  headersBase.set('Accept-Ranges','bytes');
  headersBase.set('Cache-Control','private,max-age=3600');

  if(!String(asset.storage_key||'').startsWith('uploads/chunked/')){
    const obj=await env.CONTENT.getWithMetadata(asset.storage_key,{type:'stream'});
    if(!obj?.value)return new Response('Not found',{status:404});
    return new Response(obj.value,{headers:headersBase});
  }

  const total=Number(asset.size_bytes||0);
  if(!total)return new Response('Not found',{status:404});
  const range=request.headers.get('Range')||'';
  let start=0,end=total-1,status=200;
  if(range){
    const m=/^bytes=(\\d*)-(\\d*)$/.exec(range.trim());
    if(!m)return new Response('Range Not Satisfiable',{status:416,headers:{'Content-Range':`bytes */${total}`}});
    if(m[1]===''&&m[2]===''){
      return new Response('Range Not Satisfiable',{status:416,headers:{'Content-Range':`bytes */${total}`}});
    }
    if(m[1]===''){
      const suffix=Math.max(0,Number(m[2]||0));if(!suffix)return new Response('Range Not Satisfiable',{status:416,headers:{'Content-Range':`bytes */${total}`}});start=Math.max(0,total-suffix);
    }else{
      start=Number(m[1]);
      end=m[2]?Number(m[2]):total-1;
    }
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||start>=total||end<start)return new Response('Range Not Satisfiable',{status:416,headers:{'Content-Range':`bytes */${total}`}});
    end=Math.min(end,total-1);status=206;
    headersBase.set('Content-Range',`bytes ${start}-${end}/${total}`);
  }
  headersBase.set('Content-Length',String(end-start+1));
  const prefix=String(asset.storage_key).replace(/^uploads\/chunked\//,'');
  const first=Math.floor(start/UPLOAD_CHUNK_BYTES),last=Math.floor(end/UPLOAD_CHUNK_BYTES);
  if(last-first+1>50)return new Response('Requested range is too large',{status:416});
  const stream=new ReadableStream({
    start(controller){
      (async()=>{
        try{
          for(let index=first;index<=last;index++){
            const obj=await env.CONTENT.getWithMetadata(`uploads/chunks/${prefix}/${index}`,{type:'arrayBuffer'});
            if(!obj?.value)throw new Error('Content chunk not found');
            const bytes=new Uint8Array(obj.value);
            const chunkStart=index*UPLOAD_CHUNK_BYTES;
            const from=Math.max(0,start-chunkStart),to=Math.min(bytes.byteLength,end-chunkStart+1);
            if(to>from)controller.enqueue(bytes.subarray(from,to));
          }
          controller.close();
        }catch(error){controller.error(error)}
      })();
    },
    cancel(){}
  });
  return new Response(stream,{status,headers:headersBase});
}
async function scormLaunch(env,request,id){const s=await requireUser(env,request);const pkg=await env.DB.prepare('SELECT * FROM scorm_packages WHERE id=?').bind(id).first();if(!pkg)return new Response('Not found',{status:404});if(pkg.course_id&&!(await env.DB.prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND status IN ('active','completed')").bind(s.id,pkg.course_id).first())&&s.role!=='admin')return new Response('Forbidden',{status:403});const reg=await getRegistration(env,id,s.id);return new Response(playerHtml({registration:reg,user:s,contentBase:`/api/scorm-content/${id}`,launchPath:pkg.launch_path,version:pkg.version,csrfToken:s.csrf_token}),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});}
async function scormContent(env,request,packageId,pathParts){const s=await requireUser(env,request);const pkg=await env.DB.prepare('SELECT * FROM scorm_packages WHERE id=?').bind(packageId).first();if(!pkg)return new Response('Not found',{status:404});if(pkg.course_id&&!(await env.DB.prepare("SELECT id FROM enrollments WHERE user_id=? AND course_id=? AND status IN ('active','completed')").bind(s.id,pkg.course_id).first())&&s.role!=='admin')return new Response('Forbidden',{status:403});const path=pathParts.map(decodeURIComponent).join('/');if(path.includes('..'))return new Response('Bad path',{status:400});const obj=await env.CONTENT.getWithMetadata(`${pkg.storage_prefix}/${path}`,{type:'stream'});if(!obj?.value)return new Response('Not found',{status:404});const headers=new Headers();headers.set('Content-Type',obj.metadata?.contentType||'application/octet-stream');headers.set('Cache-Control','private,max-age=600');return new Response(obj.value,{headers});}
async function scormCommit(env,request,registrationId){const s=await authCsrf(env,request);const reg=await env.DB.prepare('SELECT r.*,p.course_id FROM scorm_registrations r JOIN scorm_packages p ON p.id=r.package_id WHERE r.id=?').bind(registrationId).first();if(!reg||reg.user_id!==s.id)return json({error:'Not found'},404);const result=await commitRegistration(env,reg,await bodyJson(request));if(result.complete){const lesson=await env.DB.prepare('SELECT id FROM lessons WHERE scorm_package_id=? LIMIT 1').bind(reg.package_id).first();if(lesson)await markLessonComplete(env,s.id,lesson.id,result.scoreRaw);}return json({ok:true,complete:result.complete});}

async function api(env,request){
  const parts=route(new URL(request.url).pathname);
  try{
    if(parts[0]==='api'&&parts[1]==='auth'&&parts[2]==='login'&&request.method==='POST')return login(env,request);
    if(parts[0]==='api'&&parts[1]==='auth'&&parts[2]==='register'&&request.method==='POST')return register(env,request);
    if(parts[0]==='api'&&parts[1]==='auth'&&parts[2]==='logout'&&request.method==='POST')return logout(env,request);
    if(parts[0]==='api'&&parts[1]==='auth'&&parts[2]==='me'&&request.method==='GET')return me(env,request);
    if(parts[0]==='api'&&parts[1]==='setup'&&request.method==='POST')return setup(env,request);
    if(parts[0]==='api'&&parts[1]==='admin'){
      const a=parts[2];
      if(a==='overview')return overview(env,request);
      if(a==='admins'&&request.method==='GET')return admins(env,request);
      if(a==='admins'&&request.method==='POST')return createAdmin(env,request);
      if(a==='admin'&&parts[3]&&parts[4]==='status'&&request.method==='PATCH')return adminStatus(env,request,parts[3]);
      if(a==='admin'&&parts[3]&&parts[4]==='password'&&request.method==='POST')return resetAdminPassword(env,request,parts[3]);
      if(a==='learners'&&request.method==='GET')return learners(env,request);
      if(a==='learners'&&request.method==='POST')return createLearner(env,request);
      if(a==='learner'&&parts[3]&&parts[4]==='status')return learnerStatus(env,request,parts[3]);
      if(a==='learner'&&parts[3]&&parts[4]==='password')return resetPassword(env,request,parts[3]);
      if(a==='learner'&&parts[3]&&request.method==='PATCH')return updateLearnerAdmin(env,request,parts[3]);
      if(a==='learner'&&parts[3]&&request.method==='GET')return learnerDetail(env,request,parts[3]);
      if(a==='courses'&&request.method==='GET')return listCourses(env,request,true);
      if(a==='courses'&&request.method==='POST')return saveCourse(env,request,null);
      if(a==='course'&&parts[3]&&parts[4]==='modules'&&request.method==='POST')return saveModule(env,request,parts[3],null);
      if(a==='course'&&parts[3]&&request.method==='GET')return courseDetail(env,request,parts[3],true);
      if(a==='course'&&parts[3]&&request.method==='POST')return saveCourse(env,request,parts[3]);
      if(a==='module'&&parts[3]&&request.method==='PATCH')return saveModule(env,request,null,parts[3]);
      if(a==='module'&&parts[3]&&request.method==='DELETE')return deleteModule(env,request,parts[3]);
      if(a==='module'&&parts[3]&&parts[4]==='lessons'&&request.method==='POST')return saveLesson(env,request,parts[3],null);
      if(a==='lesson'&&parts[3]&&request.method==='PATCH')return saveLesson(env,request,null,parts[3]);
      if(a==='lesson'&&parts[3]&&request.method==='DELETE')return deleteLesson(env,request,parts[3]);
      if(a==='enrollments'&&request.method==='GET')return enrollments(env,request);
      if(a==='enrollments'&&request.method==='POST')return enrollAdmin(env,request);
      if(a==='enrollment'&&parts[3]&&parts[4]==='status'&&request.method==='PATCH')return enrollmentStatus(env,request,parts[3]);
      if(a==='assets'&&parts[3]==='start'&&request.method==='POST')return assetUploadStart(env,request);
      if(a==='assets'&&parts[3]==='chunk'&&request.method==='POST')return assetUploadChunk(env,request);
      if(a==='assets'&&parts[3]==='finalize'&&request.method==='POST')return assetUploadFinalize(env,request);
      if(a==='assets'&&request.method==='GET')return assets(env,request);
      if(a==='assets'&&request.method==='POST')return assets(env,request);
      if(a==='asset'&&parts[3]&&request.method==='DELETE')return deleteAsset(env,request,parts[3]);
      if(a==='scorm'&&parts[3]==='upload'&&request.method==='POST')return scormUpload(env,request);
      if(a==='scorm'&&parts[3]==='packages'&&request.method==='GET')return scormPackages(env,request);
      if(a==='quizzes'&&request.method==='GET')return quizzesAdmin(env,request);
      if(a==='quizzes'&&request.method==='POST')return createQuiz(env,request);
      if(a==='quiz'&&parts[3])return adminQuiz(env,request,parts[3]);
      if(a==='questions'&&parts[3])return question(env,request,parts[3]);
      if(a==='options'&&parts[3])return option(env,request,parts[3]);
      if(a==='certificate-templates')return templates(env,request,parts[3]||null);
      if(a==='certificates'&&request.method==='GET')return certificatesAdmin(env,request);
      if(a==='reports')return reports(env,request);
      if(a==='learning-report')return learningReport(env,request,authCsrf,json);
      if(a==='audit')return auditLog(env,request);
    }
    if(parts[0]==='api'&&parts[1]==='learning'&&request.method==='GET')return learnerLearning(env,request);
    if(parts[0]==='api'&&parts[1]==='profile'&&request.method==='PATCH')return profile(env,request);
    if(parts[0]==='api'&&parts[1]==='password'&&request.method==='POST')return changePassword(env,request);
    if(parts[0]==='api'&&parts[1]==='courses'&&parts[2]&&request.method==='GET')return courseDetailBySlug(env,request,parts[2]);
    if(parts[0]==='api'&&parts[1]==='courses'&&request.method==='GET')return listCourses(env,request,false);
    if(parts[0]==='api'&&parts[1]==='lesson'&&parts[2]&&parts[3]==='complete'&&request.method==='POST')return completeLesson(env,request,parts[2]);
    if(parts[0]==='api'&&parts[1]==='lesson'&&parts[2]&&request.method==='GET')return lesson(env,request,parts[2]);
    if(parts[0]==='api'&&parts[1]==='quiz'&&parts[2]&&parts[3]==='submit'&&request.method==='POST')return submitQuiz(env,request,parts[2]);
    if(parts[0]==='api'&&parts[1]==='quiz'&&parts[2]&&request.method==='GET')return quizDetail(env,request,parts[2]);
    if(parts[0]==='api'&&parts[1]==='certificates'&&parts[2]&&request.method==='GET')return certificatePage(env,request,parts[2]);
    if(parts[0]==='api'&&parts[1]==='certificates'&&request.method==='GET')return learnerCertificates(env,request);
    if(parts[0]==='api'&&parts[1]==='assets'&&parts[2]&&request.method==='GET')return serveAsset(env,request,parts[2]);
    if(parts[0]==='api'&&parts[1]==='scorm'&&parts[2]==='launch'&&parts[3]&&request.method==='GET')return scormLaunch(env,request,parts[3]);
    if(parts[0]==='api'&&parts[1]==='scorm-content'&&parts[2]&&request.method==='GET')return scormContent(env,request,parts[2],parts.slice(3));
    if(parts[0]==='api'&&parts[1]==='scorm'&&parts[2]==='registrations'&&parts[3]&&parts[4]==='commit'&&request.method==='POST')return scormCommit(env,request,parts[3]);
    return json({error:'Not found'},404);
  }catch(error){console.error(error);return errorJson(error)}
}
async function courseDetailBySlug(env,request,slug){const s=await requireUser(env,request);const c=await env.DB.prepare('SELECT id FROM courses WHERE slug=? AND status=\'published\'').bind(slug).first();if(!c)return json({error:'Course not found'},404);return courseDetail(env,request,c.id,false);}

export default {async fetch(request,env){const pathname=new URL(request.url).pathname;if(pathname.startsWith('/api/'))return api(env,request);if(pathname==='/setup')return Response.redirect(new URL('/setup.html',request.url).toString(),302);return env.ASSETS.fetch(request);}};
function setupPage(){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IRIS LUMERA · Bootstrap</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a1020;color:#fff;font-family:Inter,system-ui}main{width:min(560px,calc(100% - 32px));padding:32px;border:1px solid #29304b;background:#121a30;border-radius:28px;box-shadow:0 30px 100px #0006}input{width:100%;box-sizing:border-box;margin:7px 0 12px;padding:13px;border-radius:13px;border:1px solid #343d5a;background:#0d1426;color:#fff}button{padding:13px 18px;border:0;border-radius:13px;background:#8972ff;color:#fff;font-weight:850}</style></head><body><main><p style="letter-spacing:.22em;text-transform:uppercase;font-weight:900;opacity:.6">IRIS LUMERA</p><h1>Create the first administrator</h1><p style="opacity:.7;line-height:1.6">Use your setup secret once, then sign in through the LMS.</p><form id="f"><input name="setupSecret" placeholder="Setup secret" required><input name="firstName" placeholder="First name" required><input name="lastName" placeholder="Last name" required><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password (10+ characters)" required><button>Create admin</button></form><p id="m"></p></main><script>f.onsubmit=async e=>{e.preventDefault();m.textContent='Creating…';const r=await fetch('/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(f)))});const j=await r.json();m.textContent=r.ok?'Admin created. Open the LMS home page.':(j.error||'Setup failed')}</script></body></html>`}
