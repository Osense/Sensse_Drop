export function formatSize(bytes?: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function formatDate(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function extOf(name: string) {
  const m = /\.([A-Za-z0-9]+)$/.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

export const STATUS_TEXT: Record<string, string> = {
  waiting: "대기",
  uploading: "올리는 중",
  converting: "PDF로 바꾸는 중",
  done: "완료",
  error: "실패",
};

/** 확장자를 뺀 이름 */
export function baseOf(name: string) {
  return name.replace(/\.[A-Za-z0-9]+$/, "");
}

/** 받는 사람에게 보일 파일 이름: 파일 이름에 못 쓰는 글자를 빼고, 비면 원래 이름으로 */
export function displayName(label: string, original: string, ext = extOf(original)) {
  const base = label.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) || baseOf(original);
  return `${base}.${ext}`;
}
