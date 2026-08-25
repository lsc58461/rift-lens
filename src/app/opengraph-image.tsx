import { readFile } from "fs/promises";
import path from "path";
import { ImageResponse } from "next/og";

export const alt = "Rift Lens — 롤 매칭 구간 분석";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const EMBLEM_ROW = ["gold", "emerald", "diamond", "challenger"] as const;

export default async function OgImage() {
  const [bold, regular] = await Promise.all([
    readFile(path.join(process.cwd(), "src/assets/fonts/Pretendard-Bold.ttf")),
    readFile(
      path.join(process.cwd(), "src/assets/fonts/Pretendard-Regular.ttf"),
    ),
  ]);
  const emblems = await Promise.all(
    EMBLEM_ROW.map(async (tier) => {
      const png = await readFile(
        path.join(process.cwd(), "public/ranked-emblems", `${tier}.png`),
      );
      return `data:image/png;base64,${png.toString("base64")}`;
    }),
  );

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
          backgroundColor: "#09090b",
          color: "#fafafa",
          fontFamily: "Pretendard",
          position: "relative",
          gap: 28,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -300,
            left: 300,
            width: 800,
            height: 640,
            display: "flex",
            background:
              "radial-gradient(circle, rgba(59,130,246,0.30), rgba(59,130,246,0) 70%)",
          }}
        />

        {/* 로고 */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* LogoMark(파비콘)와 동일한 마크 */}
          <div
            style={{
              position: "relative",
              display: "flex",
              width: 64,
              height: 64,
              borderRadius: 14,
              background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                width: 30,
                height: 30,
                borderRadius: 999,
                border: "4.5px solid #ffffff",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 14,
                right: 14,
                display: "flex",
                width: 9,
                height: 9,
                borderRadius: 999,
                backgroundColor: "#fbbf24",
              }}
            />
          </div>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>
            Rift <span style={{ color: "#3b82f6", marginLeft: 10 }}>Lens</span>
          </div>
        </div>

        {/* 헤드라인 */}
        <div
          style={{
            display: "flex",
            fontSize: 76,
            fontWeight: 700,
            textAlign: "center",
          }}
        >
          나는 어느 구간에서 매칭되고 있을까?
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "#a1a1aa",
            textAlign: "center",
          }}
        >
          최근 솔로랭크 경기 로비의 평균 랭크로 매칭 구간을 보여드립니다
        </div>

        {/* 티어 엠블럼 행 */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 34,
            marginTop: 16,
          }}
        >
          {emblems.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt=""
              width={i === emblems.length - 1 ? 120 : 92}
              height={i === emblems.length - 1 ? 120 : 92}
              style={{ objectFit: "contain", opacity: 0.95 }}
            />
          ))}
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 36,
            display: "flex",
            fontSize: 22,
            color: "#52525c",
          }}
        >
          rift-lens.xyz · Riot 비공식
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Pretendard", data: bold, weight: 700 },
        { name: "Pretendard", data: regular, weight: 400 },
      ],
    },
  );
}
