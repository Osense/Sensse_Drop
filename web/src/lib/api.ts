import { STATIC_ONLY } from "./config";
import type { Plan, PlanId } from "./plans";

export type AppConfig = {
  plans: Record<PlanId, Plan>;
  expireOptions: { minutes: number; label: string }[];
  minCustomMinutes: number;
  multipartThreshold: number;
  partSize: number;
};

/** 내 요금제 · 쓰는 용량 (/api/me) */
export type MeInfo = {
  plan: PlanId;
  proUntil: string | null;
  /** 프로가 곧 끝나거나 끝난 지 유예 안쪽: 갱신하지 않으면 닫힐 링크 */
  lapse: { proUntil: string; closesAt: string; links: number } | null;
  usedBytes: number;
  quotaBytes: number | null;
};

export type FileStatus = "uploading" | "converting" | "done" | "error";

export type ManagedFile = {
  id: string;
  name: string;
  ext: string;
  size: number;
  status: FileStatus;
  error: string | null;
  pdfSize: number | null;
};

export type ManagedShare = {
  id: string;
  title: string;
  message?: string;
  output: "pdf" | "original" | "both";
  createdAt: string;
  expiresAt: string;
  url: string;
  files: ManagedFile[];
};

export type DownloadItem = {
  fileId: string;
  kind: "pdf" | "original";
  name: string;
  status: FileStatus;
  size: number | null;
};

/** 내 배포 기록 한 줄 (worker ShareSummary 와 같음) */
export type ShareSummary = {
  id: string;
  title: string;
  message: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
  /** open: 받을 수 있음 · closed: 직접 닫음 · expired: 정한 시간이 지남 */
  state: "open" | "closed" | "expired";
  /** 파일을 이미 지웠는지 */
  purged: boolean;
  /** 기록이 저절로 지워지는 시각 */
  forgetAt: string | null;
  member: boolean;
  opens: number;
  downloads: number;
  /** 지금 차지하는 저장 공간 */
  bytes: number;
  files: { id: string; name: string; ext: string; size: number; downloads: number }[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  // 서버 없는 미리보기판(GitHub Pages): 이 브라우저 안의 체험판 서버로
  if (STATIC_ONLY) return (await import("./mock-api")).mockApi<T>(url, init);
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError("서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.", 0);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new ApiError(data?.error || `요청에 실패했어요 (${res.status})`, res.status, (data ?? undefined) as Record<string, unknown> | undefined);
  return data as T;
}

/** 이 기기에서 만든 링크 (비회원 관리용 토큰 보관) */
export type LocalLink = { id: string; adminToken: string; title: string; createdAt: string; expiresAt?: string };
const KEY = "sensedrop.links";

export const localLinks = {
  all(): LocalLink[] {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "[]") as LocalLink[];
    } catch {
      return [];
    }
  },
  add(link: LocalLink) {
    try {
      localStorage.setItem(KEY, JSON.stringify([link, ...localLinks.all().filter((l) => l.id !== link.id)].slice(0, 50)));
    } catch {}
  },
  remove(id: string) {
    try {
      localStorage.setItem(KEY, JSON.stringify(localLinks.all().filter((l) => l.id !== id)));
    } catch {}
  },
  token(id: string) {
    return localLinks.all().find((l) => l.id === id)?.adminToken;
  },
};
