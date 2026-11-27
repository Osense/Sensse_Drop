"use client";

import { zipSync, strToU8 } from "fflate";

/**
 * 모은 파일을 ZIP 하나로 묶기 (이 브라우저에서). 대부분 이미 압축된 형식이라 압축하지 않고(level 0) 담기만 해 빠릅니다.
 * paths 는 "폴더/파일" 꼴. 같은 경로가 겹치면 "(2)" 를 붙여요.
 */
export async function makeZip(entries: { path: string; blob: Blob }[]): Promise<Blob> {
  const used = new Set<string>();
  const files: Record<string, [Uint8Array, { level: 0; mtime: Date }]> = {};
  for (const e of entries) {
    let p = e.path;
    if (used.has(p.toLowerCase())) {
      const m = /^(.*?)(\.[^./]+)?$/.exec(p)!;
      for (let n = 2; used.has(p.toLowerCase()); n++) p = `${m[1]} (${n})${m[2] ?? ""}`;
    }
    used.add(p.toLowerCase());
    files[p] = [new Uint8Array(await e.blob.arrayBuffer()), { level: 0, mtime: new Date() }];
  }
  if (entries.length === 0) files["비어 있음.txt"] = [strToU8("낸 파일이 없어요."), { level: 0, mtime: new Date() }];
  const data = zipSync(files);
  return new Blob([data as BlobPart], { type: "application/zip" });
}

/** 파일 이름 · 폴더 이름에 못 쓰는 글자 빼기 */
export const safeSegment = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "이름 없음";

export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
