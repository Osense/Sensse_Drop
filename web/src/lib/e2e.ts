"use client";

/**
 * 종단간 암호화 (보내는 사람 브라우저에서 잠그고, 비밀번호를 아는 사람의 브라우저에서만 풀어요)
 *
 * 1) 비밀번호 → PBKDF2-SHA256(60만 번, 링크마다 무작위 salt) → 64바이트
 *    - 앞 32바이트(pwKey): 링크 열쇠를 푸는 데만 씀. 서버로 보내지 않음
 *    - 뒤 32바이트(authKey): 서버에 "비밀번호 확인용"으로만 보냄 (서버는 이 값의 해시만 저장)
 *    → 서버는 비밀번호도, 파일을 푸는 열쇠도 받지 않아요.
 * 2) 링크 열쇠 K(무작위 256비트)로 모든 파일 · 파일 이름을 AES-256-GCM 으로 잠금
 * 3) K 는 KEK = HKDF(pwKey, salt = 서버 pepper) 로 감싸 서버에 둠.
 *    pepper 는 Worker 비밀값에서 나오고 비밀번호가 맞을 때만 내려 줘요.
 *    → DB · R2 를 통째로 빼 가도 Worker 비밀값 없이는 비밀번호를 맞혀 볼 수조차 없어요.
 * 4) 파일은 1MiB 조각마다 따로 잠가(STREAM 방식, 마지막 조각 표시) 큰 파일도 나눠 올리고 이어 받을 수 있어요.
 *
 * 파일 형식: "SDE1"(4) + salt(16) + [조각 암호문(평문 1MiB + 태그 16)]…
 * 조각 열쇠 = HKDF(K, salt, "sd-file"), 조각 nonce = 조각 번호(8바이트) + 0 0 0 + 마지막 표시(1)
 */

export const KDF_ITER = 600_000;
export const CHUNK = 1 << 20;
const TAG = 16;
const MAGIC = [0x53, 0x44, 0x45, 0x31]; // "SDE1"
export const HEADER = 20;

const enc = new TextEncoder();
const dec = new TextDecoder();

/** 암호화한 뒤 크기 (worker/src/e2e.ts encSize 와 같음) */
export function encSize(size: number) {
  return HEADER + size + TAG * Math.max(1, Math.ceil(size / CHUNK));
}

export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** 서버에 두는 잠금 정보 (sd_shares.enc) */
export type EncMeta = { v: 1; iter: number; salt: string; wrap?: string | null };

/** 비밀번호 → { pwKey(브라우저에만), authKey(서버 확인용) } */
export async function derivePassword(password: string, saltB64: string, iter: number) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64u(saltB64), iterations: iter }, base, 512));
  return { pwKey: bits.slice(0, 32), authKey: b64u(bits.slice(32)) };
}

/** 새 링크: salt 를 뽑고 비밀번호에서 열쇠를 만듦 */
export async function newPasswordKeys(password: string) {
  const salt = b64u(rand(16));
  const { pwKey, authKey } = await derivePassword(password, salt, KDF_ITER);
  return { meta: { v: 1 as const, iter: KDF_ITER, salt }, pwKey, authKey };
}

async function kek(pwKey: Uint8Array<ArrayBuffer>, pepperB64: string) {
  const ikm = await crypto.subtle.importKey("raw", pwKey, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: fromB64u(pepperB64), info: enc.encode("sd-kek") },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** 링크 열쇠 K 를 새로 만들어 감쌈 → [K, 서버에 둘 wrap] */
export async function newShareKey(pwKey: Uint8Array<ArrayBuffer>, pepper: string, shareId: string) {
  const k = rand(32);
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(shareId) }, await kek(pwKey, pepper), k));
  return { key: k, wrap: b64u(concat([iv, ct])) };
}

/** 감싼 K 풀기. 비밀번호가 틀리면 실패해요 */
export async function unwrapShareKey(pwKey: Uint8Array<ArrayBuffer>, pepper: string, shareId: string, wrap: string): Promise<Uint8Array<ArrayBuffer>> {
  const raw = fromB64u(wrap);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12), additionalData: enc.encode(shareId) }, await kek(pwKey, pepper), raw.slice(12)),
    );
  } catch {
    throw new Error("비밀번호가 틀렸어요.");
  }
}

const aesKey = (k: Uint8Array<ArrayBuffer>) => crypto.subtle.importKey("raw", k, "AES-GCM", false, ["encrypt", "decrypt"]);

/** 파일 이름 잠그기 (파일 id 에 묶어 다른 파일로 바꿔치기 못하게) */
export async function encryptName(k: Uint8Array<ArrayBuffer>, fileId: string, name: string) {
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`name:${fileId}`) }, await aesKey(k), enc.encode(name)));
  return b64u(concat([iv, ct]));
}
export async function decryptName(k: Uint8Array<ArrayBuffer>, fileId: string, value: string) {
  const raw = fromB64u(value);
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12), additionalData: enc.encode(`name:${fileId}`) }, await aesKey(k), raw.slice(12)));
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function fileKey(k: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>) {
  const ikm = await crypto.subtle.importKey("raw", k, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("sd-file") }, ikm, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function nonce(index: number, last: boolean) {
  const iv = new Uint8Array(12);
  const v = new DataView(iv.buffer);
  v.setUint32(0, Math.floor(index / 2 ** 32));
  v.setUint32(4, index >>> 0);
  iv[11] = last ? 1 : 0;
  return iv;
}

/** 올릴 데이터: 크기와, 원하는 구간을 Blob 으로 꺼내는 함수 */
export type Source = { size: number; slice(start: number, end: number): Promise<Blob>; salt?: string };

export function plainSource(blob: Blob): Source {
  return { size: blob.size, slice: async (a, b) => blob.slice(a, b) };
}

/**
 * 잠근 파일을 필요한 구간만 그때그때 만들어 내는 Source.
 * 같은 salt 면 같은 암호문이 나와서, 나눠 올리다 끊겨도 다른 조각과 이어 붙일 수 있어요.
 */
export async function encryptedSource(k: Uint8Array<ArrayBuffer>, blob: Blob, saltB64?: string): Promise<Source> {
  const salt = saltB64 ? fromB64u(saltB64) : rand(16);
  const key = await fileKey(k, salt);
  const header = concat([new Uint8Array(MAGIC), salt]);
  const chunks = Math.max(1, Math.ceil(blob.size / CHUNK));
  const size = encSize(blob.size);
  const stride = CHUNK + TAG;
  const chunk = async (i: number) => {
    const plain = await blob.slice(i * CHUNK, Math.min(blob.size, (i + 1) * CHUNK)).arrayBuffer();
    return new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce(i, i === chunks - 1) }, key, plain));
  };
  return {
    size,
    salt: b64u(salt),
    async slice(start, end) {
      end = Math.min(end, size);
      const parts: BlobPart[] = [];
      if (start < HEADER) parts.push(header.slice(start, Math.min(end, HEADER)));
      if (end > HEADER) {
        const from = Math.max(0, start - HEADER);
        const to = end - HEADER;
        for (let i = Math.floor(from / stride); i <= Math.floor((to - 1) / stride) && i < chunks; i++) {
          const c = await chunk(i);
          const off = i * stride;
          parts.push(c.slice(Math.max(0, from - off), Math.min(c.length, to - off)));
        }
      }
      return new Blob(parts);
    },
  };
}

/**
 * 잠긴 파일 스트림을 풀어 평문 조각을 차례로 넘김.
 * 마지막 조각 표시까지 확인하므로 잘리거나 바뀐 파일은 오류가 나요.
 */
export async function decryptStream(k: Uint8Array<ArrayBuffer>, stream: ReadableStream<Uint8Array>, onPlain: (chunk: Uint8Array) => Promise<void> | void, onRead?: (bytes: number) => void) {
  const reader = stream.getReader();
  let buf = new Uint8Array(0);
  let read = 0;
  let key: CryptoKey | null = null;
  let index = 0;
  let done = false;
  const stride = CHUNK + TAG;
  const fail = () => new Error("파일이 손상됐거나 열쇠가 맞지 않아요.");
  const open = async (c: Uint8Array, last: boolean) => {
    try {
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce(index, last) }, key!, c.slice()));
    } catch {
      throw fail();
    }
  };
  for (;;) {
    const r = await reader.read();
    if (r.value) {
      read += r.value.length;
      onRead?.(read);
      buf = buf.length ? concat([buf, r.value]) : r.value.slice();
    }
    if (!key && buf.length >= HEADER) {
      if (MAGIC.some((m, i) => buf[i] !== m)) throw fail();
      key = await fileKey(k, buf.slice(4, HEADER));
      buf = buf.slice(HEADER);
    }
    // 마지막 조각인지 알려면 다음 바이트가 있는지 봐야 해서, 한 조각보다 많이 모였을 때만 풉니다
    while (key && buf.length > stride) {
      await onPlain(await open(buf.subarray(0, stride), false));
      buf = buf.slice(stride);
      index++;
    }
    if (r.done) {
      done = true;
      break;
    }
  }
  if (!done || !key || buf.length < TAG) throw fail();
  await onPlain(await open(buf, true));
}

/** 이 탭에서 연 링크의 열쇠 (새로고침해도 비밀번호를 다시 묻지 않게, 탭을 닫으면 사라짐) */
export const sessionKeys = {
  get(id: string): Uint8Array<ArrayBuffer> | null {
    try {
      const v = sessionStorage.getItem(`sensedrop.key.${id}`);
      return v ? fromB64u(v) : null;
    } catch {
      return null;
    }
  },
  set(id: string, k: Uint8Array) {
    try {
      sessionStorage.setItem(`sensedrop.key.${id}`, b64u(k));
    } catch {}
  },
};

/** 이 기기에서 만든 링크의 진짜 파일 이름 (배포 기록에 보여 주려고. 서버에는 잠긴 이름만 있어요) */
export const localNames = {
  get(id: string): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(`sensedrop.names.${id}`) || "{}") as Record<string, string>;
    } catch {
      return {};
    }
  },
  set(id: string, names: Record<string, string>) {
    try {
      localStorage.setItem(`sensedrop.names.${id}`, JSON.stringify({ ...localNames.get(id), ...names }));
    } catch {}
  },
};

/** 받은 평문 조각을 파일로 저장. 아주 큰 파일은 (되는 브라우저에서) 디스크에 바로 써요 */
export async function saveDecrypted(
  name: string,
  type: string,
  produce: (write: (c: Uint8Array) => Promise<void> | void) => Promise<void>,
  handle?: FileSystemFileHandleLike | null,
) {
  if (handle) {
    const w = await handle.createWritable();
    try {
      await produce((c) => w.write(c.slice()));
      await w.close();
    } catch (e) {
      await w.abort?.().catch(() => {});
      throw e;
    }
    return;
  }
  const parts: Blob[] = [];
  await produce((c) => {
    parts.push(new Blob([c.slice()]));
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(parts, { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

type FileSystemFileHandleLike = {
  createWritable(): Promise<{ write(d: BufferSource | Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
};

/** 큰 파일(기본 300MB 넘음)이고 브라우저가 지원하면 저장 위치를 먼저 고르게 함. 반드시 누른 직후에 불러야 해요 */
export async function pickSaveTarget(name: string, size: number | null): Promise<FileSystemFileHandleLike | null> {
  const w = window as unknown as { showSaveFilePicker?: (o: { suggestedName: string }) => Promise<FileSystemFileHandleLike> };
  if (!w.showSaveFilePicker || (size ?? 0) < 300 * 1024 * 1024) return null;
  return w.showSaveFilePicker({ suggestedName: name });
}
