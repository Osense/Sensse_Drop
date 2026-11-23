/**
 * 올릴 수 있는 파일 형식. 한글(HWP · HWPX)만 PDF로 바꾸고, 나머지는 그대로 전달합니다.
 * 웹 화면(web/src/lib/file-types.ts)과 Supabase sd_files.ext 제약(0003 마이그레이션)도 같은 목록입니다.
 * 브라우저에서 실행될 수 있는 형식(html · svg · js 등)은 넣지 않습니다.
 */
export const HANGUL_EXT = ["hwp", "hwpx"] as const;
export const ALLOWED_EXT = [
  "hwp", "hwpx", "pdf",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "csv", "md",
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp",
  "zip", "mp3", "m4a", "wav", "mp4", "mov",
] as const;
export const isHangul = (ext: string) => (HANGUL_EXT as readonly string[]).includes(ext);
