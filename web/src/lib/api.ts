import { STATIC_ONLY } from "./config";
export type Limits = { maxFiles: number; maxFileMb: number };

export type AppConfig = {
  guest: Limits;
  member: Limits;
  expireOptions: { minutes: number; label: string }[];
  guestExpireMinutes: number[];
  defaultExpireMinutes: { guest: number; member: number };
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

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
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
  if (!res.ok) throw new ApiError(data?.error || `요청에 실패했어요 (${res.status})`, res.status);
  return data as T;
}

/** 이 기기에서 만든 링크 (비회원 관리용 토큰 보관) */
export type LocalLink = { id: string; adminToken: string; title: string; createdAt: string };
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
