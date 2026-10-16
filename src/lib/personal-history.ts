"use client";

// 내 기록 — 최근 본 소환사·즐겨찾기를 **이 브라우저에만** 저장한다(서버에 쌓지 않음).
//
// 예전엔 모든 방문자의 최근 검색을 한 목록으로 보여줬다(/recent 페이지, 홈 칩, 검색창 빈 칸).
// op.gg 처럼 '내가 본 소환사'만 보이게 바꿨다(2026-10-16).
// 저장은 localStorage 다. 핑거프린트로 서버에 묶는 방식은 택하지 않았다 — 같은 기종(특히 아이폰
// 사파리)끼리 식별값이 겹쳐 남의 기록이 섞이고, 브라우저가 업데이트되면 같은 사람의 값이 바뀌어
// 기록이 날아가며, 동의 없는 기기 식별이라 개인정보 부담도 크다.
// 시크릿 창·저장소 차단으로 읽기/쓰기가 실패해도 화면은 빈 목록으로 그대로 동작한다.
import { useCallback, useSyncExternalStore } from "react";

export interface HistoryEntry {
  name: string;
  tag: string;
  /** 볼 당시의 추정 티어 — 칩의 색 점용(없을 수 있음) */
  tier?: string | null;
  at: number;
}

const RECENT_KEY = "rl:recent:v1";
const FAV_KEY = "rl:fav:v1";
const MAX_RECENT = 20;
const MAX_FAV = 50;
const EVENT = "rl:history"; // 같은 탭 안의 다른 컴포넌트에 알리는 이벤트 (다른 탭은 storage 이벤트)

/** 같은 사람 판정 — 대소문자·전각·띄어쓰기 무시(라이엇과 같은 기준) */
export const historyKey = (name: string, tag: string) =>
  `${name}#${tag}`.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

function parse(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e): e is HistoryEntry =>
        !!e && typeof e.name === "string" && typeof e.tag === "string" && typeof e.at === "number",
    );
  } catch {
    return [];
  }
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, list: HistoryEntry[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // 저장소가 막혀 있으면 이번 세션에서만 못 남길 뿐 — 조용히 넘어간다
  }
  window.dispatchEvent(new Event(EVENT));
}

// useSyncExternalStore 는 같은 값이면 같은 참조를 돌려줘야 한다 — 원문이 그대로면 파싱 결과를 재사용
const snapCache = new Map<string, { raw: string | null; list: HistoryEntry[] }>();
function snapshot(key: string): HistoryEntry[] {
  const raw = readRaw(key);
  const hit = snapCache.get(key);
  if (hit && hit.raw === raw) return hit.list;
  const list = parse(raw);
  snapCache.set(key, { raw, list });
  return list;
}

const EMPTY: HistoryEntry[] = [];

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** 소환사 페이지를 볼 때 부른다 — 맨 앞으로 올리고 최대 MAX_RECENT 명만 남긴다 */
export function addRecent(name: string, tag: string, tier?: string | null): void {
  const k = historyKey(name, tag);
  const rest = parse(readRaw(RECENT_KEY)).filter((e) => historyKey(e.name, e.tag) !== k);
  write(RECENT_KEY, [{ name, tag, tier: tier ?? null, at: Date.now() }, ...rest].slice(0, MAX_RECENT));
  // 즐겨찾기에 있는 사람이면 티어 색만 최신으로
  const favs = parse(readRaw(FAV_KEY));
  const i = favs.findIndex((e) => historyKey(e.name, e.tag) === k);
  if (i >= 0 && tier && favs[i].tier !== tier) {
    favs[i] = { ...favs[i], tier };
    write(FAV_KEY, favs);
  }
}

export function useHistory() {
  const recent = useSyncExternalStore(subscribe, () => snapshot(RECENT_KEY), () => EMPTY);
  const favs = useSyncExternalStore(subscribe, () => snapshot(FAV_KEY), () => EMPTY);

  const isFav = useCallback(
    (name: string, tag: string) => {
      const k = historyKey(name, tag);
      return favs.some((e) => historyKey(e.name, e.tag) === k);
    },
    [favs],
  );

  const toggleFav = useCallback((name: string, tag: string, tier?: string | null) => {
    const k = historyKey(name, tag);
    const cur = parse(readRaw(FAV_KEY));
    const exists = cur.some((e) => historyKey(e.name, e.tag) === k);
    write(
      FAV_KEY,
      exists
        ? cur.filter((e) => historyKey(e.name, e.tag) !== k)
        : [{ name, tag, tier: tier ?? null, at: Date.now() }, ...cur].slice(0, MAX_FAV),
    );
  }, []);

  const removeRecent = useCallback((name: string, tag: string) => {
    const k = historyKey(name, tag);
    write(
      RECENT_KEY,
      parse(readRaw(RECENT_KEY)).filter((e) => historyKey(e.name, e.tag) !== k),
    );
  }, []);

  return { recent, favs, isFav, toggleFav, removeRecent };
}
