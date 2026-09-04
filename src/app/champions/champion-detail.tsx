"use client";

// 챔피언 상세 본문 — 평균 지표·포지션·스펠·아이템·빌드 경로·룬.
// 예전엔 목록의 모달이었는데, 모달은 주소가 없어 검색엔진·AI 가 내용에 닿지 못했다(2026-09-03).
// 지금은 /champions/[champion] 페이지가 이걸 그리고, 목록 행은 그 페이지로 가는 링크다.

import { useState } from "react";
import Image from "next/image";
import { AssetTip } from "@/components/asset-tip";
import { RuneTreeView } from "@/components/rune-page";
import { itemIconUrl, spellIconUrl, STAT_MODS } from "@/lib/ddragon-assets";
import type { ChampionStat } from "@/lib/champion-stats";
import type { RuneInfo, RuneTree } from "@/lib/ddragon";
import { adjustedRate, POSITION_LABEL, WinrateText } from "./shared";

export function ChampionDetail({
  c,
  version,
  runeMap,
  runeTrees,
}: {
  c: ChampionStat;
  version: string;
  runeMap: Record<number, RuneInfo>;
  runeTrees: RuneTree[];
}) {
  const kda =
    c.avgDeaths > 0
      ? ((c.avgKills + c.avgAssists) / c.avgDeaths).toFixed(2)
      : "Perfect";
  const posEntries = Object.entries(c.positions).sort(
    (a, b) => b[1].games - a[1].games,
  );
  const bestSpell = [...c.spells].sort(
    (a, b) => adjustedRate(b.wins, b.games) - adjustedRate(a.wins, a.games),
  )[0];

  return (
    <div className="space-y-5">
      {/* 평균 지표 */}
      <section className="grid grid-cols-3 gap-2">
        <MetricTile
          label="평균 KDA"
          value={kda}
          sub={`${c.avgKills.toFixed(1)} / ${c.avgDeaths.toFixed(1)} / ${c.avgAssists.toFixed(1)}`}
        />
        <MetricTile
          label="평균 CS"
          value={c.avgCs.toFixed(0)}
          sub="경기당"
        />
        <MetricTile
          label="평균 딜량"
          value={
            c.avgDamage >= 1000
              ? `${(c.avgDamage / 1000).toFixed(1)}k`
              : c.avgDamage.toFixed(0)
          }
          sub="챔피언 대상"
        />
      </section>

      {/* 포지션별 성적 */}
      <section>
        <SectionLabel>포지션별 성적</SectionLabel>
        <div className="space-y-1.5">
          {posEntries.map(([pos, p]) => (
            <div
              key={pos}
              className="grid grid-cols-[3rem_1fr_5.5rem] items-center gap-2 text-xs"
            >
              <span className="text-muted-foreground">
                {POSITION_LABEL[pos] ?? pos}
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-foreground/8">
                <span
                  className="block h-full rounded-full bg-primary/70"
                  style={{
                    width: `${(p.games / c.games) * 100}%`,
                  }}
                />
              </span>
              <span className="text-right tabular-nums text-muted-foreground">
                {p.games}판 · <WinrateText wins={p.wins} games={p.games} />
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 시작 아이템 */}
      <section>
        <SectionLabel>시작 아이템</SectionLabel>
        {c.startItems.length === 0 && (
          <p className="text-xs text-muted-foreground">
            시작 아이템 데이터는 수집 중이에요
          </p>
        )}
        <div className="space-y-1.5">
          {c.startItems.map((si, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="flex gap-1">
                {Object.entries(
                  si.items.reduce<Record<number, number>>((acc, id) => {
                    acc[id] = (acc[id] ?? 0) + 1;
                    return acc;
                  }, {}),
                ).map(([id, count]) => {
                  const url = itemIconUrl(version, Number(id));
                  return (
                    <span key={id} className="relative">
                      {url ? (
                        <AssetTip kind="item" id={Number(id)}>
                          <Image
                            src={url}
                            alt=""
                            width={24}
                            height={24}
                            unoptimized
                            className="size-6 rounded"
                          />
                        </AssetTip>
                      ) : (
                        <span className="size-6 rounded bg-foreground/8" />
                      )}
                      {count > 1 && (
                        <span className="absolute -right-1 -bottom-1 rounded bg-background px-0.5 text-[9px] font-bold tabular-nums ring-1 ring-foreground/10">
                          {count}
                        </span>
                      )}
                    </span>
                  );
                })}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {si.games}판
              </span>
              <span className="ml-auto font-medium">
                <WinrateText wins={si.wins} games={si.games} />
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 스펠 조합 */}
      <section>
        <SectionLabel>스펠 조합</SectionLabel>
        {c.spells.length === 0 && <Empty />}
        <div className="space-y-1.5">
          {c.spells.map((s) => (
            <div
              key={`${s.s1}-${s.s2}`}
              className="flex items-center gap-2 text-xs"
            >
              <span className="flex gap-1">
                {[s.s1, s.s2].map((id, i) => {
                  const url = spellIconUrl(version, id);
                  return url ? (
                    <AssetTip key={i} kind="spell" id={id}>
                      <Image
                        src={url}
                        alt=""
                        width={24}
                        height={24}
                        unoptimized
                        className="size-6 rounded"
                      />
                    </AssetTip>
                  ) : (
                    <span key={i} className="size-6 rounded bg-foreground/8" />
                  );
                })}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {s.games}판
              </span>
              {bestSpell === s && c.spells.length > 1 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  추천
                </span>
              )}
              <span className="ml-auto font-medium">
                <WinrateText wins={s.wins} games={s.games} />
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 코어 빌드 순서 */}
      <section>
        <SectionLabel>코어 아이템 순서</SectionLabel>
        {c.buildPaths.length === 0 && (
          <p className="text-xs text-muted-foreground">
            빌드 순서 데이터는 수집 중이에요
          </p>
        )}
        <div className="space-y-1.5">
          {c.buildPaths.map((bp, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              {bp.items.map((id, j) => {
                const url = itemIconUrl(version, id);
                return (
                  <span key={j} className="flex items-center gap-1.5">
                    {url ? (
                      <AssetTip kind="item" id={id}>
                        <Image
                          src={url}
                          alt=""
                          width={26}
                          height={26}
                          unoptimized
                          className="size-6.5 rounded"
                        />
                      </AssetTip>
                    ) : (
                      <span className="size-6.5 rounded bg-foreground/8" />
                    )}
                    {j < bp.items.length - 1 && (
                      <span className="text-muted-foreground/50">›</span>
                    )}
                  </span>
                );
              })}
              <span className="ml-1 tabular-nums text-muted-foreground">
                {bp.games}판
              </span>
              <span className="ml-auto font-medium">
                <WinrateText wins={bp.wins} games={bp.games} />
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 아이템 */}
      <section>
        <SectionLabel>자주 나온 아이템</SectionLabel>
        {c.items.length === 0 && <Empty />}
        <div className="grid grid-cols-6 gap-x-2 gap-y-2.5">
          {c.items.map((it) => {
            const url = itemIconUrl(version, it.id);
            return (
              <div
                key={it.id}
                className="flex flex-col items-center gap-0.5"
                title={`${it.games}판`}
              >
                {url ? (
                  <AssetTip kind="item" id={it.id}>
                    <Image
                      src={url}
                      alt=""
                      width={32}
                      height={32}
                      unoptimized
                      className="size-8 rounded"
                    />
                  </AssetTip>
                ) : (
                  <span className="size-8 rounded bg-foreground/8" />
                )}
                <span className="text-[10px]">
                  <WinrateText wins={it.wins} games={it.games} />
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* 룬 */}
      <section>
        <SectionLabel>룬</SectionLabel>
        {c.runes.length === 0 && (
          <p className="text-xs text-muted-foreground">
            룬 데이터는 수집 중이에요 — 새 경기가 쌓이면 표시됩니다
          </p>
        )}
        <RunePages runes={c.runes} runeMap={runeMap} runeTrees={runeTrees} />
      </section>
    </div>
  );
}

/** 룬 페이지 목록 — 요약 행을 누르면 아래 풀 트리(op.gg 룬 탭 배치)에 그 페이지가 펼쳐진다 */
function RunePages({
  runes,
  runeMap,
  runeTrees,
}: {
  runes: ChampionStat["runes"];
  runeMap: Record<number, RuneInfo>;
  runeTrees: RuneTree[];
}) {
  const [idx, setIdx] = useState(0);
  const sel = runes[Math.min(idx, runes.length - 1)];
  return (
    <div className="space-y-2">
      {runes.map((r, i) => (
        <RunePage key={i} r={r} runeMap={runeMap} selected={i === idx} onSelect={() => setIdx(i)} />
      ))}
      {sel && runeTrees.length > 0 && (
        <RuneTreeView
          trees={runeTrees}
          keystone={sel.keystone}
          perks={sel.perks}
          subStyle={sel.subStyle}
          subPerks={sel.subPerks}
          statPerks={sel.statPerks}
        />
      )}
    </div>
  );
}

/** 룬 페이지 요약 행 — 핵심룬 크게 + 나머지 3 · 보조 2 · 파편 3, 판수·승률 */
function RunePage({
  r,
  runeMap,
  selected,
  onSelect,
}: {
  r: ChampionStat["runes"][number];
  runeMap: Record<number, RuneInfo>;
  selected: boolean;
  onSelect: () => void;
}) {
  const runeImg = (id: number, size: string, dim = false) => {
    const info = runeMap[id];
    return info ? (
      <AssetTip kind="rune" id={id}>
        <Image
          src={`https://ddragon.leagueoflegends.com/cdn/img/${info.icon}`}
          alt={info.name}
          width={28}
          height={28}
          unoptimized
          className={`${size} ${dim ? "opacity-90" : ""}`}
        />
      </AssetTip>
    ) : (
      <span className={`${size} rounded-full bg-foreground/8`} />
    );
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${
        selected ? "border-primary/50 bg-primary/5" : "bg-background/50 hover:bg-accent/40"
      }`}
    >
      {/* 주 트리: 핵심룬 크게 + 나머지 3개 */}
      <div className="flex items-center gap-1">
        {runeImg(r.keystone, "size-8 shrink-0")}
        {r.perks.slice(1).map((id, i) => (
          <span key={i}>{runeImg(id, "size-5 shrink-0", true)}</span>
        ))}
      </div>
      <span className="h-6 w-px shrink-0 bg-border" />
      {/* 보조 트리 + 2개 */}
      <div className="flex items-center gap-1">
        {runeImg(r.subStyle, "size-4 shrink-0", true)}
        {r.subPerks.map((id, i) => (
          <span key={i}>{runeImg(id, "size-5 shrink-0", true)}</span>
        ))}
      </div>
      <span className="h-6 w-px shrink-0 bg-border" />
      {/* 능력치 파편 */}
      <div className="flex items-center gap-1">
        {r.statPerks.map((id, i) => {
          const mod = STAT_MODS[id];
          return mod ? (
            <AssetTip key={i} kind="rune" id={id}>
              <Image
                src={`https://ddragon.leagueoflegends.com/cdn/img/${mod.icon}`}
                alt={mod.name}
                width={16}
                height={16}
                unoptimized
                className="size-4 rounded-full bg-foreground/10 p-0.5"
              />
            </AssetTip>
          ) : (
            <span key={i} className="size-4 rounded-full bg-foreground/8" />
          );
        })}
      </div>
      <span className="ml-auto shrink-0 text-right text-xs">
        <span className="mr-1.5 tabular-nums text-muted-foreground">
          {r.games}판
        </span>
        <span className="font-medium">
          <WinrateText wins={r.wins} games={r.games} />
        </span>
      </span>
    </button>
  );
}

function MetricTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border p-2.5 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] tabular-nums text-muted-foreground">
        {sub}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-muted-foreground">표본이 부족해요</p>;
}
