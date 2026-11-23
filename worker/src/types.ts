export interface Env {
  ASSETS: Fetcher;
  BUCKET: R2Bucket;
  AUTH_LIMITER?: RateLimit;

  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  /** secret: Supabase secret(service_role) 키. 없으면 개발용 메모리 DB */
  SUPABASE_SECRET_KEY?: string;
  /** secret: 열람 쿠키 서명용. 없으면 SUPABASE_SECRET_KEY 로 대신 */
  SESSION_SECRET?: string;
  PUBLIC_URL?: string;

  GUEST_MAX_FILES?: string;
  GUEST_MAX_FILE_MB?: string;
  MEMBER_MAX_FILES?: string;
  MEMBER_MAX_FILE_MB?: string;
}

export type Output = "pdf" | "original" | "both";
/** 변환은 올리는 사람의 브라우저에서 하므로 서버 상태는 uploading → done | error */
export type FileStatus = "uploading" | "converting" | "done" | "error";

export interface FileRow {
  id: string;
  share_id: string;
  position: number;
  original_name: string;
  ext: string;
  size: number;
  status: FileStatus;
  error: string | null;
  pdf_size: number | null;
  original_uploaded: boolean;
  /** 받는 사람이 내려받은 횟수 */
  download_count?: number;
  created_at?: string;
}

export interface ShareRow {
  id: string;
  owner_id: string | null;
  title: string;
  /** 받는 사람에게 보일 안내 메시지 (자료 설명 · 인사말) */
  message: string;
  output: Output;
  password_hash: string;
  admin_token_hash: string;
  created_at: string;
  expires_at: string;
  /** 올린 사람이 시간 전에 직접 닫은 시각 */
  closed_at?: string | null;
  /** 닫힌 뒤 파일을 지운 시각 (기록은 30일 더 남음) */
  purged_at?: string | null;
  /** 비밀번호를 넣고 들어온 횟수 */
  open_count?: number;
}

export interface ShareWithFiles extends ShareRow {
  files: FileRow[];
}

/** 내 배포 기록 한 줄 */
export interface ShareSummary {
  id: string;
  title: string;
  message: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
  /** open: 받을 수 있음 · closed: 직접 닫음 · expired: 정한 시간이 지남 */
  state: "open" | "closed" | "expired";
  /** 파일이 이미 지워졌는지 */
  purged: boolean;
  /** 기록이 저절로 지워지는 시각 */
  forgetAt: string | null;
  member: boolean;
  opens: number;
  downloads: number;
  /** 지금 차지하는 저장 공간 (닫힌 링크는 0) */
  bytes: number;
  files: { id: string; name: string; ext: string; size: number; downloads: number }[];
}
