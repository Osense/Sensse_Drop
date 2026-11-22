import type { Env, FileRow, OwnerShareSummary, ShareRow, ShareWithFiles } from "./types";

/** 공유 링크 저장소. 운영은 Supabase(WSNS 프로젝트), 개발은 메모리 */
export interface Db {
  createShare(share: ShareRow, files: FileRow[]): Promise<void>;
  getShare(id: string): Promise<ShareWithFiles | null>;
  updateFile(shareId: string, fileId: string, patch: Partial<FileRow>): Promise<void>;
  deleteShare(id: string): Promise<void>;
  listOwnerShares(ownerId: string): Promise<OwnerShareSummary[]>;
  listExpired(limit: number): Promise<string[]>;
}

class SupabaseDb implements Db {
  constructor(
    private url: string,
    private key: string,
  ) {}

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("apikey", this.key);
    // 예전 service_role JWT 키라면 Authorization 도 필요
    if (this.key.startsWith("eyJ")) headers.set("Authorization", `Bearer ${this.key}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const res = await fetch(`${this.url}/rest/v1/${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`DB ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  async createShare(share: ShareRow, files: FileRow[]) {
    await this.req("sd_shares", { method: "POST", body: JSON.stringify(share), headers: { Prefer: "return=minimal" } });
    try {
      await this.req("sd_files", { method: "POST", body: JSON.stringify(files), headers: { Prefer: "return=minimal" } });
    } catch (e) {
      await this.deleteShare(share.id).catch(() => {});
      throw e;
    }
  }

  async getShare(id: string) {
    const res = await this.req(
      `sd_shares?id=eq.${encodeURIComponent(id)}&select=*,files:sd_files(*)&files.order=position.asc`,
    );
    const rows = (await res.json()) as ShareWithFiles[];
    return rows[0] ?? null;
  }

  async updateFile(shareId: string, fileId: string, patch: Partial<FileRow>) {
    await this.req(`sd_files?id=eq.${encodeURIComponent(fileId)}&share_id=eq.${encodeURIComponent(shareId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
      headers: { Prefer: "return=minimal" },
    });
  }

  async deleteShare(id: string) {
    await this.req(`sd_shares?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }

  async listOwnerShares(ownerId: string) {
    const res = await this.req(
      `sd_shares?owner_id=eq.${encodeURIComponent(ownerId)}&select=id,title,created_at,expires_at,files:sd_files(count)&order=created_at.desc&limit=100`,
    );
    const rows = (await res.json()) as { id: string; title: string; created_at: string; expires_at: string; files: { count: number }[] }[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      fileCount: r.files?.[0]?.count ?? 0,
    }));
  }

  async listExpired(limit: number) {
    const now = new Date().toISOString();
    const res = await this.req(`sd_shares?expires_at=lt.${encodeURIComponent(now)}&select=id&limit=${limit}`);
    return ((await res.json()) as { id: string }[]).map((r) => r.id);
  }
}

/** 개발용 메모리 DB (wrangler dev 에서 SUPABASE_SECRET_KEY 가 없을 때) */
const mem = new Map<string, ShareWithFiles>();
class MemoryDb implements Db {
  async createShare(share: ShareRow, files: FileRow[]) {
    mem.set(share.id, structuredClone({ ...share, files }));
  }
  async getShare(id: string) {
    const s = mem.get(id);
    return s ? structuredClone(s) : null;
  }
  async updateFile(shareId: string, fileId: string, patch: Partial<FileRow>) {
    const f = mem.get(shareId)?.files.find((x) => x.id === fileId);
    if (f) Object.assign(f, patch);
  }
  async deleteShare(id: string) {
    mem.delete(id);
  }
  async listOwnerShares(ownerId: string) {
    return [...mem.values()]
      .filter((s) => s.owner_id === ownerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((s) => ({ id: s.id, title: s.title, createdAt: s.created_at, expiresAt: s.expires_at, fileCount: s.files.length }));
  }
  async listExpired(limit: number) {
    const now = Date.now();
    return [...mem.values()].filter((s) => Date.parse(s.expires_at) < now).slice(0, limit).map((s) => s.id);
  }
}

export function isDevMode(env: Env) {
  return !env.SUPABASE_SECRET_KEY;
}

export function getDb(env: Env): Db {
  return env.SUPABASE_SECRET_KEY ? new SupabaseDb(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY) : new MemoryDb();
}

/** Supabase 로그인 토큰 → 회원 id. 개발 모드에서는 "dev-member" 토큰을 회원으로 봅니다. */
export async function getUserId(env: Env, request: Request): Promise<string | null> {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  if (isDevMode(env)) return m[1] === "dev-member" ? "00000000-0000-4000-8000-000000000001" : null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${m[1]}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  return user.id ?? null;
}
