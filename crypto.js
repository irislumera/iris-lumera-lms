const enc = new TextEncoder();

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function b64ToBytes(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomId(bytes = 18) {
  return bytesToB64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}

export async function sha256(value) {
  const data = typeof value === 'string' ? enc.encode(value) : value;
  return bytesToB64(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

export async function derivePassword(password, saltB64) {
  const salt = saltB64 ? b64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name:'PBKDF2', salt, iterations:80000, hash:'SHA-256' },
    base,
    256
  );
  return { hash:bytesToB64(new Uint8Array(bits)), salt:bytesToB64(salt) };
}

export function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}
