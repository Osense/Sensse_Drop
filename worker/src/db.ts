import type { Env, FileRow, ShareRow, ShareWithFiles } from "./types";

/** 닫힌 링크의 기록을 남겨 두는 기간 */
export const HISTORY_DAYS = 30;

/** 공유 링크 저장소. 운영은 Supabase(WSNS 프로젝트), 개발은 메모리 */
export interface Db {
  createShare(share: ShareRow, files: FileRow[]): Promise<void>;
  getShare(id: string): Promise<ShareWithFiles | null>;
  updateFile(shareId: string, fileId: string, patch: Partial<FileRow>): Promise<void>;
  updateShare(id: string, patch: Partial<ShareRow>): Promise<void>;
  deleteShare(id: string): Promise<void>;
  /** 회원의 링크 (닫힌 기록 포함, 최근 200개) */
  listOwnerShares(ownerId: string): Promise<ShareWithFiles[]>;
  getShares(ids: string[]): Promise<ShareWithFiles[]>;
  countOpen(id: string): Promise<void>;
  /** 프로 이용 기간 (없으면 null) */
  getPlan(userId: string): Promise<{ plan: "pro"; expires_at: string } | null>;
  /** 유예가 끝났는데 아직 정리하지 않은 프로 (user_id, expires_at) */
  listLapsedPro(before: string, limit: number): Promise<{ user_id: string; expires_at: string }[]>;
  markEnforced(userId: string): Promise<void>;
  countDownload(shareId: string, fileId: string): Promise<void>;
  /** 닫혔는데 파일을 아직 안 지운 링크 */
  listToPurge(limit: number): Promise<string[]>;
  /** 파일을 지운 지 HISTORY_DAYS 가 지난 기록 */
  listStale(limit: number): Promise<string[]>;
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

  async updateShare(id: string, patch: Partial<ShareRow>) {
    await this.req(`sd_shares?id=eq.${encodeURIComponent(id)}`, {
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
      `sd_shares?owner_id=eq.${encodeURIComponent(ownerId)}&select=*,files:sd_files(*)&files.order=position.asc&order=created_at.desc&limit=200`,
    );
    return (await res.json()) as ShareWithFiles[];
  }

  async getShares(ids: string[]) {
    if (ids.length === 0) return [];
    const list = ids.map((i) => encodeURIComponent(i)).join(",");
    const res = await this.req(`sd_shares?id=in.(${list})&select=*,files:sd_files(*)&files.order=position.asc`);
    return (await res.json()) as ShareWithFiles[];
  }

  private async rpc(fn: string, args: Record<string, string>) {
    await this.req(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  }

  async countOpen(id: string) {
    await this.rpc("sd_count_open", { p_share: id });
  }

  async listLapsedPro(before: string, limit: number) {
    const res = await this.req(`sd_plans?expires_at=lt.${encodeURIComponent(before)}&enforced_at=is.null&select=user_id,expires_at&limit=${limit}`);
    return (await res.json()) as { user_id: string; expires_at: string }[];
  }

  async markEnforced(userId: string) {
    await this.req(`sd_plans?user_id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify({ enforced_at: new Date().toISOString() }),
      headers: { Prefer: "return=minimal" },
    });
  }

  async getPlan(userId: string) {
    const res = await this.req(`sd_plans?user_id=eq.${encodeURIComponent(userId)}&select=plan,expires_at`);
    return ((await res.json()) as { plan: "pro"; expires_at: string }[])[0] ?? null;
  }

  async countDownload(shareId: string, fileId: string) {
    await this.rpc("sd_count_download", { p_share: shareId, p_file: fileId });
  }

  async listToPurge(limit: number) {
    const now = new Date().toISOString();
    const res = await this.req(`sd_shares?expires_at=lt.${encodeURIComponent(now)}&purged_at=is.null&select=id&limit=${limit}`);
    return ((await res.json()) as { id: string }[]).map((r) => r.id);
  }

  async listStale(limit: number) {
    const before = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString();
    // 30일 지난 기록, 그리고 탈퇴한 회원의 기록은 파일을 지운 즉시
    const res = await this.req(
      `sd_shares?or=(purged_at.lt.${encodeURIComponent(before)},and(orphaned_at.not.is.null,purged_at.not.is.null))&select=id&limit=${limit}`,
    );
    return ((await res.json()) as { id: string }[]).map((r) => r.id);
  }

}

const DEV_PRO = "00000000-0000-4000-8000-000000000002";

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
  async updateShare(id: string, patch: Partial<ShareRow>) {
    const s = mem.get(id);
    if (s) Object.assign(s, patch);
  }
  async deleteShare(id: string) {
    mem.delete(id);
  }
  async listOwnerShares(ownerId: string) {
    return structuredClone([...mem.values()].filter((s) => s.owner_id === ownerId).sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }
  async getShares(ids: string[]) {
    return structuredClone(ids.map((i) => mem.get(i)).filter((s): s is ShareWithFiles => Boolean(s)));
  }
  async listLapsedPro() {
    return [];
  }
  async markEnforced() {}
  async getPlan(userId: string) {
    return userId === DEV_PRO ? { plan: "pro" as const, expires_at: new Date(Date.now() + 365 * 86400000).toISOString() } : null;
  }
  async countOpen(id: string) {
    const s = mem.get(id);
    if (s) s.open_count = (s.open_count ?? 0) + 1;
  }
  async countDownload(shareId: string, fileId: string) {
    const f = mem.get(shareId)?.files.find((x) => x.id === fileId);
    if (f) f.download_count = (f.download_count ?? 0) + 1;
  }
  async listToPurge(limit: number) {
    const now = Date.now();
    return [...mem.values()].filter((s) => Date.parse(s.expires_at) < now && !s.purged_at).slice(0, limit).map((s) => s.id);
  }
  async listStale(limit: number) {
    const before = Date.now() - HISTORY_DAYS * 86400000;
    return [...mem.values()].filter((s) => s.purged_at && (Date.parse(s.purged_at) < before || s.orphaned_at)).slice(0, limit).map((s) => s.id);
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
  if (isDevMode(env)) return m[1] === "dev-member" ? "00000000-0000-4000-8000-000000000001" : m[1] === "dev-pro" ? DEV_PRO : null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${m[1]}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  return user.id ?? null;
}
