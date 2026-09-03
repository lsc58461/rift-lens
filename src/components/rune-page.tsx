// 룬 표시 컴포넌트 (순수 — 서버/클라이언트 공용)
// · RuneBadge   : 스펠 옆에 붙는 op.gg식 대표 룬 — 핵심룬(둥근 배경) 위, 보조 트리 아이콘 아래
// · RuneTreeView: 상세용 풀 룬 페이지 — 주 트리(핵심룬 줄 + 3줄) · 보조 트리(3줄) · 능력치 파편(3줄)을
//                 전부 그리고 선택한 것만 밝게, 나머지는 흐리게 (op.gg 룬 탭과 같은 배치)
import Image from "next/image";
import { AssetTip } from "@/components/asset-tip";
import type { RuneInfo, RuneTree } from "@/lib/ddragon";
import { STAT_MODS } from "@/lib/ddragon-assets";

const CDN = "https://ddragon.leagueoflegends.com/cdn/img/";

/** 능력치 파편 배치 — 줄 = 공격 / 유연 / 방어, statPerks 도 같은 순서라 줄 번호로 맞춘다
 *  (적응형 5008 이 1·2줄에, 성장 체력 5001 이 2·3줄에 겹쳐서 id 만으로는 못 맞춤) */
const SHARD_ROWS: readonly (readonly number[])[] = [
  [5008, 5005, 5007],
  [5008, 5010, 5001],
  [5011, 5013, 5001],
];

export function RuneBadge({
  keystone,
  subStyle,
  runeMap,
  size = 22,
}: {
  keystone: number | null | undefined;
  subStyle: number | null | undefined;
  runeMap: Record<number, RuneInfo>;
  size?: number;
}) {
  const k = keystone != null ? runeMap[keystone] : null;
  const s = subStyle != null ? runeMap[subStyle] : null;
  if (!k && !s) return null;
  const sub = Math.round(size * 0.68);
  return (
    <span className="flex shrink-0 flex-col items-center gap-px">
      <AssetTip kind="rune" id={keystone}>
        <span
          className="flex items-center justify-center overflow-hidden rounded-full bg-zinc-950/80 ring-1 ring-foreground/10"
          style={{ width: size, height: size }}
        >
          {k && <Image src={`${CDN}${k.icon}`} alt={k.name} width={size} height={size} unoptimized className="size-full" />}
        </span>
      </AssetTip>
      <AssetTip kind="rune" id={subStyle}>
        <span
          className="flex items-center justify-center rounded-full bg-zinc-950/60 ring-1 ring-foreground/10"
          style={{ width: size, height: size }}
        >
          {s && <Image src={`${CDN}${s.icon}`} alt={s.name} width={sub} height={sub} unoptimized style={{ width: sub, height: sub }} />}
        </span>
      </AssetTip>
    </span>
  );
}

function RuneIcon({
  id,
  info,
  sizeClass,
  selected,
  keystone = false,
}: {
  id: number;
  info: { name: string; icon: string } | undefined;
  sizeClass: string;
  selected: boolean;
  keystone?: boolean;
}) {
  if (!info) return <span className={`${sizeClass} rounded-full bg-foreground/8`} />;
  return (
    <AssetTip kind="rune" id={id}>
    <span
      className={`flex shrink-0 items-center justify-center rounded-full ${sizeClass} ${
        selected
          ? keystone
            ? "bg-zinc-950/80 ring-2 ring-amber-400/80"
            : "ring-1 ring-amber-300/70"
          : "opacity-25 grayscale"
      }`}
    >
      <Image src={`${CDN}${info.icon}`} alt={info.name} width={36} height={36} unoptimized className="size-full" />
    </span>
    </AssetTip>
  );
}

function treeOf(trees: RuneTree[], styleId: number | null | undefined, runeId?: number | null): RuneTree | null {
  if (styleId != null) {
    const t = trees.find((x) => x.id === styleId);
    if (t) return t;
  }
  if (runeId != null) return trees.find((x) => x.slots.some((s) => s.runes.some((r) => r.id === runeId))) ?? null;
  return null;
}

// 아이콘 크기는 화면 폭에 따라 — 핵심룬 4개 줄이 좁은 칸에도 들어가게 (모바일 30px, 이상 34px)
const KEYSTONE = "size-[30px] sm:size-[34px]";
const RUNE = "size-[22px] sm:size-[26px]";

function TreeColumn({
  tree,
  selected,
  withKeystones,
}: {
  tree: RuneTree | null;
  selected: Set<number>;
  withKeystones: boolean;
}) {
  const slots = tree ? (withKeystones ? tree.slots : tree.slots.slice(1)) : [];
  return (
    <div className="flex min-w-0 flex-col items-center gap-2.5">
      <div className="flex h-7 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {tree && <Image src={`${CDN}${tree.icon}`} alt="" width={16} height={16} unoptimized className="size-4" />}
        {tree?.name ?? "—"}
      </div>
      {slots.map((slot, si) => {
        const isKey = withKeystones && si === 0;
        return (
          // 핵심룬 줄(3~4개)과 아래 줄(3개)은 각각 가운데 정렬 — 폭이 달라도 칸 안에서 중앙에 놓인다
          <div key={si} className={`flex items-center justify-center gap-1.5 sm:gap-2.5 ${isKey ? "mb-1" : ""}`}>
            {slot.runes.map((r) => (
              <RuneIcon key={r.id} id={r.id} info={r} sizeClass={isKey ? KEYSTONE : RUNE} selected={selected.has(r.id)} keystone={isKey} />
            ))}
          </div>
        );
      })}
      {!tree && <p className="text-[11px] text-muted-foreground">정보 없음</p>}
    </div>
  );
}

export function RuneTreeView({
  trees,
  keystone,
  perks,
  subStyle,
  subPerks,
  statPerks,
}: {
  trees: RuneTree[];
  keystone: number | null | undefined;
  perks?: number[] | null;
  subStyle: number | null | undefined;
  subPerks?: number[] | null;
  statPerks?: number[] | null;
}) {
  const primary = treeOf(trees, null, keystone);
  const secondary = treeOf(trees, subStyle);
  const chosen = new Set<number>([...(perks ?? []), ...(subPerks ?? [])]);
  if (keystone != null) chosen.add(keystone);
  const shards = statPerks ?? [];

  return (
    // 두 트리 칸은 같은 폭(minmax(0,1fr)) — 핵심룬이 4개인 트리가 칸을 넓혀 3개짜리 옆에 여백이 남던 문제.
    // 좁은 화면(<sm)에선 op.gg 처럼 능력치 파편을 트리 아래 줄로 내린다 (세 줄을 가로로 나란히).
    <div className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-start gap-x-2 rounded-lg border bg-background/50 px-2 py-3 sm:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)_1px_auto] sm:gap-x-4 sm:px-3">
      <TreeColumn tree={primary} selected={chosen} withKeystones />
      <span className="h-full w-px bg-border" />
      <TreeColumn tree={secondary} selected={chosen} withKeystones={false} />
      <span className="hidden h-full w-px bg-border sm:block" />
      <div className="col-span-3 mt-3 flex flex-row flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t pt-3 sm:col-span-1 sm:mt-0 sm:flex-col sm:gap-2.5 sm:border-t-0 sm:pt-0">
        <div className="flex h-7 basis-full items-center justify-center text-xs font-medium text-muted-foreground sm:basis-auto">능력치 파편</div>
        {SHARD_ROWS.map((row, ri) => (
          <div key={ri} className="flex items-center gap-1.5 sm:gap-2">
            {row.map((id, ci) => {
              const mod = STAT_MODS[id];
              const on = shards[ri] === id;
              return (
                <span
                  key={ci}
                  title={mod?.name}
                  className={`flex size-5 items-center justify-center rounded-full bg-foreground/10 p-0.5 sm:size-[22px] ${on ? "ring-1 ring-amber-300/70" : "opacity-25 grayscale"}`}
                >
                  {mod && <Image src={`${CDN}${mod.icon}`} alt={mod.name} width={18} height={18} unoptimized className="size-full" />}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
