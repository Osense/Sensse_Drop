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
