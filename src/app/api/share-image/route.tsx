import { readFile } from "fs/promises";
import path from "path";
import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { getStoredResult } from "@/lib/mmr/deep-jobs";
import type { MmrEstimate } from "@/lib/mmr/estimate";
import { TIER_COLORS, isApexPoints } from "@/lib/mmr/rank";
import { PLATFORM_LABELS, type PlatformRegion } from "@/lib/riot/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function gapText(gap: number | null, apex = false): string {
  if (gap === null) return "";
  if (apex) {
    const lp = Math.abs(Math.round(gap));
    if (lp < 100) return "최근 로비 평균이 현재 LP와 비슷한 구간";
    return gap > 0 ? `최근 로비 평균이 현재보다 약 ${lp}LP 높은 구간` : `최근 로비 평균이 현재보다 약 ${lp}LP 낮은 구간`;
  }
  if (gap >= 50) return "최근 로비 평균 랭크가 현재 티어보다 높은 구간";
  if (gap <= -50) return "최근 로비 평균 랭크가 현재 티어보다 낮은 구간";
  return "최근 로비 평균 랭크가 현재 티어와 비슷한 구간";
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const region = sp.get("region") ?? "";
  const riotId = sp.get("riotId") ?? "";
  const hashIndex = riotId.lastIndexOf("#");
  if (!(region in PLATFORM_LABELS) || hashIndex <= 0) {
    return new Response("invalid params", { status: 400 });
  }
  const platform = region as PlatformRegion;
  const gameName = riotId.slice(0, hashIndex);
  const tagLine = riotId.slice(hashIndex + 1);

  // 저장된 결과만 사용한다 — 크롤러(OG 미리보기 봇)가 이미지 URL을 긁을 때
  // 분석이 실행되거나 상태가 생기지 않도록, 여기서는 절대 분석하지 않는다.
  const result: MmrEstimate | null =
    (await getStoredResult("deep", platform, gameName, tagLine)) ??
    (await getStoredResult("quick", platform, gameName, tagLine));

  const [bold, regular] = await Promise.all([
    readFile(path.join(process.cwd(), "src/assets/fonts/Pretendard-Bold.ttf")),
    readFile(
      path.join(process.cwd(), "src/assets/fonts/Pretendard-Regular.ttf"),
    ),
  ]);

  // 분석 기록이 없는 소환사 — 분석을 유발하지 않고 안내 카드만 반환
  if (!result) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 24,
            backgroundColor: "#09090b",
            color: "#fafafa",
            fontFamily: "Pretendard",
          }}
        >
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>
            Rift <span style={{ color: "#3b82f6", marginLeft: 8 }}>Lens</span>
          </div>
          <div style={{ display: "flex", fontSize: 52, fontWeight: 700 }}>
            {gameName}
            <span style={{ color: "#71717b" }}>#{tagLine}</span>
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#a1a1aa" }}>
            아직 분석되지 않은 소환사예요 — 검색하면 매칭 구간 분석이
            시작됩니다
          </div>
          <div style={{ display: "flex", fontSize: 22, color: "#52525c" }}>
            rift-lens.xyz
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        fonts: [
          { name: "Pretendard", data: bold, weight: 700 },
          { name: "Pretendard", data: regular, weight: 400 },
        ],
      },
    );
  }

  let emblemUri: string | null = null;
  if (result.estimatedRank) {
    try {
      const png = await readFile(
        path.join(
          process.cwd(),
          "public/ranked-emblems",
          `${result.estimatedRank.tier.toLowerCase()}.png`,
        ),
      );
      emblemUri = `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      // 엠블럼 없이 렌더
    }
  }

  const estColor = result.estimatedRank
    ? TIER_COLORS[result.estimatedRank.tier]
    : "#8888a0";
  const curColor = result.currentRank
    ? TIER_COLORS[result.currentRank.tier]
    : "#8888a0";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#09090b",
          color: "#fafafa",
          padding: "56px 72px",
          fontFamily: "Pretendard",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -260,
            left: 340,
            width: 700,
            height: 560,
            display: "flex",
            background:
              "radial-gradient(circle, rgba(59,130,246,0.28), rgba(59,130,246,0) 70%)",
          }}
        />

        {/* 헤더 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* LogoMark(파비콘)와 동일한 마크 — 비율: 링 r15/64, 포인트 (44,20) r4.5/64 */}
            <div
              style={{
                position: "relative",
                display: "flex",
                width: 44,
                height: 44,
                borderRadius: 10,
                background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 21,
                  height: 21,
                  borderRadius: 999,
                  border: "3px solid #ffffff",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 10,
                  right: 10,
                  display: "flex",
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  backgroundColor: "#fbbf24",
                }}
              />
            </div>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>
              Rift{" "}
              <span style={{ color: "#3b82f6", marginLeft: 8 }}>Lens</span>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#71717b" }}>
            {PLATFORM_LABELS[platform]} · 솔로랭크
          </div>
        </div>

        {/* 본문 */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>
              {result.account.gameName}
              <span style={{ color: "#71717b", marginLeft: 6 }}>
                #{result.account.tagLine}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 28,
                color: "#a1a1aa",
                marginTop: 10,
              }}
            >
              최근 매칭 구간
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 72,
                fontWeight: 700,
                color: estColor,
              }}
            >
              {result.estimatedRank?.label ?? "표본 부족"}
            </div>
            {result.estimatedRank && (
              <div style={{ display: "flex", fontSize: 26, color: "#71717b" }}>
                최근 솔로랭크 경기 로비의 평균 랭크
              </div>
            )}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                marginTop: 14,
                fontSize: 28,
              }}
            >
              <span style={{ color: "#a1a1aa" }}>현재 티어</span>
              <span style={{ color: curColor, fontWeight: 700 }}>
                {result.currentRank?.label ?? "언랭크"}
              </span>
            </div>
          </div>

          {emblemUri && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={emblemUri}
              alt=""
              width={330}
              height={330}
              style={{ objectFit: "contain" }}
            />
          )}
        </div>

        {/* 푸터 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 20,
            color: "#52525c",
          }}
        >
          <div style={{ display: "flex" }}>
            {gapText(
              result.gap,
              result.currentPoints !== null && isApexPoints(result.currentPoints) &&
                result.estimatedPoints !== null && isApexPoints(result.estimatedPoints),
            )}
          </div>
          <div style={{ display: "flex" }}>
            최근 솔로랭크 경기 로비 평균 랭크 집계 · Riot 비공식
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Pretendard", data: bold, weight: 700 },
        { name: "Pretendard", data: regular, weight: 400 },
      ],
      // 재시도·반복 공유 시 브라우저 캐시로 즉시 응답 (user activation 만료 완화)
      headers: { "Cache-Control": "public, max-age=300" },
    },
  );
}
