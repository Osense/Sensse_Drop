/**
 * 쎈스드롭 Cloudflare Worker
 *
 * - 정적 화면(web/out)은 Workers 정적 자산으로 제공하고, /api/* · /s/* · /vendor/rhwp_bg.wasm 만 이 코드가 받습니다.
 * - 파일은 R2(BUCKET), 링크 정보는 Supabase WSNS 프로젝트(sd_shares · sd_files)에 둡니다.
 * - HWP/HWPX → PDF 변환은 올리는 사람의 브라우저에서 끝내고 PDF를 올립니다. 서버는 변환하지 않습니다.
 */
import { checkAccess, hashPassword, randomId, randomToken, safeEqual, sha256, signAccess, verifyPassword } from "./crypto";
import { getDb, getUserId, isDevMode, type Db } from "./db";
import type { Env, FileRow, Output, ShareRow, ShareWithFiles } from "./types";

const ACCESS_TTL_MS = 12 * 60 * 60 * 1000;
const ALLOWED_EXT = new Set(["hwp", "hwpx", "pdf"]);
const OUTPUTS = new Set<Output>(["pdf", "original", "both"]);
/** 브라우저에서 만든 PDF 는 쪽 그림이라 원본보다 커질 수 있어 원본 한도의 이 배수까지 받습니다 */
const PDF_SIZE_FACTOR = 4;
const MAX_BODY_BYTES = 95 * 1024 * 1024; // Workers 요청 본문 한도(100MB) 안쪽

type Limits = { maxFiles: number; maxFileMb: number };

function num(v: string | undefined, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function limitsFor(env: Env, member: boolean): Limits {
  return member
    ? { maxFiles: num(env.MEMBER_MAX_FILES, 10), maxFileMb: num(env.MEMBER_MAX_FILE_MB, 20) }
    : { maxFiles: num(env.GUEST_MAX_FILES, 2), maxFileMb: num(env.GUEST_MAX_FILE_MB, 5) };
}

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

const needsPdf = (share: ShareRow, f: FileRow) => f.ext === "pdf" || share.output !== "original";
const needsOriginal = (share: ShareRow, f: FileRow) => f.ext !== "pdf" && share.output !== "pdf";

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
      guest: limitsFor(env, false),
      member: limitsFor(env, true),
      defaultExpireDays: num(env.DEFAULT_EXPIRE_DAYS, 7),
      maxExpireDays: num(env.MAX_EXPIRE_DAYS, 30),
      devMode: isDevMode(env),
    });
  }

  // ---------- 링크 만들기 ----------
  if (path === "/api/shares" && method === "POST") {
    const userId = await getUserId(env, request);
    const limits = limitsFor(env, Boolean(userId));
    const body = (await request.json().catch(() => null)) as {
      title?: string;
      password?: string;
      output?: Output;
      expireDays?: number;
      files?: { name?: string; size?: number }[];
    } | null;
    if (!body) return fail(400, "요청 형식이 올바르지 않아요.");

    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) return fail(400, "파일을 한 개 이상 올려 주세요.");
    if (files.length > limits.maxFiles) {
      return fail(400, userId ? `한 번에 ${limits.maxFiles}개까지 올릴 수 있어요.` : `비회원은 한 번에 ${limits.maxFiles}개까지예요. 로그인하면 더 올릴 수 있어요.`);
    }
    for (const f of files) {
      const ext = extOf(String(f.name ?? ""));
      if (!ALLOWED_EXT.has(ext)) return fail(400, `HWP · HWPX · PDF만 올릴 수 있어요: ${cleanName(f.name)}`);
      const size = Number(f.size);
      if (!Number.isFinite(size) || size < 0) return fail(400, "파일 크기가 올바르지 않아요.");
      if (size > limits.maxFileMb * 1048576) {
        return fail(400, userId ? `파일 하나는 ${limits.maxFileMb}MB까지예요.` : `비회원은 파일 하나에 ${limits.maxFileMb}MB까지예요. 로그인하면 더 큰 파일도 올릴 수 있어요.`);
      }
    }
    const password = String(body.password ?? "");
    if (password.length < 4 || password.length > 64) return fail(400, "비밀번호는 4~64자로 정해 주세요.");
    const output: Output = OUTPUTS.has(body.output as Output) ? (body.output as Output) : "pdf";
    const maxDays = num(env.MAX_EXPIRE_DAYS, 30);
    let days = Math.floor(Number(body.expireDays));
    if (!Number.isFinite(days) || days < 1) days = num(env.DEFAULT_EXPIRE_DAYS, 7);
    days = Math.min(days, maxDays);

    const id = randomId(10);
    const adminToken = randomToken();
    const now = new Date();
    const share: ShareRow = {
      id,
      owner_id: userId,
      title: String(body.title ?? "").trim().slice(0, 100) || "배포 자료",
      output,
      password_hash: await hashPassword(password),
      admin_token_hash: await sha256(adminToken),
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + days * 86400000).toISOString(),
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
    return json({ id, adminToken, url: `${baseUrl(env, request)}/s/${id}`, files: rows.map((r) => ({ id: r.id, name: r.original_name })) }, 201);
  }

  // ---------- 회원: 내 링크 ----------
  if (path === "/api/me/shares" && method === "GET") {
    const userId = await getUserId(env, request);
    if (!userId) return fail(401, "로그인이 필요해요.");
    return json({ shares: await db.listOwnerShares(userId) });
  }

  // ---------- 링크 관리 ----------
  if ((m = /^\/api\/shares\/([A-Za-z0-9]{8,16})\/manage$/.exec(path)) && method === "GET") {
    const share = await requireManager(env, db, request, m[1]);
    if (share instanceof Response) return share;
    return json({
      id: share.id,
      title: share.title,
      output: share.output,
      createdAt: share.created_at,
      expiresAt: share.expires_at,
      url: `${baseUrl(env, request)}/s/${share.id}`,
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

  if ((m = /^\/api\/shares\/([A-Za-z0-9]{8,16})\/files\/([A-Za-z0-9]{6,16})$/.exec(path)) && method === "PUT") {
    const share = await requireManager(env, db, request, m[1]);
    if (share instanceof Response) return share;
    if (isExpired(share)) return fail(410, "보관 기간이 지난 링크예요.");
    const file = share.files.find((f) => f.id === m![2]);
    if (!file) return fail(404, "파일을 찾을 수 없어요.");
    const kind = url.searchParams.get("kind") === "original" ? "original" : "pdf";
    if (kind === "original" && !needsOriginal(share, file)) return fail(400, "이 링크는 원본을 받지 않아요.");
    if (kind === "pdf" && !needsPdf(share, file)) return fail(400, "이 링크는 PDF를 받지 않아요.");

    const limits = limitsFor(env, Boolean(share.owner_id));
    const maxBytes = Math.min(
      MAX_BODY_BYTES,
      limits.maxFileMb * 1048576 * (kind === "pdf" && file.ext !== "pdf" ? PDF_SIZE_FACTOR : 1),
    );
    const declared = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declared) && declared > maxBytes) return fail(413, `파일이 너무 커요 (최대 ${Math.round(maxBytes / 1048576)}MB).`);
    const data = await request.arrayBuffer();
    if (data.byteLength === 0) return fail(400, "빈 파일이에요.");
    if (data.byteLength > maxBytes) return fail(413, `파일이 너무 커요 (최대 ${Math.round(maxBytes / 1048576)}MB).`);
    if (kind === "pdf" && new TextDecoder().decode(data.slice(0, 5)) !== "%PDF-") return fail(400, "PDF 파일이 아니에요.");
    if (kind === "original" && data.byteLength !== file.size) return fail(400, "처음에 고른 파일과 크기가 달라요.");

    await env.BUCKET.put(key(share.id, file.id, kind, file.ext), data, {
      httpMetadata: { contentType: kind === "pdf" ? "application/pdf" : "application/octet-stream" },
    });
    const next: FileRow = { ...file };
    if (kind === "pdf") Object.assign(next, { pdf_size: data.byteLength, error: null });
    else next.original_uploaded = true;
    if (next.status === "error" && kind === "pdf") next.status = "uploading";
    next.status = computeStatus(share, next);
    await db.updateFile(share.id, file.id, {
      pdf_size: next.pdf_size,
      original_uploaded: next.original_uploaded,
      status: next.status,
      error: next.error,
    });
    return json({ status: next.status });
  }

  if ((m = /^\/api\/shares\/([A-Za-z0-9]{8,16})\/files\/([A-Za-z0-9]{6,16})\/fail$/.exec(path)) && method === "POST") {
    const share = await requireManager(env, db, request, m[1]);
    if (share instanceof Response) return share;
    const file = share.files.find((f) => f.id === m![2]);
    if (!file) return fail(404, "파일을 찾을 수 없어요.");
    const body = (await request.json().catch(() => ({}))) as { error?: string };
    await db.updateFile(share.id, file.id, { status: "error", error: String(body.error || "PDF로 바꾸지 못했어요.").slice(0, 300) });
    return json({ ok: true });
  }

  if ((m = /^\/api\/shares\/([A-Za-z0-9]{8,16})$/.exec(path)) && method === "DELETE") {
    const share = await requireManager(env, db, request, m[1]);
    if (share instanceof Response) return share;
    await removeShareFiles(env, share.id);
    await db.deleteShare(share.id);
    return json({ ok: true });
  }

  // ---------- 받는 사람 ----------
  if ((m = /^\/api\/s\/([A-Za-z0-9]{8,16})$/.exec(path)) && method === "GET") {
    const share = await db.getShare(m[1]);
    if (!share || isExpired(share)) return fail(404, "링크가 없거나 보관 기간이 지났어요.");
    return json({
      title: share.title,
      expiresAt: share.expires_at,
      fileCount: share.files.length,
      authed: await checkAccess(secretOf(env), share.id, cookies(request)[`sd_${share.id}`]),
    });
  }

  if ((m = /^\/api\/s\/([A-Za-z0-9]{8,16})\/auth$/.exec(path)) && method === "POST") {
    const share = await db.getShare(m[1]);
    if (!share || isExpired(share)) return fail(404, "링크가 없거나 보관 기간이 지났어요.");
    if (env.AUTH_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.AUTH_LIMITER.limit({ key: `${ip}:${share.id}` });
      if (!success) return fail(429, "비밀번호를 너무 많이 틀렸어요. 잠시 후 다시 해 주세요.");
    }
    const body = (await request.json().catch(() => ({}))) as { password?: string };
    if (!(await verifyPassword(String(body.password ?? ""), share.password_hash))) return fail(401, "비밀번호가 틀렸어요.");
    const value = await signAccess(secretOf(env), share.id, ACCESS_TTL_MS);
    const secure = url.protocol === "https:" ? "; Secure" : "";
    return json({ ok: true }, 200, {
      "Set-Cookie": `sd_${share.id}=${value}; Path=/api/s/${share.id}; Max-Age=${ACCESS_TTL_MS / 1000}; HttpOnly; SameSite=Lax${secure}`,
    });
  }

  if ((m = /^\/api\/s\/([A-Za-z0-9]{8,16})\/files$/.exec(path)) && method === "GET") {
    const share = await requireViewer(env, db, request, m[1]);
    if (share instanceof Response) return share;
    return json({ title: share.title, expiresAt: share.expires_at, items: downloadItems(share) });
  }

  if ((m = /^\/api\/s\/([A-Za-z0-9]{8,16})\/download\/([A-Za-z0-9]{6,16})\/(pdf|original)$/.exec(path)) && method === "GET") {
    const share = await requireViewer(env, db, request, m[1]);
    if (share instanceof Response) return share;
    const kind = m[3] as "pdf" | "original";
    const item = downloadItems(share).find((i) => i.fileId === m![2] && i.kind === kind);
    const file = share.files.find((f) => f.id === m![2]);
    if (!item || !file) return fail(404, "파일을 찾을 수 없어요.");
    if (item.status !== "done") return fail(409, "아직 준비 중이에요.");
    const obj = await env.BUCKET.get(key(share.id, file.id, kind, file.ext));
    if (!obj) return fail(404, "파일을 찾을 수 없어요.");
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

/** 만료된 링크와 파일 정리 (매시간 Cron) */
async function cleanup(env: Env) {
  const db = getDb(env);
  for (let round = 0; round < 5; round++) {
    const ids = await db.listExpired(100);
    if (ids.length === 0) break;
    for (const id of ids) {
      await removeShareFiles(env, id);
      await db.deleteShare(id);
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url);

      // 받는 사람 화면: /s/<링크> → 정적 페이지 /s/
      if (/^\/s\/[A-Za-z0-9]+\/?$/.test(url.pathname)) {
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
