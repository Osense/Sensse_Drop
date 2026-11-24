"use client";

import { api, ApiError, type FileStatus } from "./api";
import { MULTIPART_THRESHOLD, PART_SIZE } from "./plans";
import { encryptedSource, plainSource, type Source } from "./e2e";

/**
 * 파일 올리기. 작은 파일은 한 번에, MULTIPART_THRESHOLD 보다 큰 파일은 PART_SIZE 조각으로 나눠 올립니다.
 * 나눠 올리던 중 끊기면 올린 조각을 이 브라우저(localStorage)에 적어 두었다가, 같은 파일을 다시 고르면 이어서 올려요.
 */
type Saved = { uploadId: string; size: number; name: string; parts: Record<number, string>; /** 암호화 파일 salt: 이어 올릴 때 같은 암호문이 나오게 */ salt?: string };

const savedKey = (shareId: string, fileId: string, kind: string) => `sensedrop.mpu.${shareId}.${fileId}.${kind}`;
function readSaved(k: string): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(k) || "null") as Saved | null;
  } catch {
    return null;
  }
}
function writeSaved(k: string, v: Saved | null) {
  try {
    if (v) localStorage.setItem(k, JSON.stringify(v));
    else localStorage.removeItem(k);
  } catch {}
}

/** 이어 올릴 수 있게 적어 둔 업로드가 있는지 */
export function hasResumable(shareId: string, fileId: string, kind: "pdf" | "original") {
  return readSaved(savedKey(shareId, fileId, kind)) != null;
}

async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const status = (e as ApiError).status;
      // 요청이 잘못된 경우(4xx)는 다시 해도 같아요. 연결이 끊긴 경우(0)와 서버 오류(5xx)만 다시
      if (status && status < 500 && status !== 429) throw e;
      await new Promise((r) => setTimeout(r, 800 * 2 ** i));
    }
  }
  throw last;
}

export async function uploadFile({
  shareId,
  fileId,
  kind,
  blob,
  name = "",
  headers,
  shareKey,
  onProgress,
}: {
  shareId: string;
  fileId: string;
  kind: "pdf" | "original";
  blob: Blob;
  name?: string;
  headers: Record<string, string>;
  /** 링크 열쇠: 있으면 이 브라우저에서 잠근 뒤 올려요 (종단간 암호화) */
  shareKey?: Uint8Array<ArrayBuffer> | null;
  /** 0~1 */
  onProgress?: (ratio: number) => void;
}): Promise<FileStatus> {
  const base = `/api/shares/${shareId}/files/${fileId}`;
  const source = (salt?: string): Promise<Source> => (shareKey ? encryptedSource(shareKey, blob, salt) : Promise.resolve(plainSource(blob)));
  const fullSize = shareKey ? (await source()).size : blob.size;
  if (fullSize <= MULTIPART_THRESHOLD) {
    const src = await source();
    const body = await src.slice(0, src.size);
    const res = await retry(() =>
      api<{ status: FileStatus }>(`${base}?kind=${kind}`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/octet-stream" },
        body,
      }),
    );
    onProgress?.(1);
    return res.status;
  }

  const k = savedKey(shareId, fileId, kind);
  const total = Math.ceil(fullSize / PART_SIZE);
  for (let attempt = 0; attempt < 2; attempt++) {
    let saved = readSaved(k);
    if (!saved || saved.size !== blob.size || saved.name !== name || Boolean(shareKey) !== Boolean(saved.salt)) {
      const start = await retry(() => api<{ uploadId: string }>(`${base}/mpu?kind=${kind}`, { method: "POST", headers }));
      saved = { uploadId: start.uploadId, size: blob.size, name, parts: {}, salt: shareKey ? (await source()).salt : undefined };
      writeSaved(k, saved);
    }
    const s = saved;
    const src = await source(s.salt);
    const todo = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !s.parts[n]);
    onProgress?.((total - todo.length) / total);
    try {
      // 조각 3개씩 동시에
      const queue = [...todo];
      const worker = async () => {
        for (let n = queue.shift(); n != null; n = queue.shift()) {
          const part = await src.slice((n - 1) * PART_SIZE, Math.min(src.size, n * PART_SIZE));
          const res = await retry(() =>
            api<{ partNumber: number; etag: string }>(`${base}/mpu/${s.uploadId}/${n}?kind=${kind}`, {
              method: "PUT",
              headers: { ...headers, "Content-Type": "application/octet-stream" },
              body: part,
            }),
          );
          s.parts[n] = res.etag;
          writeSaved(k, s);
          onProgress?.(Object.keys(s.parts).length / total);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const done = await retry(() =>
        api<{ status: FileStatus }>(`${base}/mpu/${s.uploadId}/complete?kind=${kind}`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ parts: Object.entries(s.parts).map(([n, etag]) => ({ partNumber: Number(n), etag })) }),
        }),
      );
      writeSaved(k, null);
      return done.status;
    } catch (e) {
      // 서버가 이 업로드를 모르면(만료 등) 처음부터 한 번 더
      if ((e as ApiError).status === 409 && attempt === 0) {
        writeSaved(k, null);
        continue;
      }
      throw e;
    }
  }
  throw new Error("파일을 올리지 못했어요.");
}
