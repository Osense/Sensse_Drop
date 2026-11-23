"use client";

/**
 * 체험판(목업) 서버: 서버(Cloudflare Worker)를 붙이기 전, GitHub Pages 미리보기판에서
 * /api/* 요청을 이 브라우저 안(IndexedDB)에서 흉내 냅니다. worker/src/index.ts 와 같은 규칙을 따릅니다.
 * 링크와 파일은 이 브라우저에만 저장되므로 다른 기기에서는 열리지 않습니다.
 */
import { BASE_PATH } from "./config";
import { ALLOWED_EXT, isHangul } from "./file-types";

class MockError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type MockFile = {
  id: string;
  name: string;
  ext: string;
  size: number;
  status: "uploading" | "converting" | "done" | "error";
  error: string | null;
  pdfSize: number | null;
  originalUploaded: boolean;
};
type MockShare = {
  id: string;
  title: string;
  message: string;
  output: "pdf" | "original" | "both";
  password: string;
  adminToken: string;
  member: boolean;
  createdAt: string;
  expiresAt: string;
  files: MockFile[];
};

const LIMITS = { guest: { maxFiles: 2, maxFileMb: 5 }, member: { maxFiles: 10, maxFileMb: 20 } };
const EXPIRE_OPTIONS = [
  { minutes: 10, label: "10분 후" },
  { minutes: 60, label: "1시간 후" },
  { minutes: 4320, label: "3일 후" },
  { minutes: 10080, label: "7일 후" },
];

// ---------- IndexedDB ----------
let dbp: Promise<IDBDatabase> | null = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open("sensedrop-mock", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("shares");
        req.result.createObjectStore("blobs");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction(store, mode).objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const getShare = (id: string) => tx<MockShare | undefined>("shares", "readonly", (s) => s.get(id));
const putShare = (share: MockShare) => tx("shares", "readwrite", (s) => s.put(share, share.id));
const allShares = () => tx<MockShare[]>("shares", "readonly", (s) => s.getAll());
async function removeShare(id: string) {
  await tx("shares", "readwrite", (s) => s.delete(id));
  await tx("blobs", "readwrite", (s) => s.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`)));
}
const blobKey = (id: string, fid: string, kind: string) => `${id}/${fid}/${kind}`;

// ---------- 규칙 (worker 와 같음) ----------
const needsPdf = (s: MockShare, f: MockFile) => f.ext === "pdf" || (isHangul(f.ext) && s.output !== "original");
const needsOriginal = (s: MockShare, f: MockFile) => (isHangul(f.ext) ? s.output !== "pdf" : f.ext !== "pdf");
const extOf = (n: string) => (/\.([A-Za-z0-9]+)$/.exec(n)?.[1] ?? "").toLowerCase();
const baseName = (n: string) => n.replace(/\.[A-Za-z0-9]+$/, "");
const rid = (n: number) => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => abc[b % abc.length]).join("");
};
const expired = (s: MockShare) => Date.parse(s.expiresAt) < Date.now();
const shareUrl = (id: string) => `${location.origin}${BASE_PATH}/s/?id=${id}`;
const AUTH_KEY = (id: string) => `sensedrop.mock.auth.${id}`;

function status(s: MockShare, f: MockFile): MockFile["status"] {
  if (f.status === "error" && f.pdfSize == null) return "error";
  const pdfOk = !needsPdf(s, f) || f.pdfSize != null;
  const origOk = !needsOriginal(s, f) || f.originalUploaded;
  return pdfOk && origOk ? "done" : "uploading";
}

function items(s: MockShare) {
  const out: { fileId: string; kind: "pdf" | "original"; name: string; status: string; size: number | null }[] = [];
  for (const f of s.files) {
    if (needsPdf(s, f))
      out.push({ fileId: f.id, kind: "pdf", name: `${baseName(f.name)}.pdf`, status: f.pdfSize != null ? "done" : f.status === "error" ? "error" : "converting", size: f.pdfSize });
    if (needsOriginal(s, f)) out.push({ fileId: f.id, kind: "original", name: f.name, status: f.originalUploaded ? "done" : "uploading", size: f.size });
  }
  return out;
}

function header(init: RequestInit | undefined, name: string) {
  const h = init?.headers;
  if (!h) return undefined;
  if (h instanceof Headers) return h.get(name) ?? undefined;
  const entry = Object.entries(h as Record<string, string>).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}
const isMember = (init?: RequestInit) => /^Bearer\s+\S+/.test(header(init, "Authorization") ?? "");

async function manageable(id: string, init?: RequestInit) {
  const s = await getShare(id);
  if (!s) throw new MockError("링크가 없어요.", 404);
  if (header(init, "X-Admin-Token") !== s.adminToken && !(s.member && isMember(init))) throw new MockError("이 링크를 관리할 권한이 없어요.", 403);
  return s;
}
async function viewable(id: string) {
  const s = await getShare(id);
  if (!s || expired(s)) throw new MockError("링크가 없거나 정한 시간이 지나 닫혔어요.", 404);
  return s;
}
const authed = (id: string) => {
  try {
    return Number(localStorage.getItem(AUTH_KEY(id)) || 0) > Date.now();
  } catch {
    return false;
  }
};

// ---------- 라우터 ----------
export async function mockApi<T>(url: string, init?: RequestInit): Promise<T> {
  const u = new URL(url, location.href);
  const path = u.pathname.replace(/\/+$/, "");
  const method = (init?.method || "GET").toUpperCase();
  const body = async () => JSON.parse(typeof init?.body === "string" ? init.body : "{}");
  let m: RegExpExecArray | null;
  // 실제 서버처럼 조금 기다려요 (화면 흐름 확인용)
  await new Promise((r) => setTimeout(r, 120));

  if (path === "/api/config") {
    return { ...LIMITS, expireOptions: EXPIRE_OPTIONS, guestExpireMinutes: [10], defaultExpireMinutes: { guest: 10, member: 4320 }, mock: true } as T;
  }

  if (path === "/api/shares" && method === "POST") {
    const member = isMember(init);
    const lim = member ? LIMITS.member : LIMITS.guest;
    const b = await body();
    const files: { name: string; size: number }[] = Array.isArray(b.files) ? b.files : [];
    if (!files.length) throw new MockError("파일을 한 개 이상 올려 주세요.", 400);
    if (files.length > lim.maxFiles) throw new MockError(`한 번에 ${lim.maxFiles}개까지예요.`, 400);
    for (const f of files) {
      if (!(ALLOWED_EXT as readonly string[]).includes(extOf(f.name))) throw new MockError(`이 형식은 올릴 수 없어요: ${f.name}`, 400);
      if (f.size > lim.maxFileMb * 1048576) throw new MockError(`파일 하나는 ${lim.maxFileMb}MB까지예요.`, 400);
    }
    const pw = String(b.password ?? "");
    if (pw.length < 4) throw new MockError("비밀번호는 4~64자로 정해 주세요.", 400);
    const minutes = Number(b.expireMinutes) || 10;
    if (!member && minutes !== 10) throw new MockError("비회원은 10분 후 삭제만 쓸 수 있어요.", 400);
    const now = Date.now();
    const share: MockShare = {
      id: rid(10),
      title: String(b.title ?? "").trim().slice(0, 100) || "배포 자료",
      message: String(b.message ?? "").trim().slice(0, 1000),
      output: ["pdf", "original", "both"].includes(b.output) ? b.output : "pdf",
      password: pw,
      adminToken: rid(32),
      member,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + minutes * 60000).toISOString(),
      files: files.map((f) => ({ id: rid(8), name: String(f.name).slice(0, 200), ext: extOf(f.name), size: f.size, status: "uploading", error: null, pdfSize: null, originalUploaded: false })),
    };
    await putShare(share);
    return { id: share.id, adminToken: share.adminToken, url: shareUrl(share.id), files: share.files.map((f) => ({ id: f.id, name: f.name })) } as T;
  }

  if (path === "/api/me/shares") {
    if (!isMember(init)) throw new MockError("로그인이 필요해요.", 401);
    const list = (await allShares()).filter((s) => s.member).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { shares: list.map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, expiresAt: s.expiresAt, fileCount: s.files.length })) } as T;
  }

  if ((m = /^\/api\/shares\/(\w+)\/files\/(\w+)$/.exec(path)) && method === "PUT") {
    const s = await manageable(m[1], init);
    const f = s.files.find((x) => x.id === m![2]);
    if (!f) throw new MockError("파일이 없어요.", 404);
    const kind = u.searchParams.get("kind") === "original" ? "original" : "pdf";
    const blob = init?.body as Blob;
    await tx("blobs", "readwrite", (st) => st.put(blob, blobKey(s.id, f.id, kind)));
    if (kind === "pdf") Object.assign(f, { pdfSize: blob.size, error: null });
    else f.originalUploaded = true;
    if (f.status === "error" && kind === "pdf") f.status = "uploading";
    f.status = status(s, f);
    await putShare(s);
    return { status: f.status } as T;
  }

  if ((m = /^\/api\/shares\/(\w+)\/files\/(\w+)\/fail$/.exec(path)) && method === "POST") {
    const s = await manageable(m[1], init);
    const f = s.files.find((x) => x.id === m![2]);
    if (f) Object.assign(f, { status: "error", error: String((await body()).error ?? "변환하지 못했어요.").slice(0, 300) });
    await putShare(s);
    return { ok: true } as T;
  }

  if ((m = /^\/api\/shares\/(\w+)\/manage$/.exec(path))) {
    const s = await manageable(m[1], init);
    return {
      id: s.id,
      title: s.title,
      message: s.message,
      output: s.output,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      url: shareUrl(s.id),
      files: s.files.map((f) => ({ id: f.id, name: f.name, ext: f.ext, size: f.size, status: f.status, error: f.error, pdfSize: f.pdfSize })),
    } as T;
  }

  if ((m = /^\/api\/shares\/(\w+)$/.exec(path)) && method === "DELETE") {
    await manageable(m[1], init);
    await removeShare(m[1]);
    return { ok: true } as T;
  }

  if ((m = /^\/api\/s\/(\w+)$/.exec(path))) {
    const s = await viewable(m[1]);
    return { title: s.title, message: s.message, expiresAt: s.expiresAt, fileCount: s.files.length, authed: authed(s.id) } as T;
  }

  if ((m = /^\/api\/s\/(\w+)\/auth$/.exec(path)) && method === "POST") {
    const s = await viewable(m[1]);
    if (String((await body()).password ?? "") !== s.password) throw new MockError("비밀번호가 틀렸어요.", 401);
    try {
      localStorage.setItem(AUTH_KEY(s.id), String(Date.now() + 12 * 3600 * 1000));
    } catch {}
    return { ok: true } as T;
  }

  if ((m = /^\/api\/s\/(\w+)\/files$/.exec(path))) {
    const s = await viewable(m[1]);
    if (!authed(s.id)) throw new MockError("비밀번호를 먼저 넣어 주세요.", 401);
    return { title: s.title, message: s.message, expiresAt: s.expiresAt, items: items(s) } as T;
  }

  throw new MockError("체험판에서는 쓸 수 없는 기능이에요.", 404);
}

/** 체험판에서 받는 사람이 파일을 누르면: 이 브라우저에 저장된 파일을 내려받기 */
export async function mockDownload(id: string, fileId: string, kind: "pdf" | "original", name: string) {
  const s = await viewable(id);
  if (!authed(s.id)) throw new MockError("비밀번호를 먼저 넣어 주세요.", 401);
  const blob = await tx<Blob | undefined>("blobs", "readonly", (st) => st.get(blobKey(id, fileId, kind)));
  if (!blob) throw new MockError("파일이 아직 올라오지 않았어요.", 404);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
