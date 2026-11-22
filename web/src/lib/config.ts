/**
 * 공개 설정. Supabase 공개(publishable) 키는 브라우저에 노출되어도 되는 키입니다.
 * 회원 계정은 WSNS 사이트(wsns.studio)와 같은 Supabase WSNS 프로젝트를 씁니다.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://cqqhvxrgugomyekbpwqp.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_mzKE-7e3MvLXinAVZl5dLg_Wg7nAipP";

/** WSNS 통합 계정 페이지 */
export const WSNS_URL = "https://wsns.studio";
export const WSNS_SIGNUP_URL = `${WSNS_URL}/signup/`;
export const WSNS_FORGOT_URL = `${WSNS_URL}/forgot-password/`;
export const PRODUCT_URL = `${WSNS_URL}/products/sense-drop/`;

/**
 * 서버 없이 정적 호스팅(GitHub Pages)으로 올릴 때: 링크 공유 없이 "브라우저에서 PDF로 바꿔 내려받기"만 합니다.
 * NEXT_PUBLIC_STATIC_ONLY=1, NEXT_PUBLIC_BASE_PATH=/Sensse_Drop 로 빌드 (npm run build:pages).
 */
export const STATIC_ONLY = process.env.NEXT_PUBLIC_STATIC_ONLY === "1";
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
/** public/ 파일 주소 (basePath 를 붙여 줍니다) */
export const asset = (path: string) => `${BASE_PATH}${path}`;
