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
  /** 잠긴 파일 이름 (암호화 링크). name 은 '파일 1.hwp' 같은 자리 표시 */
  nameEnc?: string | null;
  /** 수합 링크: 낸 사람 이름 */
  submitter?: string | null;
  createdAt?: string | null;
};

/** 수합(과제 걷기) 링크 설정 */
export type CollectSettings = {
  perPerson: number;
  nameLabel: string;
  roster: string[];
  deadline: string | null;
  closedAt: string | null;
  hasPassword?: boolean;
};

/** 학생 화면에 보이는 수합 링크 정보 (/api/s/<코드>) */
export type CollectInfo = {
  kind: "collect";
  title: string;
  message: string;
  expiresAt: string;
  /** 제출을 받는 마지막 시각 */
  deadline: string;
  open: boolean;
  needsPassword: boolean;
  perPerson: number;
  nameLabel: string;
  maxFileMb: number | null;
};

export type ManagedShare = {
  id: string;
  title: string;
  message?: string;
  output: "pdf" | "original" | "both";
  createdAt: string;
  expiresAt: string;
  url: string;
  /** 종단간 암호화 정보. 비밀번호를 알아야 wrap 을 풀 수 있어요 */
  enc?: { iter: number; salt: string; wrap: string | null; pepper: string } | null;
  files: ManagedFile[];
  kind?: "share" | "collect";
  collect?: CollectSettings | null;
  purged?: boolean;
};

export type DownloadItem = {
  fileId: string;
  kind: "pdf" | "original";
  name: string;
  nameEnc?: string | null;
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
  kind?: "share" | "collect";
  /** 수합 링크: 낸 사람 수 */
  submitters?: number;
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

/** 파일 받기 (관리자 헤더가 필요해 링크 대신 fetch 로) */
export async function apiBlob(url: string, init?: RequestInit): Promise<Blob> {
  if (STATIC_ONLY) return (await import("./mock-api")).mockBlob(url, init);
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError("서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.", 0);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(data?.error || `받지 못했어요 (${res.status})`, res.status);
  }
  return res.blob();
}

/** 수합 링크에 이 기기에서 낸 제출 (취소 · 확인용 토큰) */
export type LocalSubmission = { token: string; name: string; at: string };
const SUB_KEY = (id: string) => `sensedrop.submit.${id}`;
export const localSubmissions = {
  all(id: string): LocalSubmission[] {
    try {
      return JSON.parse(localStorage.getItem(SUB_KEY(id)) || "[]") as LocalSubmission[];
    } catch {
      return [];
    }
  },
  add(id: string, s: LocalSubmission) {
    try {
      localStorage.setItem(SUB_KEY(id), JSON.stringify([s, ...localSubmissions.all(id)].slice(0, 20)));
    } catch {}
  },
  remove(id: string, token: string) {
    try {
      localStorage.setItem(SUB_KEY(id), JSON.stringify(localSubmissions.all(id).filter((x) => x.token !== token)));
    } catch {}
  },
};

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
