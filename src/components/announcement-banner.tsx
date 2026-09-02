// GNB 위 공지 배너 — 서버 컴포넌트. 관리자가 설정하면 사이트 전역 상단에 얇은 스트립으로 나타난다.
//
// 예전엔 클라이언트가 마운트 뒤 /api/announcement 를 불러 늦게 끼워 넣었는데, 그러면 본문이
// 0.5초쯤 뒤에 44px 밀려 내려가 레이아웃 시프트(CLS 0.08)와 Speed Index 악화를 만들었다(2026-09-03).
// 지금은 서버가 첫 HTML 에 바로 그린다. 닫기 상태는 쿠키(announce-dismissed=updatedAt)로 들고 있어
// 닫은 사람에겐 서버가 애초에 안 그린다 — 깜빡임도 시프트도 없다.
// 루트 레이아웃은 이미 headers() 로 동적이라 cookies() 를 읽어도 추가 비용이 없다.
import { cookies } from "next/headers";
import { getSetting } from "@/lib/store";
import type { Announcement } from "@/app/api/announcement/route";
import { AnnouncementStrip } from "./announcement-strip";

export const ANNOUNCE_DISMISS_COOKIE = "announce-dismissed";

// 페이지뷰마다 DB 를 두드리지 않게 프로세스 안에서 60초 메모 (관리자 수정은 1분 안에 반영)
let memo: { at: number; value: Announcement | null } | null = null;
const MEMO_MS = 60_000;

async function loadAnnouncement(): Promise<Announcement | null> {
  const now = Date.now();
  if (memo && now - memo.at < MEMO_MS) return memo.value;
  const a = await getSetting<Announcement>("announcement").catch(() => null);
  const value = a?.enabled && a.text?.trim() ? a : null;
  memo = { at: now, value };
  return value;
}

export async function AnnouncementBanner() {
  const a = await loadAnnouncement();
  if (!a) return null;
  const dismissed = (await cookies()).get(ANNOUNCE_DISMISS_COOKIE)?.value;
  if (dismissed === String(a.updatedAt)) return null;
  return <AnnouncementStrip text={a.text} href={a.href} tone={a.tone} updatedAt={a.updatedAt} />;
}
