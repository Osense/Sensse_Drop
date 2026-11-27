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
  /** secret: 파일 열쇠 pepper 용 (종단간 암호화). 없으면 SESSION_SECRET 등으로 대신 */
  FILE_KEY_SECRET?: string;
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
  /** 잠긴 파일 이름 (종단간 암호화 링크). 이때 original_name 은 '파일 1.hwp' 같은 자리 표시 */
  name_enc?: string | null;
  /** 받는 사람이 내려받은 횟수 */
  download_count?: number;
  /** 수합 링크: 파일을 낸 사람이 적은 이름 */
  submitter?: string | null;
  /** 수합 링크: 낸 사람 토큰의 SHA-256 */
  submit_token_hash?: string | null;
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
  /** 링크를 만들 때의 요금제 */
  plan?: "guest" | "member" | "pro";
  /** 만든 회원이 탈퇴한 시각 */
  orphaned_at?: string | null;
  /** 종단간 암호화 정보 (없으면 예전 평문 링크) */
  enc?: import("./e2e").EncMeta | null;
  /** share: 나눠 주기 · collect: 수합 (없으면 share) */
  kind?: "share" | "collect";
  /** 수합 설정 */
  collect?: CollectSettings | null;
}

/** 수합(과제 걷기) 링크 설정 */
export interface CollectSettings {
  /** 한 사람이 한 번에 낼 수 있는 파일 수 */
  perPerson: number;
  /** 이름 칸 안내 (예: 학번과 이름) */
  nameLabel: string;
  /** 학생 명단 (안 낸 사람 확인용, 교사만 봄) */
  roster: string[];
  /** 제출 마감 시각 (없으면 자동 삭제 전까지 받음) */
  deadline: string | null;
  /** 교사가 제출을 직접 마감한 시각 */
  closedAt: string | null;
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
  /** 종단간 암호화 링크인지 */
  encrypted?: boolean;
  opens: number;
  downloads: number;
  /** 지금 차지하는 저장 공간 (닫힌 링크는 0) */
  bytes: number;
  files: { id: string; name: string; ext: string; size: number; downloads: number }[];
  kind: "share" | "collect";
  /** 수합 링크: 낸 사람 수 */
  submitters: number;
}
