import { randomId, sha256 } from './crypto.js';

export const now = () => new Date().toISOString();

export async function audit(env, actorUserId, action, entityType, entityId, metadata = {}) {
  await env.DB.prepare(
    `INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,metadata_json,created_at)
     VALUES(?,?,?,?,?,?,?)`
  ).bind(randomId(), actorUserId || null, action, entityType, entityId || null, JSON.stringify(metadata), now()).run();
}

export async function awardXP(env, userId, eventType, referenceId, points, reason) {
  const value = Math.round(Number(points) || 0);
  if (value <= 0) return false;
  const created = now();
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO xp_events(id,user_id,event_type,reference_id,points,reason,created_at)
     VALUES(?,?,?,?,?,?,?)`
  ).bind(randomId(), userId, eventType, referenceId, value, reason, created).run();
  if (!result.meta?.changes) return false;
  await env.DB.prepare('UPDATE users SET xp=xp+?,updated_at=? WHERE id=?').bind(value,created,userId).run();
  await syncAchievements(env,userId);
  return true;
}

export async function syncAchievements(env, userId) {
  const user = await env.DB.prepare('SELECT xp FROM users WHERE id=?').bind(userId).first();
  if (!user) return;
  const achievements = await env.DB.prepare('SELECT * FROM achievements').all();
  for (const item of achievements.results || []) {
    let eligible = Number(item.threshold_xp || 0) > 0 && Number(user.xp) >= Number(item.threshold_xp);
    if (item.code === 'FIRST_STEP') {
      const p = await env.DB.prepare('SELECT COUNT(*) n FROM lesson_progress WHERE user_id=? AND completed=1').bind(userId).first();
      eligible = Number(p?.n || 0) > 0;
    }
    if (item.code === 'COURSE_COMPLETE') {
      const p = await env.DB.prepare('SELECT COUNT(*) n FROM certificates WHERE user_id=?').bind(userId).first();
      eligible = Number(p?.n || 0) > 0;
    }
    if (eligible) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO user_achievements(id,user_id,achievement_id,awarded_at) VALUES(?,?,?,?)`
      ).bind(randomId(),userId,item.id,now()).run();
    }
  }
}

export async function currentSession(env, request) {
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(/(?:^|;\s*)il_session=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT s.*,u.email,u.first_name,u.last_name,u.employee_id,u.department,u.job_title,u.role,u.status,u.must_change_password,u.xp
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=? AND s.expires_at>?`
  ).bind(tokenHash,now()).first();
  if (!row || row.status !== 'active') return null;
  return row;
}

export async function createSession(env,userId) {
  const token = randomId(32);
  const csrf = randomId(24);
  const days = Math.max(1,Number(env.SESSION_DAYS || 7));
  const expires = new Date(Date.now()+days*86400000).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions(id,user_id,token_hash,csrf_token,expires_at,created_at,last_seen_at)
     VALUES(?,?,?,?,?,?,?)`
  ).bind(randomId(),userId,await sha256(token),csrf,expires,now(),now()).run();
  return { token,csrf,expires };
}

export function sessionCookie(token,expires) {
  const maxAge=Math.max(0,Math.floor((new Date(expires).getTime()-Date.now())/1000));
  return `il_session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
export function clearSessionCookie(){return 'il_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax';}

export async function requireUser(env,request,role=null) {
  const session = await currentSession(env,request);
  if (!session) throw Object.assign(new Error('Authentication required'),{status:401});
  if (role && session.role !== role) throw Object.assign(new Error('Forbidden'),{status:403});
  if (session.status !== 'active') throw Object.assign(new Error('Account is inactive'),{status:403});
  return session;
}

export function checkCsrf(request,session){
  if (['GET','HEAD','OPTIONS'].includes(request.method)) return;
  if (!session || request.headers.get('X-CSRF-Token') !== session.csrf_token) {
    throw Object.assign(new Error('Invalid CSRF token'),{status:403});
  }
}

export function json(data,status=200,headers={}) {
  return new Response(JSON.stringify(data),{
    status,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}
  });
}
export function errorJson(error,fallback=500){
  const status=Number(error?.status||fallback);
  return json({error:status>=500?'Unexpected server error':String(error?.message||'Request failed')},status);
}

export function safeUser(user){
  return {
    id:user.id,email:user.email,firstName:user.first_name,lastName:user.last_name,
    employeeId:user.employee_id,department:user.department||'',jobTitle:user.job_title||'',
    role:user.role,status:user.status,xp:Number(user.xp||0),mustChangePassword:Boolean(user.must_change_password),
    createdAt:user.created_at||null,lastLoginAt:user.last_login_at||null
  };
}
