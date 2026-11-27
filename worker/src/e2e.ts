/**
 * 종단간 암호화 서버 쪽 (web/src/lib/e2e.ts 설명 참고)
 * 서버는 비밀번호 · 파일 열쇠를 받지 않고, 잠긴 파일과 잠긴 파일 이름만 저장합니다.
 */
import type { Env, ShareRow } from "./types";

export const CHUNK = 1 << 20;
const TAG = 16;
export const HEADER = 20;
export const MAGIC = "SDE1";

/** 암호화한 뒤 크기 (web/src/lib/e2e.ts encSize 와 같음) */
export function encSize(size: number) {
  return HEADER + size + TAG * Math.max(1, Math.ceil(size / CHUNK));
}

export type EncMeta = { v: 1; iter: number; salt: string; wrap?: string | null; /** pepper 비밀값: f = FILE_KEY_SECRET, s = 세션 비밀값 */ pv: "f" | "s" };

const B64U = /^[A-Za-z0-9_-]+$/;
export const isB64u = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.length >= min && v.length <= max && B64U.test(v);

/** 링크 만들 때 받은 잠금 정보 확인 */
export function parseKdf(v: unknown): { iter: number; salt: string } | null {
  const o = v as { iter?: unknown; salt?: unknown } | null;
  const iter = Number(o?.iter);
  if (!Number.isInteger(iter) || iter < 100_000 || iter > 5_000_000) return null;
  if (!isB64u(o?.salt, 22, 22)) return null;
  return { iter, salt: o!.salt as string };
}

function b64u(buf: ArrayBuffer) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pepperSecret(env: Env, pv: "f" | "s") {
  if (pv === "f") return env.FILE_KEY_SECRET ?? "";
  return env.SESSION_SECRET || env.SUPABASE_SECRET_KEY || "sense-drop-dev-secret";
}

export const pepperVersion = (env: Env): "f" | "s" => (env.FILE_KEY_SECRET ? "f" : "s");

/**
 * 링크마다 다른 pepper = HMAC(Worker 비밀값, 링크 id).
 * 저장하지 않고 그때그때 만들어, 비밀번호가 맞은 사람(또는 링크 주인)에게만 줍니다.
 */
export async function pepperOf(env: Env, shareId: string, pv: "f" | "s") {
  const secret = pepperSecret(env, pv);
  if (!secret) throw new Error("FILE_KEY_SECRET 이 없어요.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`sd-pepper:${shareId}`)));
}

export const encOf = (share: ShareRow): EncMeta | null => (share.enc && share.enc.v === 1 ? share.enc : null);
