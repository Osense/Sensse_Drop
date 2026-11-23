/**
 * 쎈스드롭 요금제. Worker(worker/src/plans.ts)과 같은 내용입니다.
 * - 나그네: 로그인 없이
 * - 멤버십: WSNS 계정 (무료)
 * - 프로: 연 9,900원 (연간 결제만). 결제 연동 전이라 Supabase sd_plans 에 직접 넣어 켭니다.
 */
export type PlanId = "guest" | "member" | "pro";

export type Plan = {
  id: PlanId;
  name: string;
  /** 한 링크에 넣을 수 있는 파일 수 */
  maxFiles: number;
  /** 파일 하나 최대 크기(MB). null 이면 제한 없음 (동시 보관 총량 안에서) */
  maxFileMb: number | null;
  /** 고를 수 있는 자동 삭제 시간(분) */
  expireMinutes: number[];
  defaultExpire: number;
  /** 마감 시각을 직접 정할 수 있는 최대 기간(분). 0 이면 직접 지정 없음 */
  maxCustomMinutes: number;
  /** 열려 있는 링크들의 파일을 합친 최대 크기(MB). null 이면 제한 없음 */
  quotaMb: number | null;
  /** 연 가격(원, VAT 포함). 0 이면 무료 */
  pricePerYear: number;
};

export const EXPIRE_OPTIONS = [
  { minutes: 10, label: "10분 후" },
  { minutes: 60, label: "1시간 후" },
  { minutes: 3 * 1440, label: "3일 후" },
  { minutes: 7 * 1440, label: "7일 후" },
  { minutes: 30 * 1440, label: "30일 후" },
  { minutes: 365 * 1440, label: "1년 후" },
];

export const PLANS: Record<PlanId, Plan> = {
  guest: { id: "guest", name: "나그네", maxFiles: 2, maxFileMb: 5, expireMinutes: [10], defaultExpire: 10, maxCustomMinutes: 0, quotaMb: null, pricePerYear: 0 },
  member: {
    id: "member",
    name: "멤버십",
    maxFiles: 10,
    maxFileMb: 20,
    expireMinutes: [10, 60, 3 * 1440, 7 * 1440],
    defaultExpire: 3 * 1440,
    maxCustomMinutes: 7 * 1440,
    quotaMb: 1024,
    pricePerYear: 0,
  },
  pro: {
    id: "pro",
    name: "프로",
    maxFiles: 30,
    maxFileMb: null,
    expireMinutes: EXPIRE_OPTIONS.map((o) => o.minutes),
    defaultExpire: 7 * 1440,
    maxCustomMinutes: 365 * 1440,
    quotaMb: 30 * 1024,
    pricePerYear: 9900,
  },
};

/** 직접 정한 마감 시각은 지금부터 최소 이만큼 뒤 */
export const MIN_CUSTOM_MINUTES = 10;
/** 이보다 큰 파일은 나눠 올립니다 (Workers 요청 본문 한도 100MB) */
export const MULTIPART_THRESHOLD = 64 * 1024 * 1024;
export const PART_SIZE = 32 * 1024 * 1024;
/** 프로 구독이 끝난 뒤 링크를 그대로 두는 유예 기간(일). 지나면 멤버십 한도를 넘는 링크는 닫힘 */
export const PRO_GRACE_DAYS = 7;
