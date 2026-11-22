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
  DEFAULT_EXPIRE_DAYS?: string;
  MAX_EXPIRE_DAYS?: string;
}

export type Output = "pdf" | "original" | "both";
/** 변환은 올리는 사람의 브라우저에서 하므로 서버 상태는 uploading → done | error */
export type FileStatus = "uploading" | "converting" | "done" | "error";

export interface FileRow {
  id: string;
  share_id: string;
  position: number;
  original_name: string;
  ext: "hwp" | "hwpx" | "pdf";
  size: number;
  status: FileStatus;
  error: string | null;
  pdf_size: number | null;
  original_uploaded: boolean;
  created_at?: string;
}

export interface ShareRow {
  id: string;
  owner_id: string | null;
  title: string;
  output: Output;
  password_hash: string;
  admin_token_hash: string;
  created_at: string;
  expires_at: string;
}

export interface ShareWithFiles extends ShareRow {
  files: FileRow[];
}

export interface OwnerShareSummary {
  id: string;
  title: string;
  createdAt: string;
  expiresAt: string;
  fileCount: number;
}
