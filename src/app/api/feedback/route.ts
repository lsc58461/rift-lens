import { NextResponse, type NextRequest } from "next/server";
import {
  allowSubmission,
  createFeedback,
  FEEDBACK_KINDS,
  MESSAGE_MAX,
  MESSAGE_MIN,
  type FeedbackKind,
} from "@/lib/feedback";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clientIp(req: NextRequest): string | null {
  // Caddy 리버스 프록시가 X-Forwarded-For를 붙인다 — 첫 값이 실제 클라이언트
  const xff = req.headers.get("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || null;
}

export async function POST(req: NextRequest) {
  let body: {
    kind?: string;
    email?: string;
    message?: string;
    summoner?: string;
    page?: string;
    website?: string; // 허니팟 — 사람은 안 채우는 숨김 필드
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  // 봇이 채운 허니팟은 조용히 성공으로 응답해 재시도 유도를 막는다
  if (body.website) return NextResponse.json({ ok: true });

  const kind = body.kind as FeedbackKind;
  const email = (body.email ?? "").trim();
  const message = (body.message ?? "").trim();
  const summoner = (body.summoner ?? "").trim().slice(0, 60) || null;
  const page = (body.page ?? "").trim().slice(0, 300) || null;

  if (!FEEDBACK_KINDS.includes(kind))
    return NextResponse.json({ error: "유형을 선택해 주세요" }, { status: 400 });
  if (!EMAIL_RE.test(email) || email.length > 200)
    return NextResponse.json({ error: "답장을 받을 이메일을 정확히 입력해 주세요" }, { status: 400 });
  if (message.length < MESSAGE_MIN)
    return NextResponse.json(
      { error: `내용을 ${MESSAGE_MIN}자 이상 적어 주세요` },
      { status: 400 },
    );
  if (message.length > MESSAGE_MAX)
    return NextResponse.json(
      { error: `내용은 ${MESSAGE_MAX}자까지 가능해요` },
      { status: 400 },
    );

  const ip = clientIp(req);
  if (ip && !(await allowSubmission(ip)))
    return NextResponse.json(
      { error: "잠시 후 다시 시도해 주세요 (짧은 시간에 너무 많이 보냈어요)" },
      { status: 429 },
    );

  const id = await createFeedback({
    kind,
    email,
    message,
    summoner,
    page,
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    ip,
  });
  return NextResponse.json({ ok: true, id });
}
