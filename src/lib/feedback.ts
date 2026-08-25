// 문의·버그 신고 — 공개 폼으로 접수해 DB에 쌓고, 관리자 문의함에서 상태를 관리한다.
// 답장은 서버에서 보내지 않는다(메일 인프라 없음) — 관리자가 mailto로 수동 회신.
// 새 접수는 디스코드 봇이 폴링해 운영자 길드의 알림 채널로 알린다(notified 플래그).
import "server-only";
import { cache } from "@/lib/cache";
import { getSql } from "@/lib/db";

export const FEEDBACK_KINDS = ["inquiry", "bug", "data"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  inquiry: "문의",
  bug: "버그 신고",
  data: "데이터 정정·비노출 요청",
};

export const FEEDBACK_STATUSES = ["new", "in_progress", "done"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "신규",
  in_progress: "처리 중",
  done: "완료",
};

export interface FeedbackEntry {
  id: number;
  kind: FeedbackKind;
  email: string;
  message: string;
  summoner: string | null;
  page: string | null;
  userAgent: string | null;
  status: FeedbackStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string | number;
  kind: FeedbackKind;
  email: string;
  message: string;
  summoner: string | null;
  page: string | null;
  user_agent: string | null;
  status: FeedbackStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}

function toEntry(r: Row): FeedbackEntry {
  return {
    id: Number(r.id),
    kind: r.kind,
    email: r.email,
    message: r.message,
    summoner: r.summoner,
    page: r.page,
    userAgent: r.user_agent,
    status: r.status,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;
const RATE_WINDOW_SEC = 60;
const RATE_MAX = 3;

/** IP당 분당 접수 제한 — 넘으면 false */
export async function allowSubmission(ip: string): Promise<boolean> {
  const key = `feedback:rl:${ip}`;
  const n = (await cache.get<number>(key).catch(() => null)) ?? 0;
  if (n >= RATE_MAX) return false;
  await cache.set(key, n + 1, RATE_WINDOW_SEC).catch(() => {});
  return true;
}

export async function createFeedback(input: {
  kind: FeedbackKind;
  email: string;
  message: string;
  summoner: string | null;
  page: string | null;
  userAgent: string | null;
  ip: string | null;
}): Promise<number> {
  const sql = await getSql();
  const rows = await sql`
    INSERT INTO feedback (kind, email, message, summoner, page, user_agent, ip)
    VALUES (${input.kind}, ${input.email}, ${input.message}, ${input.summoner},
            ${input.page}, ${input.userAgent}, ${input.ip})
    RETURNING id`;
  return Number(rows[0]?.id);
}

export async function listFeedback(status?: FeedbackStatus): Promise<FeedbackEntry[]> {
  const sql = await getSql();
  const rows = status
    ? await sql`
        SELECT id, kind, email, message, summoner, page, user_agent, status, note,
               created_at, updated_at
        FROM feedback WHERE status = ${status}
        ORDER BY created_at DESC LIMIT 500`
    : await sql`
        SELECT id, kind, email, message, summoner, page, user_agent, status, note,
               created_at, updated_at
        FROM feedback ORDER BY created_at DESC LIMIT 500`;
  return (rows as unknown as Row[]).map(toEntry);
}

export async function countNewFeedback(): Promise<number> {
  const sql = await getSql();
  const r = await sql`SELECT count(*)::int AS n FROM feedback WHERE status = 'new'`;
  return (r[0]?.n as number) ?? 0;
}

export async function updateFeedback(
  id: number,
  patch: { status?: FeedbackStatus; note?: string | null },
): Promise<FeedbackEntry | null> {
  const sql = await getSql();
  const rows = await sql`
    UPDATE feedback
    SET status = COALESCE(${patch.status ?? null}, status),
        note = CASE WHEN ${patch.note !== undefined} THEN ${patch.note ?? null} ELSE note END,
        updated_at = now()
    WHERE id = ${id}
    RETURNING id, kind, email, message, summoner, page, user_agent, status, note,
              created_at, updated_at`;
  const r = rows[0] as Row | undefined;
  return r ? toEntry(r) : null;
}

export async function deleteFeedback(id: number): Promise<void> {
  const sql = await getSql();
  await sql`DELETE FROM feedback WHERE id = ${id}`;
}
