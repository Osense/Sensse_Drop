"use client";

import * as React from "react";
import { api, type AppConfig, type MeInfo } from "./api";
import { useAuth } from "./auth";
import { EXPIRE_OPTIONS, MIN_CUSTOM_MINUTES, MULTIPART_THRESHOLD, PART_SIZE, PLANS, type Plan } from "./plans";

export const DEFAULT_CONFIG: AppConfig = {
  plans: PLANS,
  expireOptions: EXPIRE_OPTIONS,
  minCustomMinutes: MIN_CUSTOM_MINUTES,
  multipartThreshold: MULTIPART_THRESHOLD,
  partSize: PART_SIZE,
};

/** 지금 쓰는 요금제와 쓰는 용량. 로그인 안 했으면 나그네 */
export function usePlan() {
  const auth = useAuth();
  const [config, setConfig] = React.useState<AppConfig>(DEFAULT_CONFIG);
  const [me, setMe] = React.useState<MeInfo | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    api<AppConfig>("/api/config")
      .then((c) => c.plans && setConfig(c))
      .catch(() => {});
  }, []);

  const refresh = React.useCallback(async () => {
    if (!auth.session) {
      setMe(null);
      setLoaded(true);
      return;
    }
    try {
      setMe(await api<MeInfo>("/api/me", { headers: await auth.authHeaders() }));
    } catch {
      setMe(null);
    } finally {
      setLoaded(true);
    }
  }, [auth]);

  React.useEffect(() => {
    if (auth.ready) refresh();
  }, [auth.ready, refresh]);

  const id = auth.session ? (me?.plan ?? "member") : "guest";
  const plan: Plan = config.plans[id];
  return { config, plan, me, ready: auth.ready && loaded, refresh };
}

export function sizeLabel(mb: number | null) {
  if (mb == null) return "제한 없음";
  return mb >= 1024 ? `${Math.round(mb / 102.4) / 10}GB` : `${mb}MB`;
}

/** 보관 기간 라벨: 7일, 1년 */
export function periodLabel(minutes: number) {
  if (minutes >= 365 * 1440) return `${Math.round(minutes / (365 * 1440))}년`;
  if (minutes >= 1440) return `${Math.round(minutes / 1440)}일`;
  if (minutes >= 60) return `${Math.round(minutes / 60)}시간`;
  return `${minutes}분`;
}
