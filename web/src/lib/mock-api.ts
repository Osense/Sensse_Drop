"use client";

/**
 * 체험판(목업) 서버: 서버(Cloudflare Worker)를 붙이기 전, GitHub Pages 미리보기판에서
 * /api/* 요청을 이 브라우저 안(IndexedDB)에서 흉내 냅니다. worker/src/index.ts 와 같은 규칙을 따릅니다.
 * 링크와 파일은 이 브라우저에만 저장되므로 다른 기기에서는 열리지 않습니다.
 */
import { BASE_PATH } from "./config";
import { ALLOWED_EXT, isHangul } from "./file-types";
import { encSize } from "./e2e";
import { EXPIRE_OPTIONS, MIN_CUSTOM_MINUTES, MULTIPART_THRESHOLD, PART_SIZE, PLANS, type Plan } from "./plans";

class MockError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: Record<string, unknown>,
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
  downloads?: number;
  nameEnc?: string | null;
};
type MockShare = {
  id: string;
  title: string;
  message: string;
  output: "pdf" | "original" | "both";
  password: string;
  adminToken: string;
  member: boolean;
  plan?: Plan["id"];
  createdAt: string;
  expiresAt: string;
  closedAt?: string | null;
  purgedAt?: string | null;
  openCount?: number;
  /** 종단간 암호화 (password 자리에는 비밀번호 대신 확인용 값) */
  enc?: { iter: number; salt: string; wrap: string | null; pepper: string };
  files: MockFile[];
};

const MB = 1048576;
/** 체험판에서 프로를 켜 보는 스위치 (요금제 화면). 값은 체험 프로가 끝나는 시각(ms) */
export const MOCK_PRO_KEY = "sensedrop.mock.pro";
/** 체험판 프로 기간: 구독 기간을 넘는 마감 확인 흐름을 볼 수 있게 30일 */
export const MOCK_PRO_DAYS = 30;

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
const removeBlobs = (id: string) => tx("blobs", "readwrite", (s) => s.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`)));

/** 기록을 남겨 두는 기간 (worker 의 HISTORY_DAYS 와 같음) */
const HISTORY_DAYS = 30;

/** worker 의 Cron 정리와 같은 일: 닫힌 링크의 파일을 지우고, 오래된 기록은 통째로 지움 */
let lastSweep = 0;
async function sweep() {
  if (Date.now() - lastSweep < 5000) return;
  lastSweep = Date.now();
  for (const s of await allShares()) {
    if (s.purgedAt && Date.parse(s.purgedAt) < Date.now() - HISTORY_DAYS * 86400000) await removeShare(s.id);
    else if (!s.purgedAt && Date.parse(s.expiresAt) < Date.now()) {
      await removeBlobs(s.id);
      await putShare({ ...s, purgedAt: new Date().toISOString() });
    }
  }
}

// ---------- 규칙 (worker 와 같음) ----------
const needsPdf = (s: MockShare, f: MockFile) => f.ext === "pdf" || (isHangul(f.ext) && s.output !== "original");
const needsOriginal = (s: MockShare, f: MockFile) => (isHangul(f.ext) ? s.output !== "pdf" : f.ext !== "pdf");
const extOf = (n: string) => (/\.([A-Za-z0-9]+)$/.exec(n)?.[1] ?? "").toLowerCase();
const baseName = (n: string) => n.replace(/\.[A-Za-z0-9]+$/, "");
const rid = (n: number) => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => abc[b % abc.length]).join("");
};
const expired = (s: MockShare) => Boolean(s.closedAt) || Date.parse(s.expiresAt) < Date.now();

function stored(s: MockShare, f: MockFile) {
  return (needsPdf(s, f) ? (f.pdfSize ?? 0) : 0) + (needsOriginal(s, f) && f.originalUploaded ? f.size : 0);
}

/** 내 배포 기록 한 줄 (worker summarize 와 같은 모양) */
function summary(s: MockShare) {
  const state = s.closedAt ? "closed" : Date.parse(s.expiresAt) < Date.now() ? "expired" : "open";
  const files = s.files.map((f) => ({ id: f.id, name: f.name, ext: f.ext, size: f.size, downloads: f.downloads ?? 0 }));
  return {
    id: s.id,
    title: s.title,
    message: s.message,
    url: shareUrl(s.id),
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    closedAt: s.closedAt ?? null,
    state,
    purged: Boolean(s.purgedAt),
    forgetAt: s.purgedAt ? new Date(Date.parse(s.purgedAt) + HISTORY_DAYS * 86400000).toISOString() : null,
    member: s.member,
    opens: s.openCount ?? 0,
    downloads: files.reduce((n, f) => n + f.downloads, 0),
    bytes: state === "open" && !s.purgedAt ? s.files.reduce((n, f) => n + stored(s, f), 0) : 0,
    files,
  };
}
const shareUrl = (id: string) => `${location.origin}${BASE_PATH}/s/?id=${id}`;
const AUTH_KEY = (id: string) => `sensedrop.mock.auth.${id}`;

function status(s: MockShare, f: MockFile): MockFile["status"] {
  if (f.status === "error" && f.pdfSize == null) return "error";
  const pdfOk = !needsPdf(s, f) || f.pdfSize != null;
  const origOk = !needsOriginal(s, f) || f.originalUploaded;
  return pdfOk && origOk ? "done" : "uploading";
}

function items(s: MockShare) {
  const out: { fileId: string; kind: "pdf" | "original"; name: string; nameEnc: string | null; status: string; size: number | null }[] = [];
  for (const f of s.files) {
    if (needsPdf(s, f))
      out.push({ fileId: f.id, kind: "pdf", name: `${baseName(f.name)}.pdf`, nameEnc: f.nameEnc ?? null, status: f.pdfSize != null ? "done" : f.status === "error" ? "error" : "converting", size: f.pdfSize });
    if (needsOriginal(s, f)) out.push({ fileId: f.id, kind: "original", name: f.name, nameEnc: f.nameEnc ?? null, status: f.originalUploaded ? "done" : "uploading", size: f.size });
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
function mockProUntil(): number | null {
  try {
    const t = Number(localStorage.getItem(MOCK_PRO_KEY));
    return t > Date.now() ? t : null;
  } catch {
    return null;
  }
}
const mockPro = () => mockProUntil() != null;
const planOf = (init?: RequestInit): Plan => (!isMember(init) ? PLANS.guest : mockPro() ? PLANS.pro : PLANS.member);
const reserved = (s: MockShare, f: MockFile) => (needsPdf(s, f) ? (f.pdfSize ?? f.size) : 0) + (needsOriginal(s, f) ? f.size : 0);
async function usage() {
  return (await allShares())
    .filter((s) => s.member && !expired(s) && !s.purgedAt)
    .reduce((n, s) => n + s.files.reduce((m, f) => m + reserved(s, f), 0), 0);
}

async function manageable(id: string, init?: RequestInit) {
  const s = await getShare(id);
  if (!s) throw new MockError("링크가 없어요.", 404);
  if (header(init, "X-Admin-Token") !== s.adminToken && !(s.member && isMember(init))) throw new MockError("이 링크를 관리할 권한이 없어요.", 403);
  return s;
}
async function viewable(id: string) {
  const s = await getShare(id);
  if (s?.closedAt) throw new MockError("올린 분이 이 링크를 닫았어요.", 410);
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
  await sweep().catch(() => {});

  if (path === "/api/config") {
    return { plans: PLANS, expireOptions: EXPIRE_OPTIONS, minCustomMinutes: MIN_CUSTOM_MINUTES, multipartThreshold: MULTIPART_THRESHOLD, partSize: PART_SIZE, mock: true } as T;
  }

  if (path === "/api/me") {
    if (!isMember(init)) throw new MockError("로그인이 필요해요.", 401);
    const plan = planOf(init);
    return {
      plan: plan.id,
      proUntil: plan.id === "pro" ? new Date(mockProUntil()!).toISOString() : null,
      lapse: null,
      usedBytes: await usage(),
      quotaBytes: plan.quotaMb == null ? null : plan.quotaMb * MB,
    } as T;
  }

  if (path === "/api/shares" && method === "POST") {
    const member = isMember(init);
    const plan = planOf(init);
    const b = await body();
    const files: { name: string; size: number }[] = Array.isArray(b.files) ? b.files : [];
    if (!files.length) throw new MockError("파일을 한 개 이상 올려 주세요.", 400);
    if (files.length > plan.maxFiles) throw new MockError(`${plan.name}은 한 번에 ${plan.maxFiles}개까지예요.`, 400);
    let total = 0;
    for (const f of files) {
      if (!(ALLOWED_EXT as readonly string[]).includes(extOf(f.name))) throw new MockError(`이 형식은 올릴 수 없어요: ${f.name}`, 400);
      if (plan.maxFileMb != null && f.size > plan.maxFileMb * MB) throw new MockError(`${plan.name}은 파일 하나에 ${plan.maxFileMb}MB까지예요.`, 400);
      total += f.size * (isHangul(extOf(f.name)) && b.output === "both" ? 2 : 1);
    }
    if (member && plan.quotaMb != null && (await usage()) + total > plan.quotaMb * MB) {
      throw new MockError(`${plan.name}은 열려 있는 링크의 파일을 합쳐 ${plan.quotaMb >= 1024 ? `${plan.quotaMb / 1024}GB` : `${plan.quotaMb}MB`}까지 둘 수 있어요. 배포 기록에서 다 쓴 링크를 닫으면 자리가 생겨요.`, 400);
    }
    const pw = String(b.authKey ?? "");
    if (pw.length !== 43 || !b.kdf?.salt) throw new MockError("페이지를 새로고침한 뒤 다시 해 주세요.", 400);
    let expiresAt: number;
    if (b.expiresAt != null) {
      if (!plan.maxCustomMinutes) throw new MockError("마감 시각 직접 지정은 로그인하면 쓸 수 있어요.", 400);
      const t = Date.parse(String(b.expiresAt));
      if (!Number.isFinite(t) || t < Date.now() + (MIN_CUSTOM_MINUTES - 1) * 60000) throw new MockError(`마감 시각은 지금부터 ${MIN_CUSTOM_MINUTES}분 뒤부터 정할 수 있어요.`, 400);
      if (t > Date.now() + plan.maxCustomMinutes * 60000 + 60000) throw new MockError(`${plan.name}은 마감을 ${plan.id === "pro" ? "1년" : `${plan.maxCustomMinutes / 1440}일`} 안에서 정할 수 있어요.`, 400);
      expiresAt = t;
    } else {
      const minutes = Number(b.expireMinutes) || plan.defaultExpire;
      if (!plan.expireMinutes.includes(minutes)) throw new MockError(plan.id === "guest" ? "나그네는 10분 후 삭제만 쓸 수 있어요." : "이 보관 기간은 프로에서 쓸 수 있어요.", 400);
      expiresAt = Date.now() + minutes * 60000;
    }
    const proUntil = mockProUntil();
    if (plan.id === "pro" && proUntil && expiresAt > proUntil && !b.acceptBeyondPlan) {
      throw new MockError("프로 구독 기간 이후까지 열리는 링크예요. 확인이 필요해요.", 409, { code: "beyond_plan", proUntil: new Date(proUntil).toISOString() });
    }
    const now = Date.now();
    const share: MockShare = {
      id: Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join(""),
      title: String(b.title ?? "").trim().slice(0, 40) || "배포 자료",
      message: String(b.message ?? "").trim().slice(0, 1000),
      output: ["pdf", "original", "both"].includes(b.output) ? b.output : "pdf",
      password: pw,
      adminToken: rid(32),
      member,
      plan: plan.id,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      enc: { iter: Number(b.kdf.iter), salt: String(b.kdf.salt), wrap: null, pepper: rid(43) },
      files: files.map((f, i) => ({ id: rid(8), name: `파일 ${i + 1}.${extOf(f.name)}`, ext: extOf(f.name), size: f.size, status: "uploading", error: null, pdfSize: null, originalUploaded: false })),
    };
    await putShare(share);
    return { id: share.id, adminToken: share.adminToken, url: shareUrl(share.id), pepper: share.enc!.pepper, files: share.files.map((f) => ({ id: f.id, name: f.name })) } as T;
  }

  if (path === "/api/me/shares") {
    if (!isMember(init)) throw new MockError("로그인이 필요해요.", 401);
    const list = (await allShares()).filter((s) => s.member).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { shares: list.map(summary) } as T;
  }

  if (path === "/api/shares/lookup" && method === "POST") {
    const links: { id: string; token: string }[] = Array.isArray((await body()).links) ? (await body()).links : [];
    const out = [];
    for (const l of links.slice(0, 60)) {
      const s = await getShare(String(l.id));
      if (s && s.adminToken === l.token) out.push(summary(s));
    }
    return { shares: out } as T;
  }

  if ((m = /^\/api\/shares\/(\w+)\/key$/.exec(path)) && method === "POST") {
    const s = await manageable(m[1], init);
    if (!s.enc || s.enc.wrap) throw new MockError("이미 열쇠가 있어요.", 409);
    const b = await body();
    s.enc.wrap = String(b.wrap);
    for (const n of Array.isArray(b.names) ? b.names : []) {
      const f = s.files.find((x) => x.id === n.id);
      if (f) f.nameEnc = String(n.enc);
    }
    await putShare(s);
    return { ok: true } as T;
  }

  if ((m = /^\/api\/shares\/(\w+)\/close$/.exec(path)) && method === "POST") {
    const s = await manageable(m[1], init);
    const now = new Date().toISOString();
    if (!expired(s)) Object.assign(s, { closedAt: now, expiresAt: now });
    await removeBlobs(s.id);
    s.purgedAt = s.purgedAt ?? now;
    await putShare(s);
    return summary(s) as T;
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

  // 큰 파일 나눠 올리기 (worker 의 R2 멀티파트와 같은 주소)
  if ((m = /^\/api\/shares\/(\w+)\/files\/(\w+)\/mpu(?:\/([\w.~-]+)(?:\/(\d+|complete))?)?$/.exec(path))) {
    const s = await manageable(m[1], init);
    if (expired(s)) throw new MockError("닫힌 링크예요.", 410);
    const f = s.files.find((x) => x.id === m![2]);
    if (!f) throw new MockError("파일이 없어요.", 404);
    const kind = u.searchParams.get("kind") === "original" ? "original" : "pdf";
    const partKey = (up: string, n: number) => `${blobKey(s.id, f.id, kind)}#${up}#${String(n).padStart(5, "0")}`;
    const full = s.enc ? encSize(f.size) : f.size;
    const parts = Math.ceil(full / PART_SIZE);
    if (!m[3] && method === "POST") return { uploadId: rid(16), partSize: PART_SIZE, parts } as T;
    const up = m[3];
    if (m[4] && m[4] !== "complete" && method === "PUT") {
      const n = Number(m[4]);
      const blob = init?.body as Blob;
      const want = n < parts ? PART_SIZE : full - PART_SIZE * (parts - 1);
      if (n < 1 || n > parts || blob.size !== want) throw new MockError("조각 크기가 올바르지 않아요.", 400);
      await tx("blobs", "readwrite", (st) => st.put(blob, partKey(up, n)));
      return { partNumber: n, etag: `mock-${up}-${n}` } as T;
    }
    if (m[4] === "complete" && method === "POST") {
      const list: Blob[] = [];
      for (let n = 1; n <= parts; n++) {
        const blob = await tx<Blob | undefined>("blobs", "readonly", (st) => st.get(partKey(up, n)));
        if (!blob) throw new MockError("아직 다 올라오지 않았어요.", 400);
        list.push(blob);
      }
      const whole = new Blob(list);
      if (whole.size !== full) throw new MockError("처음에 고른 파일과 크기가 달라요.", 400);
      await tx("blobs", "readwrite", (st) => st.put(whole, blobKey(s.id, f.id, kind)));
      for (let n = 1; n <= parts; n++) await tx("blobs", "readwrite", (st) => st.delete(partKey(up, n)));
      if (kind === "pdf") Object.assign(f, { pdfSize: whole.size, error: null });
      else f.originalUploaded = true;
      f.status = status(s, f);
      await putShare(s);
      return { status: f.status } as T;
    }
    if (method === "DELETE") return { ok: true } as T;
    throw new MockError("지원하지 않는 요청이에요.", 405);
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
      enc: s.enc ?? null,
      files: s.files.map((f) => ({ id: f.id, name: f.name, nameEnc: f.nameEnc ?? null, ext: f.ext, size: f.size, status: f.status, error: f.error, pdfSize: f.pdfSize })),
    } as T;
  }

  if ((m = /^\/api\/shares\/(\w+)$/.exec(path)) && method === "DELETE") {
    await manageable(m[1], init);
    await removeShare(m[1]);
    return { ok: true } as T;
  }

  if ((m = /^\/api\/s\/(\w+)$/.exec(path))) {
    const s = await viewable(m[1]);
    return { title: s.title, message: s.message, expiresAt: s.expiresAt, fileCount: items(s).length, kdf: s.enc ? { iter: s.enc.iter, salt: s.enc.salt } : null, authed: authed(s.id) } as T;
  }

  if ((m = /^\/api\/s\/(\w+)\/auth$/.exec(path)) && method === "POST") {
    const s = await viewable(m[1]);
    const b = await body();
    if (String((s.enc ? b.authKey : b.password) ?? "") !== s.password) throw new MockError("비밀번호가 틀렸어요.", 401);
    await putShare({ ...s, openCount: (s.openCount ?? 0) + 1 });
    try {
      localStorage.setItem(AUTH_KEY(s.id), String(Date.now() + 12 * 3600 * 1000));
    } catch {}
    return { ok: true, ...(s.enc ? { wrap: s.enc.wrap, pepper: s.enc.pepper } : {}) } as T;
  }

  if ((m = /^\/api\/s\/(\w+)\/files$/.exec(path))) {
    const s = await viewable(m[1]);
    if (!authed(s.id)) throw new MockError("비밀번호를 먼저 넣어 주세요.", 401);
    return { title: s.title, message: s.message, expiresAt: s.expiresAt, items: items(s) } as T;
  }

  throw new MockError("체험판에서는 쓸 수 없는 기능이에요.", 404);
}

/** 체험판: 잠긴 파일을 그대로 꺼내기 (푸는 건 받는 화면에서) */
export async function mockDownloadBlob(id: string, fileId: string, kind: "pdf" | "original") {
  const s = await viewable(id);
  if (!authed(s.id)) throw new MockError("비밀번호를 먼저 넣어 주세요.", 401);
  const blob = await tx<Blob | undefined>("blobs", "readonly", (st) => st.get(blobKey(id, fileId, kind)));
  if (!blob) throw new MockError("파일이 아직 올라오지 않았어요.", 404);
  const f = s.files.find((x) => x.id === fileId);
  if (f) {
    f.downloads = (f.downloads ?? 0) + 1;
    await putShare(s);
  }
  return blob;
}

/** 체험판에서 받는 사람이 파일을 누르면: 이 브라우저에 저장된 파일을 내려받기 */
export async function mockDownload(id: string, fileId: string, kind: "pdf" | "original", name: string) {
  const s = await viewable(id);
  if (!authed(s.id)) throw new MockError("비밀번호를 먼저 넣어 주세요.", 401);
  const blob = await tx<Blob | undefined>("blobs", "readonly", (st) => st.get(blobKey(id, fileId, kind)));
  if (!blob) throw new MockError("파일이 아직 올라오지 않았어요.", 404);
  const f = s.files.find((x) => x.id === fileId);
  if (f) {
    f.downloads = (f.downloads ?? 0) + 1;
    await putShare(s);
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
