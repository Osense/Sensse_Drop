const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const enc = new TextEncoder();

/** 받는 사람이 직접 칠 수 있는 링크 코드: 소문자 · 숫자, 헷갈리는 l · 1 · o · 0 은 뺌 */
export const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export const SHARE_CODE_LENGTH = 6;
export function randomCode(length = SHARE_CODE_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export function randomId(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(24)));
}

export async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

/** 길이가 같을 때만 비교 (타이밍 차이 최소화) */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Workers 무료 플랜의 CPU 한도(10ms)를 넘지 않는 반복 횟수. 비밀번호 시도는 AUTH_LIMITER 로 따로 막습니다.
const PBKDF2_ITER = 10_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltStr, hashStr] = stored.split("$");
  if (scheme !== "pbkdf2" || !saltStr || !hashStr) return false;
  const salt = Uint8Array.from(atob(saltStr.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const actual = b64url(await pbkdf2(password, salt, Number(iterStr)));
  return safeEqual(actual, hashStr);
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** 받는 사람 열람 쿠키 값: <만료시각>.<서명> */
export async function signAccess(secret: string, shareId: string, ttlMs: number): Promise<string> {
  const exp = Date.now() + ttlMs;
  return `${exp}.${await hmac(secret, `${shareId}.${exp}`)}`;
}

export async function checkAccess(secret: string, shareId: string, value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const [expStr, mac] = value.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now() || !mac) return false;
  return safeEqual(mac, await hmac(secret, `${shareId}.${exp}`));
}
