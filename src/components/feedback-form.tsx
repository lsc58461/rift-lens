"use client";

// 문의·버그 신고 폼 — 접수만 하고 답장은 운영자가 이메일로 수동 회신한다.
import { useEffect, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const KINDS = [
  { value: "inquiry", label: "문의", hint: "서비스 이용, 제휴, 기타 질문" },
  { value: "bug", label: "버그 신고", hint: "화면이 깨지거나 데이터가 이상할 때" },
  { value: "data", label: "데이터 정정·비노출 요청", hint: "내 소환사 정보 수정·비공개 요청" },
] as const;
type Kind = (typeof KINDS)[number]["value"];

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 2000;

const FIELD =
  "w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function FeedbackForm({ initialKind }: { initialKind?: Kind }) {
  const [kind, setKind] = useState<Kind>(initialKind ?? "inquiry");
  const [email, setEmail] = useState("");
  const [summoner, setSummoner] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // 허니팟
  const [page, setPage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<number | null>(null);

  // 버그 재현용으로 직전 페이지 주소를 자동 첨부한다
  useEffect(() => {
    try {
      const ref = document.referrer;
      if (ref && new URL(ref).origin === location.origin) setPage(ref);
    } catch {
      /* ignore */
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (message.trim().length < MESSAGE_MIN) {
      setError(`내용을 ${MESSAGE_MIN}자 이상 적어 주세요`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, email, summoner, message, page, website }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "접수에 실패했어요");
      setDoneId(data?.id ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "접수에 실패했어요");
    } finally {
      setBusy(false);
    }
  }

  if (doneId !== null) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-6 text-center">
        <CheckCircle2 className="mx-auto size-8 text-emerald-500" />
        <p className="text-sm font-semibold">접수됐어요{doneId ? ` (#${doneId})` : ""}</p>
        <p className="text-sm text-muted-foreground">
          확인 후 <b>{email}</b>로 답장드릴게요. 보통 며칠 안에 회신하지만, 개인 운영이라 늦어질 수
          있어요.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDoneId(null);
            setMessage("");
          }}
        >
          하나 더 보내기
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border bg-card p-5 sm:p-6">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">유형</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                kind === k.value
                  ? "border-primary bg-primary/8"
                  : "hover:bg-accent"
              }`}
            >
              <span className="block text-sm font-medium">{k.label}</span>
              <span className="block text-xs text-muted-foreground">{k.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm font-semibold">
            이메일 <span className="text-destructive">*</span>
          </span>
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="답장 받을 주소"
            autoComplete="email"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-semibold">
            관련 소환사 <span className="text-xs font-normal text-muted-foreground">(선택)</span>
          </span>
          <Input
            value={summoner}
            onChange={(e) => setSummoner(e.target.value)}
            placeholder="닉네임#태그"
            maxLength={60}
          />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">
          내용 <span className="text-destructive">*</span>
        </span>
        <textarea
          required
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
          rows={6}
          placeholder={
            kind === "bug"
              ? "어떤 화면에서, 무엇을 했을 때, 어떻게 이상했는지 적어 주세요"
              : kind === "data"
                ? "어떤 소환사의 어떤 정보를 어떻게 처리해 드릴지 적어 주세요 (본인 확인을 위해 추가 문의를 드릴 수 있어요)"
                : "궁금한 점이나 하고 싶은 말을 적어 주세요"
          }
          className={`${FIELD} min-h-32 resize-y`}
        />
        <span className="block text-right text-xs text-muted-foreground tabular-nums">
          {message.length}/{MESSAGE_MAX}
        </span>
      </label>

      {/* 허니팟 — 사람에겐 보이지 않는다 */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {page ? "직전 페이지 주소가 함께 첨부돼요. " : ""}
          접수 내용은 답변 목적으로만 보관돼요.
        </p>
        <Button type="submit" disabled={busy}>
          <Send className="size-4" />
          {busy ? "보내는 중…" : "보내기"}
        </Button>
      </div>
    </form>
  );
}
