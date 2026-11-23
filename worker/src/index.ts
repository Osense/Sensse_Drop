/**
 * 쎈스드롭 Cloudflare Worker
 *
 * - 정적 화면(web/out)은 Workers 정적 자산으로 제공합니다. /api/*, 받는 사람 주소(/<코드>, /s/<코드>), /vendor/rhwp_bg.wasm 은 이 코드가 처리합니다.
 * - 파일은 R2(BUCKET), 링크 정보는 Supabase WSNS 프로젝트(sd_shares · sd_files)에 둡니다.
 * - HWP/HWPX → PDF 변환은 올리는 사람의 브라우저에서 끝내고 PDF를 올립니다. 서버는 변환하지 않습니다.
 */
import { ALLOWED_EXT, isHangul } from "./file-types";
import { checkAccess, hashPassword, randomCode, randomId, randomToken, safeEqual, sha256, signAccess, verifyPassword } from "./crypto";
import { getDb, getUserId, HISTORY_DAYS, isDevMode, type Db } from "./db";
import type { Env, FileRow, Output, ShareRow, ShareSummary, ShareWithFiles } from "./types";
import { EXPIRE_OPTIONS, MIN_CUSTOM_MINUTES, MULTIPART_THRESHOLD, PART_SIZE, PLANS, PRO_GRACE_DAYS, type Plan, type PlanId } from "./plans";

const ACCESS_TTL_MS = 12 * 60 * 60 * 1000;
const ALLOWED = new Set<string>(ALLOWED_EXT);
const OUTPUTS = new Set<Output>(["pdf", "original", "both"]);
/** 브라우저에서 만든 PDF 는 쪽 그림이라 원본보다 커질 수 있어 원본 한도의 이 배수까지 받습니다 */
const PDF_SIZE_FACTOR = 4;
const MAX_BODY_BYTES = 95 * 1024 * 1024; // Workers 요청 본문 한도(100MB) 안쪽

/** 회원의 요금제: 로그인 안 함 → 나그네, sd_plans 에 기간이 남은 프로 → 프로, 그 밖 → 멤버십 */
async function planOf(db: Db, userId: string | null): Promise<{ plan: Plan; proUntil: string | null }> {
  if (!userId) return { plan: PLANS.guest, proUntil: null };
  const row = await db.getPlan(userId).catch(() => null);
  if (row && Date.parse(row.expires_at) > Date.now()) return { plan: PLANS.pro, proUntil: row.expires_at };
  return { plan: PLANS.member, proUntil: null };
}

const planOfShare = (share: ShareRow): Plan => PLANS[(share.plan as PlanId) ?? (share.owner_id ? "member" : "guest")] ?? PLANS.member;

/** 파일 하나가 차지할(차지하는) 자리: 아직 안 올라왔으면 처음 알린 크기로 잡아 둡니다 */
function reservedBytes(share: ShareRow, f: FileRow) {
  return (needsPdf(share, f) ? (f.pdf_size ?? f.size) : 0) + (needsOriginal(share, f) ? f.size : 0);
}

/** 열려 있는 링크들이 차지하는 저장 공간 (동시 보관 총량 계산용) */
async function usageOf(db: Db, userId: string) {
  const shares = await db.listOwnerShares(userId);
  return shares
    .filter((s) => !isExpired(s) && !s.purged_at)
    .reduce((n, s) => n + s.files.reduce((m, f) => m + reservedBytes(s, f), 0), 0);
}

const MB = 1048576;
const DAY = 86400000;

/**
 * 프로가 끝나고 유예(PRO_GRACE_DAYS)가 지나면 닫힐 링크.
 * 프로로 만든 열린 링크 중 멤버십 한도(파일 수 · 파일 크기 · 유예 끝 + 7일보다 먼 마감)를 넘는 것,
 * 그리고 남은 링크를 합쳐 멤버십 동시 보관 총량을 넘으면 최근 것부터.
 */
function sharesToClose(shares: ShareWithFiles[], proUntil: string): ShareWithFiles[] {
  const m = PLANS.member;
  const graceEnd = Date.parse(proUntil) + PRO_GRACE_DAYS * DAY;
  const open = shares.filter((s) => !isExpired(s) && !s.purged_at).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const close: ShareWithFiles[] = [];
  const keep: ShareWithFiles[] = [];
  for (const s of open) {
    const over =
      s.plan === "pro" &&
      (s.files.length > m.maxFiles ||
        s.files.some((f) => m.maxFileMb != null && f.size > m.maxFileMb * MB) ||
        Date.parse(s.expires_at) > graceEnd + m.maxCustomMinutes * 60000);
    (over ? close : keep).push(s);
  }
  let total = keep.reduce((n, s) => n + s.files.reduce((k, f) => k + reservedBytes(s, f), 0), 0);
  for (const s of keep) {
    if (total <= (m.quotaMb ?? Infinity) * MB) break;
    if (s.plan !== "pro") continue;
    close.push(s);
    total -= s.files.reduce((k, f) => k + reservedBytes(s, f), 0);
  }
  return close;
}
const sizeLabel = (mb: number) => (mb >= 1024 ? `${Math.round(mb / 102.4) / 10}GB` : `${mb}MB`);

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

const fail = (status: number, error: string) => json({ error }, status);

function extOf(name: string) {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

function baseName(name: string) {
  return name.replace(/\.[A-Za-z0-9]+$/, "") || "문서";
}

function cleanName(name: unknown) {
  let n = String(name ?? "").normalize("NFC");
  n = n.split(/[\\/]/).pop() ?? "";
  n = n.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return n.slice(0, 200) || "문서";
}

function cookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function secretOf(env: Env) {
  return env.SESSION_SECRET || env.SUPABASE_SECRET_KEY || "sense-drop-dev-secret";
}


function isExpired(share: ShareRow) {
  return Date.parse(share.expires_at) < Date.now();
}

function baseUrl(env: Env, request: Request) {
  return (env.PUBLIC_URL || new URL(request.url).origin).replace(/\/+$/, "");
}

const key = (shareId: string, fileId: string, kind: "pdf" | "original", ext: string) =>
  `shares/${shareId}/${fileId}.${kind === "pdf" ? "pdf" : ext}`;

/** 한글 파일만 보내는 방식(PDF / PDF + 원본 / 원본)을 따르고, PDF는 PDF로, 나머지 형식은 원본 그대로 */
const needsPdf = (share: ShareRow, f: FileRow) => f.ext === "pdf" || (isHangul(f.ext) && share.output !== "original");
const needsOriginal = (share: ShareRow, f: FileRow) => (isHangul(f.ext) ? share.output !== "pdf" : f.ext !== "pdf");

/** 올라온 조각을 보고 파일 상태 결정 */
function computeStatus(share: ShareRow, f: FileRow): FileRow["status"] {
  if (f.status === "error" && f.pdf_size == null) return "error";
  const pdfOk = !needsPdf(share, f) || f.pdf_size != null;
  const origOk = !needsOriginal(share, f) || f.original_uploaded;
  return pdfOk && origOk ? "done" : "uploading";
}

/** 받는 사람에게 보여 줄 목록 */
function downloadItems(share: ShareWithFiles) {
  const items: { fileId: string; kind: "pdf" | "original"; name: string; status: string; size: number | null }[] = [];
  for (const f of share.files) {
    if (needsPdf(share, f)) {
      items.push({
        fileId: f.id,
        kind: "pdf",
        name: `${baseName(f.original_name)}.pdf`,
        status: f.pdf_size != null ? "done" : f.status === "error" ? "error" : "converting",
        size: f.pdf_size,
      });
    }
    if (needsOriginal(share, f)) {
      items.push({
        fileId: f.id,
        kind: "original",
        name: f.original_name,
        status: f.original_uploaded ? "done" : "uploading",
        size: f.size,
      });
    }
  }
  return items;
}

/** 지금 R2에 남아 있는 바이트 */
function storedBytes(share: ShareRow, f: FileRow) {
  return (needsPdf(share, f) ? (f.pdf_size ?? 0) : 0) + (needsOriginal(share, f) && f.original_uploaded ? f.size : 0);
}

/** 내 배포 기록 한 줄 */
function summarize(env: Env, request: Request, s: ShareWithFiles): ShareSummary {
  const state: ShareSummary["state"] = s.closed_at ? "closed" : isExpired(s) ? "expired" : "open";
  const files = s.files.map((f) => ({ id: f.id, name: f.original_name, ext: f.ext, size: f.size, downloads: f.download_count ?? 0 }));
  return {
    id: s.id,
    title: s.title,
    message: s.message ?? "",
    url: `${baseUrl(env, request)}/${s.id}`,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    closedAt: s.closed_at ?? null,
    state,
    purged: Boolean(s.purged_at),
    forgetAt: s.purged_at ? new Date(Date.parse(s.purged_at) + HISTORY_DAYS * 86400000).toISOString() : null,
    member: Boolean(s.owner_id),
    opens: s.open_count ?? 0,
    downloads: files.reduce((n, f) => n + f.downloads, 0),
    bytes: state === "open" && !s.purged_at ? s.files.reduce((n, f) => n + storedBytes(s, f), 0) : 0,
    files,
  };
}

/** 링크를 닫고 파일을 바로 지움 (기록은 남김) */
async function closeShare(env: Env, db: Db, share: ShareWithFiles) {
  const now = new Date().toISOString();
  if (!share.closed_at && !isExpired(share)) Object.assign(share, { closed_at: now, expires_at: now });
  await removeShareFiles(env, share.id);
  share.purged_at = share.purged_at ?? now;
  await db.updateShare(share.id, { closed_at: share.closed_at ?? null, expires_at: share.expires_at, purged_at: share.purged_at });
}

/** 파일이 R2에 다 올라온 뒤 상태 기록 */
async function markUploaded(db: Db, share: ShareWithFiles, file: FileRow, kind: "pdf" | "original", size: number) {
  const next: FileRow = { ...file };
  if (kind === "pdf") Object.assign(next, { pdf_size: size, error: null });
  else next.original_uploaded = true;
  if (next.status === "error" && kind === "pdf") next.status = "uploading";
  next.status = computeStatus(share, next);
  await db.updateFile(share.id, file.id, {
    pdf_size: next.pdf_size,
    original_uploaded: next.original_uploaded,
    status: next.status,
    error: next.error,
  });
  return next.status;
}

/** RFC 6266: 한글 파일 이름이 깨지지 않게 */
function contentDisposition(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** 링크 관리 권한: 만든 브라우저의 관리 토큰, 또는 링크 주인(회원) */
async function requireManager(env: Env, db: Db, request: Request, id: string): Promise<ShareWithFiles | Response> {
  const share = await db.getShare(id);
  if (!share) return fail(404, "링크를 찾을 수 없어요.");
  const token = request.headers.get("X-Admin-Token");
  if (token && safeEqual(await sha256(token), share.admin_token_hash)) return share;
  if (share.owner_id) {
    const userId = await getUserId(env, request);
    if (userId && userId === share.owner_id) return share;
  }
  return fail(404, "링크를 찾을 수 없어요.");
}

async function requireViewer(env: Env, db: Db, request: Request, id: string): Promise<ShareWithFiles | Response> {
  const share = await db.getShare(id);
  if (!share || isExpired(share)) return fail(404, "링크가 없거나 보관 기간이 지났어요.");
  if (!(await checkAccess(secretOf(env), share.id, cookies(request)[`sd_${share.id}`]))) {
    return fail(401, "비밀번호를 넣어 주세요.");
  }
  return share;
}

async function removeShareFiles(env: Env, shareId: string) {
  let cursor: string | undefined;
  do {
    const list = await env.BUCKET.list({ prefix: `shares/${shareId}/`, cursor });
    if (list.objects.length) await env.BUCKET.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const db = getDb(env);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  let m: RegExpExecArray | null;

  // ---------- 설정 ----------
  if (path === "/api/config" && method === "GET") {
    return json({
      plans: PLANS,
      expireOptions: EXPIRE_OPTIONS,
      minCustomMinutes: MIN_CUSTOM_MINUTES,
      multipartThreshold: MULTIPART_THRESHOLD,
      partSize: PART_SIZE,
      devMode: isDevMode(env),
    });
  }

  // ---------- 내 요금제 · 쓰는 용량 ----------
  if (path === "/api/me" && method === "GET") {
    const userId = await getUserId(env, request);
    if (!userId) return fail(401, "로그인이 필요해요.");
    const { plan, proUntil } = await planOf(db, userId);
    // 끝난 지 유예 안쪽인 프로, 또는 7일 안에 끝나는 프로: 갱신하지 않으면 닫힐 링크 수
    const last = proUntil ? { expires_at: proUntil } : await db.getPlan(userId).catch(() => null);
    let lapse: { proUntil: string; closesAt: string; links: number } | null = null;
    if (last) {
      const end = Date.parse(last.expires_at);
      const closesAt = end + PRO_GRACE_DAYS * DAY;
      if (end - Date.now() < PRO_GRACE_DAYS * DAY && closesAt > Date.now()) {
        const n = sharesToClose(await db.listOwnerShares(userId), last.expires_at).length;
        if (n > 0) lapse = { proUntil: last.expires_at, closesAt: new Date(closesAt).toISOString(), links: n };
      }
    }
    return json({
      plan: plan.id,
      proUntil,
      lapse,
      usedBytes: await usageOf(db, userId),
      quotaBytes: plan.quotaMb == null ? null : plan.quotaMb * MB,
    });
  }

  // ---------- 링크 만들기 ----------
  if (path === "/api/shares" && method === "POST") {
    const userId = await getUserId(env, request);
    const { plan, proUntil } = await planOf(db, userId);
    const body = (await request.json().catch(() => null)) as {
      title?: string;
      message?: string;
      password?: string;
      output?: Output;
      expireMinutes?: number;
      /** 마감 시각 직접 지정 (ISO) */
      expiresAt?: string;
      /** 프로 구독이 끝난 뒤까지 열리는 링크임을 확인했는지 */
      acceptBeyondPlan?: boolean;
      files?: { name?: string; size?: number }[];
    } | null;
    if (!body) return fail(400, "요청 형식이 올바르지 않아요.");

    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) return fail(400, "파일을 한 개 이상 올려 주세요.");
    if (files.length > plan.maxFiles) {
      return fail(400, plan.id === "guest" ? `나그네는 한 번에 ${plan.maxFiles}개까지예요. 로그인하면 더 올릴 수 있어요.` : `${plan.name}은 한 번에 ${plan.maxFiles}개까지 올릴 수 있어요.`);
    }
    let total = 0;
    for (const f of files) {
      const ext = extOf(String(f.name ?? ""));
      if (!ALLOWED.has(ext)) return fail(400, `이 형식은 올릴 수 없어요: ${cleanName(f.name)}`);
      const size = Number(f.size);
      if (!Number.isFinite(size) || size < 0) return fail(400, "파일 크기가 올바르지 않아요.");
      if (plan.maxFileMb != null && size > plan.maxFileMb * MB) {
        return fail(400, plan.id === "guest" ? `나그네는 파일 하나에 ${plan.maxFileMb}MB까지예요. 로그인하면 더 큰 파일도 올릴 수 있어요.` : `${plan.name}은 파일 하나에 ${plan.maxFileMb}MB까지예요. 프로는 파일 크기 제한이 없어요.`);
      }
      total += size * (isHangul(ext) && body.output === "both" ? 2 : 1);
    }
    if (userId && plan.quotaMb != null) {
      const used = await usageOf(db, userId);
      if (used + total > plan.quotaMb * MB) {
        const left = Math.max(0, plan.quotaMb * MB - used);
        return fail(400, `${plan.name}은 열려 있는 링크의 파일을 합쳐 ${sizeLabel(plan.quotaMb)}까지 둘 수 있어요. 지금 ${Math.floor(left / MB)}MB 남았어요. 배포 기록에서 다 쓴 링크를 닫으면 자리가 생겨요.`);
      }
    }
    const password = String(body.password ?? "");
    if (password.length < 4 || password.length > 64) return fail(400, "비밀번호는 4~64자로 정해 주세요.");
    const output: Output = OUTPUTS.has(body.output as Output) ? (body.output as Output) : "pdf";

    // 마감: 요금제가 고를 수 있는 삭제 시간, 또는 최대 기간 안에서 직접 정한 시각
    const now = new Date();
    let expiresAt: Date;
    if (body.expiresAt != null) {
      if (!plan.maxCustomMinutes) return fail(400, "마감 시각 직접 지정은 로그인하면 쓸 수 있어요.");
      const t = Date.parse(String(body.expiresAt));
      if (!Number.isFinite(t)) return fail(400, "마감 시각이 올바르지 않아요.");
      if (t < now.getTime() + (MIN_CUSTOM_MINUTES - 1) * 60000) return fail(400, `마감 시각은 지금부터 ${MIN_CUSTOM_MINUTES}분 뒤부터 정할 수 있어요.`);
      if (t > now.getTime() + plan.maxCustomMinutes * 60000 + 60000) {
        return fail(400, `${plan.name}은 마감을 ${plan.id === "pro" ? "1년" : `${plan.maxCustomMinutes / 1440}일`} 안에서 정할 수 있어요.`);
      }
      expiresAt = new Date(t);
    } else {
      const asked = Math.floor(Number(body.expireMinutes));
      const minutes = Number.isFinite(asked) ? asked : plan.defaultExpire;
      if (!plan.expireMinutes.includes(minutes)) {
        if (plan.id === "guest") return fail(400, "나그네는 10분 후 삭제만 쓸 수 있어요. 로그인하면 더 길게 고를 수 있어요.");
        if (EXPIRE_OPTIONS.some((o) => o.minutes === minutes)) return fail(400, "이 보관 기간은 프로에서 쓸 수 있어요.");
        return fail(400, "삭제 시간이 올바르지 않아요.");
      }
      expiresAt = new Date(now.getTime() + minutes * 60000);
    }
    if (plan.id === "pro" && proUntil && expiresAt.getTime() > Date.parse(proUntil) && !body.acceptBeyondPlan) {
      return json(
        { error: "프로 구독 기간 이후까지 열리는 링크예요. 확인이 필요해요.", code: "beyond_plan", proUntil },
        409,
      );
    }

    // 직접 칠 수 있게 짧은 코드. 겹치면 다시 뽑기 (32^6 ≈ 10억 가지)
    let id = randomCode();
    for (let i = 0; i < 5 && (await db.getShare(id)); i++) id = randomCode();
    const adminToken = randomToken();
    const share: ShareRow = {
      id,
      owner_id: userId,
      title: String(body.title ?? "").trim().slice(0, 100) || "배포 자료",
      message: String(body.message ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, 1000),
      output,
      password_hash: await hashPassword(password),
      admin_token_hash: await sha256(adminToken),
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      plan: plan.id,
    };
    const rows: FileRow[] = files.map((f, i) => ({
      id: randomId(8),
      share_id: id,
      position: i,
      original_name: cleanName(f.name),
      ext: extOf(String(f.name)) as FileRow["ext"],
      size: Number(f.size),
      status: "uploading",
      error: null,
      pdf_size: null,
      original_uploaded: false,
    }));
    await db.createShare(share, rows);
    return json({ id, adminToken, url: `${baseUrl(env, request)}/${id}`, files: rows.map((r) => ({ id: r.id, name: r.original_name })) }, 201);
  }

  // ---------- 내 배포 기록 ----------
  if (path === "/api/me/shares" && method === "GET") {
    const userId = await getUserId(env, request);
    if (!userId) return fail(401, "로그인이 필요해요.");
    return json({ shares: (await db.listOwnerShares(userId)).map((s) => summarize(env, request, s)) });
  }

  // 이 기기에서 만든 링크 (관리 토큰으로 확인)
  if (path === "/api/shares/lookup" && method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { links?: { id?: string; token?: string }[] };
    const links = (Array.isArray(body.links) ? body.links : [])
      .filter((l) => typeof l?.id === "string" && /^[A-Za-z0-9]{6,16}$/.test(l.id) && typeof l.token === "string")
      .slice(0, 60);
    const rows = await db.getShares(links.map((l) => l.id!));
    const out: ShareSummary[] = [];
    for (const s of rows) {
      const token = links.find((l) => l.id === s.id)?.token ?? "";
      if (safeEqual(await sha256(token), s.admin_token_hash)) out.push(summarize(env, request, s));
    }
    return json({ shares: out });
  }

  // ---------- 링크 관리 ----------
  if ((m = /^\/api\/shares\/([A-Za-z0-9]{6,16})\/manage$/.exec(path)) && method === "GET") {
    const share = await requireManager(env, db, request, m[1]);
    if (share instanceof Response) return share;
    return json({
      id: share.id,
      title: share.title,
      message: share.message ?? "",
      output: share.output,
      createdAt: share.created_at,
      expiresAt: share.expires_at,
      url: `${baseUrl(env, request)}/${share.id}`,
      files: share.files.map((f) => ({
        id: f.id,
        name: f.original_name,
        ext: f.ext,
        size: f.size,
        status: f.status,
        error: f.error,
        pdfSize: f.pdf_size,
      })),
    });
  }

  // ---------- 파일 올리기 (작은 파일: 한 번에, 큰 파일: 나눠서) ----------
  if ((m = /^\/api\/shares\/([A-Za-z0-9]{6,16})\/files\/([A-Za-z0-9]{6,16})(\/mpu(?:\/([A-Za-z0-9_.~-]+)(?:\/(\d+|complete))?)?)?$/.exec(path))) {
    const share = await requireManager(env, db, request, m[1]);
    if (share instanceof Response) return share;
    if (isExpired(share)) return fail(410, "닫힌 링크예요.");
    const file = share.files.find((f) => f.id === m![2]);
    if (!file) return fail(404, "파일을 찾을 수 없어요.");
    const kind = url.searchParams.get("kind") === "original" ? "original" : "pdf";
    if (kind === "original" && !needsOriginal(share, file)) return fail(400, "이 링크는 원본을 받지 않아요.");
    if (kind === "pdf" && !needsPdf(share, file)) return fail(400, "이 링크는 PDF를 받지 않아요.");
    const plan = planOfShare(share);
    // 원본(그리고 원래 PDF인 파일)은 처음 알린 크기 그대로, 브라우저에서 만든 PDF는 원본의 몇 배까지
    const exact = kind === "original" || file.ext === "pdf";
    const maxBytes = exact ? file.size : Math.max(file.size, 1 * MB) * PDF_SIZE_FACTOR;
    const objKey = key(share.id, file.id, kind, file.ext);
    const contentType = kind === "pdf" ? "application/pdf" : "application/octet-stream";

    // 한 번에 올리기
    if (!m[3] && method === "PUT") {
      const declared = Number(request.headers.get("Content-Length"));
      if (Number.isFinite(declared) && declared > Math.min(maxBytes, MAX_BODY_BYTES)) {
        return fail(413, declared > MAX_BODY_BYTES ? "큰 파일은 나눠 올려야 해요." : "처음에 고른 파일보다 커요.");
      }
      const data = await request.arrayBuffer();
      if (data.byteLength === 0) return fail(400, "빈 파일이에요.");
      if (data.byteLength > maxBytes) return fail(413, "처음에 고른 파일보다 커요.");
      if (exact && data.byteLength !== file.size) return fail(400, "처음에 고른 파일과 크기가 달라요.");
      if (kind === "pdf" && new TextDecoder().decode(data.slice(0, 5)) !== "%PDF-") return fail(400, "PDF 파일이 아니에요.");
      await env.BUCKET.put(objKey, data, { httpMetadata: { contentType } });
      return json({ status: await markUploaded(db, share, file, kind, data.byteLength) });
    }

    // 나눠 올리기 (R2 멀티파트). 원본이 MULTIPART_THRESHOLD 보다 큰 파일만
    if (!exact || file.size <= MULTIPART_THRESHOLD) return fail(400, "이 파일은 한 번에 올려 주세요.");
    if (plan.maxFileMb != null && file.size > plan.maxFileMb * MB) return fail(413, "요금제의 파일 크기 한도를 넘었어요.");
    const uploadId = m[4];
    if (!uploadId && method === "POST") {
      const mpu = await env.BUCKET.createMultipartUpload(objKey, { httpMetadata: { contentType } });
      return json({ uploadId: mpu.uploadId, partSize: PART_SIZE, parts: Math.ceil(file.size / PART_SIZE) });
    }
    if (!uploadId) return fail(405, "지원하지 않는 요청이에요.");
    const mpu = env.BUCKET.resumeMultipartUpload(objKey, uploadId);
    if (m[5] && m[5] !== "complete" && method === "PUT") {
      const n = Number(m[5]);
      const parts = Math.ceil(file.size / PART_SIZE);
      if (n < 1 || n > parts) return fail(400, "조각 번호가 올바르지 않아요.");
      const want = n < parts ? PART_SIZE : file.size - PART_SIZE * (parts - 1);
      const data = await request.arrayBuffer();
      if (data.byteLength !== want) return fail(400, "조각 크기가 올바르지 않아요.");
      try {
        const part = await mpu.uploadPart(n, data);
        return json({ partNumber: part.partNumber, etag: part.etag });
      } catch {
        return fail(409, "이어 올릴 수 없는 업로드예요. 처음부터 다시 올려 주세요.");
      }
    }
    if (m[5] === "complete" && method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { parts?: { partNumber: number; etag: string }[] };
      const parts = (body.parts ?? []).filter((p) => Number.isInteger(p?.partNumber) && typeof p?.etag === "string").sort((x, y) => x.partNumber - y.partNumber);
      if (parts.length !== Math.ceil(file.size / PART_SIZE)) return fail(400, "아직 다 올라오지 않았어요.");
      let obj: R2Object;
      try {
        obj = await mpu.complete(parts);
      } catch {
        return fail(409, "조각을 합치지 못했어요. 처음부터 다시 올려 주세요.");
      }
      if (obj.size !== file.size) {
        await env.BUCKET.delete(objKey);
        return fail(400, "처음에 고른 파일과 크기가 달라요.");
      }
      if (kind === "pdf") {
        const head = await env.BUCKET.get(objKey, { range: { offset: 0, length: 5 } });
        if (!head || (await head.text()) !== "%PDF-") {
          await env.BUCKET.delete(objKey);
          return fail(400, "PDF 파일이 아니에요.");
        }
      }
      return json({ status: await markUploaded(db, share, file, kind, obj.size) });
    }
    if (!m[5] && method === "DELETE") {
      await mpu.abort().catch(() => {});
      return json({ ok: true });
    }
    return fail(405, "지원하지 않는 요청이에요.");
  }

  if ((m = /^\/api\/shares\/([A-Za-z0-9]{6,16})\/files\/([A-Za-z0-9]{6,16})\/fail$/.exec(path)) && method === "POST") {
    const share = await requireManager(env, db, request, m[1]);
    if (share instanceof Response) return share;
    const file = share.files.find((f) => f.id === m![2]);
    if (!file) return fail(404, "파일을 찾을 수 없어요.");
    const body = (await request.json().catch(() => ({}))) as { error?: string };
    await db.updateFile(share.id, file.id, { status: "error", error: String(body.error || "PDF로 바꾸지 못했어요.").slice(0, 300) });
    return json({ ok: true });
  }

  if ((m = /^\/api\/shares\/([A-Za-z0-9]{6,16})\/close$/.exec(path)) && method === "POST") {
    const share = await requireManager(env, db, request, m[1]);
    if (share instanceof Response) return share;
    await closeShare(env, db, share);
    return json(summarize(env, request, share));
  }

  if ((m = /^\/api\/shares\/([A-Za-z0-9]{6,16})$/.exec(path)) && method === "DELETE") {
    const share = await requireManager(env, db, request, m[1]);
    if (share instanceof Response) return share;
    await removeShareFiles(env, share.id);
    await db.deleteShare(share.id);
    return json({ ok: true });
  }

  // ---------- 받는 사람 ----------
  if ((m = /^\/api\/s\/([A-Za-z0-9]{6,16})$/.exec(path)) && method === "GET") {
    const share = await db.getShare(m[1]);
    if (share?.closed_at) return fail(410, "올린 분이 이 링크를 닫았어요.");
    if (!share || isExpired(share)) return fail(404, "링크가 없거나 보관 기간이 지났어요.");
    return json({
      title: share.title,
      message: share.message ?? "",
      expiresAt: share.expires_at,
      fileCount: share.files.length,
      authed: await checkAccess(secretOf(env), share.id, cookies(request)[`sd_${share.id}`]),
    });
  }

  if ((m = /^\/api\/s\/([A-Za-z0-9]{6,16})\/auth$/.exec(path)) && method === "POST") {
    const share = await db.getShare(m[1]);
    if (!share || isExpired(share)) return fail(404, "링크가 없거나 보관 기간이 지났어요.");
    if (env.AUTH_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.AUTH_LIMITER.limit({ key: `${ip}:${share.id}` });
      if (!success) return fail(429, "비밀번호를 너무 많이 틀렸어요. 잠시 후 다시 해 주세요.");
    }
    const body = (await request.json().catch(() => ({}))) as { password?: string };
    if (!(await verifyPassword(String(body.password ?? ""), share.password_hash))) return fail(401, "비밀번호가 틀렸어요.");
    await db.countOpen(share.id).catch(() => {});
    const value = await signAccess(secretOf(env), share.id, ACCESS_TTL_MS);
    const secure = url.protocol === "https:" ? "; Secure" : "";
    return json({ ok: true }, 200, {
      "Set-Cookie": `sd_${share.id}=${value}; Path=/api/s/${share.id}; Max-Age=${ACCESS_TTL_MS / 1000}; HttpOnly; SameSite=Lax${secure}`,
    });
  }

  if ((m = /^\/api\/s\/([A-Za-z0-9]{6,16})\/files$/.exec(path)) && method === "GET") {
    const share = await requireViewer(env, db, request, m[1]);
    if (share instanceof Response) return share;
    return json({ title: share.title, message: share.message ?? "", expiresAt: share.expires_at, items: downloadItems(share) });
  }

  if ((m = /^\/api\/s\/([A-Za-z0-9]{6,16})\/download\/([A-Za-z0-9]{6,16})\/(pdf|original)$/.exec(path)) && method === "GET") {
    const share = await requireViewer(env, db, request, m[1]);
    if (share instanceof Response) return share;
    const kind = m[3] as "pdf" | "original";
    const item = downloadItems(share).find((i) => i.fileId === m![2] && i.kind === kind);
    const file = share.files.find((f) => f.id === m![2]);
    if (!item || !file) return fail(404, "파일을 찾을 수 없어요.");
    if (item.status !== "done") return fail(409, "아직 준비 중이에요.");
    const obj = await env.BUCKET.get(key(share.id, file.id, kind, file.ext));
    if (!obj) return fail(404, "파일을 찾을 수 없어요.");
    await db.countDownload(share.id, file.id).catch(() => {});
    return new Response(obj.body, {
      headers: {
        "Content-Type": kind === "pdf" ? "application/pdf" : "application/octet-stream",
        "Content-Length": String(obj.size),
        "Content-Disposition": contentDisposition(item.name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return fail(404, "없는 주소예요.");
}

/**
 * 정리 (5분마다 Cron. 시간이 지난 링크는 Cron 전에도 바로 열리지 않아요)
 * 1) 닫힌 링크의 파일을 R2에서 지우고 purged_at 표시 → 기록(제목 · 파일 이름 · 횟수)만 남음
 * 2) 파일을 지운 지 HISTORY_DAYS 가 지난 기록은 통째로 지움
 */
async function cleanup(env: Env) {
  const db = getDb(env);
  // 프로가 끝나고 유예가 지난 회원: 멤버십 한도를 넘는 링크를 닫음 (파일은 아래에서 지움)
  const lapsed = await db.listLapsedPro(new Date(Date.now() - PRO_GRACE_DAYS * DAY).toISOString(), 50).catch(() => []);
  for (const row of lapsed) {
    for (const s of sharesToClose(await db.listOwnerShares(row.user_id), row.expires_at)) await closeShare(env, db, s);
    await db.markEnforced(row.user_id);
  }

  for (let round = 0; round < 5; round++) {
    const ids = await db.listToPurge(100);
    if (ids.length === 0) break;
    const now = new Date().toISOString();
    for (const id of ids) {
      await removeShareFiles(env, id);
      await db.updateShare(id, { purged_at: now });
    }
  }
  for (let round = 0; round < 5; round++) {
    const ids = await db.listStale(100);
    if (ids.length === 0) break;
    for (const id of ids) {
      await removeShareFiles(env, id);
      await db.deleteShare(id);
    }
  }
}

/** 짧은 링크 코드 (worker/src/crypto.ts CODE_ALPHABET). vendor · links 같은 화면 경로와 겹치지 않음 */
const SHARE_PATH = /^[a-km-np-z2-9]{6}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url);

      // 받는 사람 화면: /<코드> (직접 치는 짧은 주소) 또는 예전 /s/<코드> → 정적 페이지 /s/
      // 대문자로 쳐도 열리게 소문자 주소로 보냄
      const code = /^\/(?:s\/)?([A-Za-z0-9]{6,16})\/?$/.exec(url.pathname);
      if (code && code[1] !== code[1].toLowerCase() && SHARE_PATH.test(code[1].toLowerCase())) {
        return Response.redirect(new URL(`/${code[1].toLowerCase()}`, url).toString(), 302);
      }
      if (code && (url.pathname.startsWith("/s/") || SHARE_PATH.test(code[1]))) {
        const res = await env.ASSETS.fetch(new Request(new URL("/s/", url), request));
        const out = new Response(res.body, res);
        out.headers.set("X-Robots-Tag", "noindex");
        out.headers.set("Referrer-Policy", "no-referrer");
        return out;
      }

      // 한글 렌더러 WASM(28MB)은 정적 파일 한도를 넘어 gzip 으로 두고 그대로 내보냅니다.
      if (url.pathname === "/vendor/rhwp_bg.wasm") {
        const res = await env.ASSETS.fetch(new Request(new URL("/vendor/rhwp_bg.wasm.gz", url), { headers: { "Accept-Encoding": "identity" } }));
        if (!res.ok) return res;
        return new Response(res.body, {
          encodeBody: "manual",
          headers: {
            "Content-Type": "application/wasm",
            "Content-Encoding": "gzip",
            "Cache-Control": "public, max-age=604800",
          },
        });
      }

      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return fail(500, "서버 오류가 났어요. 잠시 후 다시 해 주세요.");
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanup(env));
  },
} satisfies ExportedHandler<Env>;
