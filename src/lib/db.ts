// 공유 Postgres 클라이언트 + 스키마 초기화.
// 도메인 테이블(store.ts)과 범용 KV(cache.ts)가 모두 이 커넥션을 사용한다.

import "server-only";
import type { Sql } from "postgres";

const globalForDb = globalThis as unknown as {
  __mmrSql?: Promise<Sql>;
  __mmrTick?: { last: number };
};

// DDL 본문 — 아래 해시가 이 문자열로부터 계산되므로 내용이 바뀌면 자동으로
// 새 버전이 되어 다음 부팅에서 한 번 실행된다.
const SCHEMA_SQL = `

    -- 범용 KV — 잡 상태·락·대기열·쿨다운·점검 플래그 등 휘발성 데이터 전용
    CREATE TABLE IF NOT EXISTS cache_entries (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      expires_at timestamptz NOT NULL
    );

    -- 소환사 (계정 + 프로필). puuid는 API 키 단위 암호화라 fp(키 지문)로 스코프
    CREATE TABLE IF NOT EXISTS summoners (
      fp text NOT NULL,
      puuid text NOT NULL,
      platform text NOT NULL,
      game_name text NOT NULL,
      tag_line text NOT NULL,
      profile_icon_id int,
      summoner_level int,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (fp, puuid)
    );
    -- 이름 조회는 NFKC로 접은 뒤 비교한다(전각 태그 대응) — 인덱스도 같은 식이어야
    -- 한다. 기존 lower()만 쓰던 인덱스는 식이 달라 못 타므로 교체한다.
    DROP INDEX IF EXISTS summoners_name_idx;
    CREATE INDEX IF NOT EXISTS summoners_canon_idx
    ON summoners (fp, platform, lower(normalize(game_name, NFKC)), lower(normalize(tag_line, NFKC)));

    -- 매치 메타 (불변 데이터). 참가자는 match_participants 가 유일한 원본 (2026-08-30 JSON 제거).
    CREATE TABLE IF NOT EXISTS matches (
      fp text NOT NULL,
      match_id text NOT NULL,
      platform text NOT NULL,
      game_creation bigint NOT NULL,
      game_duration int NOT NULL,
      queue_id int NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (fp, match_id)
    );
    -- 옛 participants(jsonb) 컬럼 제거 — 데이터는 전부 match_participants 로 옮겨졌다
    ALTER TABLE matches DROP COLUMN IF EXISTS participants;

    -- 랭크 스냅샷 — 조회 시점마다 적재(히스토리). LP 득실 추적의 기반
    CREATE TABLE IF NOT EXISTS league_snapshots (
      id bigserial PRIMARY KEY,
      fp text NOT NULL,
      platform text NOT NULL,
      puuid text NOT NULL,
      solo_tier text,
      solo_rank text,
      solo_lp int,
      solo_wins int,
      solo_losses int,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    -- 옛 entries(jsonb) 제거 — 컬럼(solo_*/flex_*/other_entries)으로 전부 옮김 (2026-08-30)
    ALTER TABLE league_snapshots DROP COLUMN IF EXISTS entries;
    -- entries(jsonb)를 컬럼으로 분해 (2026-08-30): 솔로 플래그·자유랭크 전부, 그 외 큐는 other_entries
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS solo_hot_streak boolean;
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS solo_veteran boolean;
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS solo_fresh_blood boolean;
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS solo_inactive boolean;
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS flex_tier text;
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS flex_rank text;
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS flex_lp int;
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS flex_wins int;
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS flex_losses int;
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS flex_hot_streak boolean;
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS flex_veteran boolean;
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS flex_fresh_blood boolean;
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS flex_inactive boolean;
    ALTER TABLE league_snapshots ADD COLUMN IF NOT EXISTS other_entries jsonb;
    ALTER TABLE league_snapshots DROP COLUMN IF EXISTS cols_synced;
    CREATE INDEX IF NOT EXISTS league_snap_idx
    ON league_snapshots (fp, platform, puuid, created_at DESC);
    -- rank_pts 계산은 platform 없이 (fp, puuid)로 최신 스냅샷을 찾으므로 전용 인덱스
    CREATE INDEX IF NOT EXISTS league_snap_puuid_idx
    ON league_snapshots (fp, puuid, created_at DESC);

    -- 분석 결과 (quick/deep) — 소환사·종류당 1행 upsert
    CREATE TABLE IF NOT EXISTS analyses (
      platform text NOT NULL,
      game_name_lower text NOT NULL,
      tag_line_lower text NOT NULL,
      kind text NOT NULL,
      game_name text NOT NULL,
      tag_line text NOT NULL,
      algo_version int,
      latest_match_id text,
      analyzed_at timestamptz,
      result jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (platform, game_name_lower, tag_line_lower, kind)
    );

    -- 최근 검색 — 소환사당 1행 upsert
    CREATE TABLE IF NOT EXISTS recent_searches (
      platform text NOT NULL,
      game_name_lower text NOT NULL,
      tag_line_lower text NOT NULL,
      game_name text NOT NULL,
      tag_line text NOT NULL,
      current_label text,
      current_tier text,
      estimated_label text,
      estimated_tier text,
      estimated_points double precision,
      searched_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (platform, game_name_lower, tag_line_lower)
    );
    CREATE INDEX IF NOT EXISTS recent_searches_time_idx
    ON recent_searches (searched_at DESC);

    CREATE TABLE IF NOT EXISTS admin_users (
      username text PRIMARY KEY,
      salt text NOT NULL,
      hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );

    -- 앱 설정 (디스코드 웹훅 등 — 어드민에서 관리)
    CREATE TABLE IF NOT EXISTS app_settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- 디스코드 알림 채널 — 봇이 초대된 길드별로 관리자가 /rift-alerts로 지정.
    -- 게이트웨이 봇(bots/discord)이 다운/복구 알림을 여기 등록된 채널로 보낸다.
    CREATE TABLE IF NOT EXISTS discord_alert_channels (
      guild_id text PRIMARY KEY,
      channel_id text NOT NULL,
      set_by text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- 업데이트 내역(체인지로그) — 재배포 없이 어드민에서 관리한다.
    -- items: [{"tag":"신규|개선|수정","text":"..."}]. entry_date는 표시용 문자열.
    CREATE TABLE IF NOT EXISTS changelog_entries (
      id bigserial PRIMARY KEY,
      entry_date text NOT NULL,
      title text NOT NULL,
      items jsonb NOT NULL DEFAULT '[]'::jsonb,
      published boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS changelog_order_idx
    ON changelog_entries (entry_date DESC, id DESC);

    -- 방문 로그 — 관리자 통계용(시간대 분포). 소환사 페이지가 실제로 열릴 때
    -- 한 줄씩 쌓고, 오래된 행은 새벽 크론이 정리한다. 봇 트래픽은 기록하지 않는다.
    CREATE TABLE IF NOT EXISTS visit_log (
      id bigserial PRIMARY KEY,
      platform text NOT NULL,
      game_name text NOT NULL,
      tag_line text NOT NULL,
      source text NOT NULL DEFAULT 'user', -- user | tool
      at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS visit_log_at_idx ON visit_log (at DESC);

    ALTER TABLE matches ADD COLUMN IF NOT EXISTS patch text;
    -- 확장 필드 캡처 완료 표시 — 도입 전 매치는 false라, 백필이 본문을 재수집해
    -- 밴·팀·participant 확장 필드를 채우고 true로 바꾼다.
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS fields_captured boolean NOT NULL DEFAULT false;
    -- 매치 평균 랭크점수(참가자 중 랭크를 아는 인원의 평균) — 챔피언 통계 랭크 필터용.
    -- league_snapshots에서 계산해 채운다. 랭크 아는 참가자가 없으면 NULL.
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS rank_pts int;
    CREATE INDEX IF NOT EXISTS matches_rankpts_idx ON matches (fp, rank_pts);
    -- 타임라인(빌드 데이터) 수확 완료 표시 — 백필이 남은 작업을 찾는 기준
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS build_harvested boolean NOT NULL DEFAULT false;
    CREATE INDEX IF NOT EXISTS matches_fp_patch_idx ON matches (fp, patch);

    -- 시작 아이템 집계 — 타임라인(첫 90초 구매)에서 수확. 챔피언 통계용
    CREATE TABLE IF NOT EXISTS start_items (
      fp text NOT NULL,
      champ text NOT NULL,
      items text NOT NULL, -- 정렬된 아이템 id를 쉼표로 연결
      games int NOT NULL DEFAULT 0,
      wins int NOT NULL DEFAULT 0,
      PRIMARY KEY (fp, champ, items)
    );

    -- 코어 아이템 빌드 순서 집계 — 타임라인의 완성 아이템 구매 순서 상위 3개
    CREATE TABLE IF NOT EXISTS build_paths (
      fp text NOT NULL,
      champ text NOT NULL,
      path text NOT NULL, -- 아이템 id를 '>'로 연결 (구매 순서)
      games int NOT NULL DEFAULT 0,
      wins int NOT NULL DEFAULT 0,
      PRIMARY KEY (fp, champ, path)
    );

    -- 닉변 이력 — 옛 이름 → 현재 이름 매핑. API 키가 바뀌어도(puuid 재암호화)
    -- 이름 매핑은 살아남아 옛 링크 리다이렉트가 계속 동작한다.
    CREATE TABLE IF NOT EXISTS name_history (
      platform text NOT NULL,
      old_name_lower text NOT NULL,
      old_tag_lower text NOT NULL,
      new_game_name text NOT NULL,
      new_tag_line text NOT NULL,
      changed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (platform, old_name_lower, old_tag_lower)
    );

    -- 닉변 승계용 puuid 인덱스 (닉네임이 바뀌어도 같은 계정으로 이어짐)
    ALTER TABLE analyses ADD COLUMN IF NOT EXISTS puuid text;
    CREATE INDEX IF NOT EXISTS analyses_puuid_idx ON analyses (puuid, kind);
    ALTER TABLE recent_searches ADD COLUMN IF NOT EXISTS puuid text;
    CREATE INDEX IF NOT EXISTS recent_searches_puuid_idx ON recent_searches (puuid);

    -- 백필 대상(룬·빌드·확장 필드 미수집) 부분 인덱스 — 카운트와 라운드 선별이
    -- 33만 건 전체 스캔 대신 여기만 본다 (rune-backfill.ts PENDING_WHERE와 동일 조건)
    CREATE INDEX IF NOT EXISTS matches_backfill_pending_idx
    ON matches (fp, game_creation DESC)
    WHERE patch IS NULL OR NOT build_harvested OR NOT fields_captured;

    -- 아펙스 래더(챌린저·그마) 명단 — 30분마다 통째로 교체. 컷·랭킹 페이지용.
    CREATE TABLE IF NOT EXISTS apex_ladder (
      fp text NOT NULL,
      platform text NOT NULL,
      tier text NOT NULL,
      rank_no int NOT NULL,
      puuid text NOT NULL,
      lp int NOT NULL,
      wins int NOT NULL,
      losses int NOT NULL,
      hot_streak boolean NOT NULL DEFAULT false,
      veteran boolean NOT NULL DEFAULT false,
      fresh_blood boolean NOT NULL DEFAULT false,
      fetched_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (fp, platform, tier, puuid)
    );
    CREATE INDEX IF NOT EXISTS apex_ladder_rank_idx ON apex_ladder (fp, platform, tier, rank_no);

    -- 시즌 마감 시점 확정 랭크 — 라이엇이 과거 시즌 랭크를 안 주므로 우리가 마감 직전에 기록
    CREATE TABLE IF NOT EXISTS season_ranks (
      fp text NOT NULL,
      platform text NOT NULL,
      puuid text NOT NULL,
      game_name text NOT NULL,
      tag_line text NOT NULL,
      game_name_lower text NOT NULL,
      tag_line_lower text NOT NULL,
      season text NOT NULL,
      tier text NOT NULL,
      rank text,
      lp int,
      wins int,
      losses int,
      captured_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (fp, platform, puuid, season)
    );
    CREATE INDEX IF NOT EXISTS season_ranks_name_idx
    ON season_ranks (fp, platform, season, game_name_lower, tag_line_lower);

    -- 참가자 정규화 테이블 — matches.participants(jsonb)에서 파생 (1행 = 1참가자).
    -- 참가자 단위 집계(챔피언 통계·후보 검색·puuid 조회)를 JSON 펼치기 없이 처리한다.
    CREATE TABLE IF NOT EXISTS match_participants (
      fp text NOT NULL,
      match_id text NOT NULL,
      platform text NOT NULL,
      puuid text NOT NULL,
      idx smallint NOT NULL,
      team_id smallint NOT NULL,
      win boolean NOT NULL,
      champion_name text NOT NULL,
      champion_id int,
      team_position text NOT NULL DEFAULT '',
      riot_game_name text NOT NULL DEFAULT '',
      riot_tag_line text NOT NULL DEFAULT '',
      kills smallint NOT NULL DEFAULT 0,
      deaths smallint NOT NULL DEFAULT 0,
      assists smallint NOT NULL DEFAULT 0,
      cs int, gold int, damage int, damage_taken int, vision smallint, champ_level smallint,
      spell1 int, spell2 int, keystone int, sub_style int,
      items int[] NOT NULL DEFAULT '{}',
      double_kills smallint NOT NULL DEFAULT 0,
      triple_kills smallint NOT NULL DEFAULT 0,
      quadra_kills smallint NOT NULL DEFAULT 0,
      penta_kills smallint NOT NULL DEFAULT 0,
      kill_participation real,
      game_creation bigint NOT NULL,
      game_duration int NOT NULL,
      queue_id int NOT NULL,
      patch text,
      rank_pts real,
      PRIMARY KEY (fp, match_id, puuid)
    );
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS perks int[];
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS sub_perks int[];
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS stat_perks int[];
    -- 참가자 확장 필드 전부 컬럼화 — JSON(matches.participants)을 없애고 이 테이블을
    -- 유일한 원본으로 만들기 위한 1단계 (2026-08-30)
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS individual_position text;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS cs_total int;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS cs_jungle int;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS gold_spent int;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS damage_mitigated int;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS damage_to_objectives int;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS damage_to_turrets int;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS total_heal int;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS heal_on_teammates int;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS shield_on_teammates int;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS cc_score int;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS turret_kills smallint;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS inhibitor_kills smallint;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS dragon_kills smallint;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS baron_kills smallint;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS objectives_stolen smallint;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS wards_placed smallint;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS wards_killed smallint;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS control_wards_bought smallint;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS largest_killing_spree smallint;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS largest_multi_kill smallint;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS solo_kills smallint;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS first_blood_kill boolean;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS first_tower_kill boolean;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS game_ended_in_surrender boolean;
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS game_ended_in_early_surrender boolean;
    -- 확장 필드(위 컬럼들)를 JSON에서 옮겼는지 — 컬럼이 나중에 추가돼 기존 행 채우기용
    ALTER TABLE match_participants ADD COLUMN IF NOT EXISTS ext_synced boolean NOT NULL DEFAULT false;
    CREATE INDEX IF NOT EXISTS mp_patch_champ_idx ON match_participants (fp, patch, champion_name);
    CREATE INDEX IF NOT EXISTS mp_puuid_time_idx ON match_participants (fp, puuid, game_creation DESC);
    CREATE INDEX IF NOT EXISTS mp_patch_rank_idx ON match_participants (fp, patch, rank_pts);
    CREATE INDEX IF NOT EXISTS mp_name_idx ON match_participants (fp, lower(riot_game_name), lower(riot_tag_line));

    -- 전체 갱신 순회 큐 — 바퀴(pass) 시작 때 순서를 고정 스냅샷으로 만든다.
    -- 상태 우선순위(캐시 만료 → 빠른 스테일 → 빠른 → 정밀 스테일 → 정밀 최신) 순.
    -- 순회 중 상태가 바뀌어도 순번이 안 움직여 커서 누락이 없다.
    CREATE TABLE IF NOT EXISTS refresh_queue (
      fp text NOT NULL,
      pass_id int NOT NULL,
      pos int NOT NULL,
      platform text NOT NULL,
      game_name text NOT NULL,
      tag_line text NOT NULL,
      prio smallint NOT NULL,
      PRIMARY KEY (fp, pass_id, pos)
    );

    -- 옛 밴·팀요약 jsonb 제거 — match_bans / match_teams 로 전부 옮김 (2026-08-30)
    ALTER TABLE matches DROP COLUMN IF EXISTS bans;
    ALTER TABLE matches DROP COLUMN IF EXISTS teams;
    -- 경기 밴 (경기당 최대 10행) — 챔피언 통계 밴률 집계가 인덱스를 탄다
    CREATE TABLE IF NOT EXISTS match_bans (
      fp text NOT NULL,
      match_id text NOT NULL,
      champion_id int NOT NULL,
      team_id smallint,
      pick_turn smallint,
      PRIMARY KEY (fp, match_id, champion_id)
    );
    CREATE INDEX IF NOT EXISTS match_bans_champ_idx ON match_bans (fp, champion_id);
    -- 경기 팀 요약 (경기당 2행) — 스코어보드 팀 오브젝트 비교
    CREATE TABLE IF NOT EXISTS match_teams (
      fp text NOT NULL,
      match_id text NOT NULL,
      team_id smallint NOT NULL,
      win boolean NOT NULL,
      first_blood boolean,
      first_tower boolean,
      dragon smallint,
      herald smallint,
      baron smallint,
      tower smallint,
      inhibitor smallint,
      atakhan smallint,
      PRIMARY KEY (fp, match_id, team_id)
    );

    -- 문의·버그 신고 접수함 (/feedback → 관리자 문의함). notified는 예약 컬럼(현재 미사용).
    CREATE TABLE IF NOT EXISTS feedback (
      id bigserial PRIMARY KEY,
      kind text NOT NULL,
      email text NOT NULL,
      message text NOT NULL,
      summoner text,
      page text,
      user_agent text,
      ip text,
      status text NOT NULL DEFAULT 'new',
      note text,
      notified boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback (status, created_at DESC);

    -- 디스코드 연동 제거(2026-08-20): verified_summoners 테이블은 생성·사용하지
    -- 않으며, 기존 배포에 남아 있던 테이블도 DROP 완료.
`;

/** FNV-1a 32bit — 스키마 문자열 지문 (암호학적 강도 불필요) */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
const SCHEMA_VERSION = `v1-${fnv1a(SCHEMA_SQL)}`;

async function initSchema(sql: Sql): Promise<void> {
  // 같은 스키마가 이미 적용돼 있으면 DDL을 통째로 건너뛴다.
  // ALTER TABLE ... ADD COLUMN IF NOT EXISTS는 컬럼이 있어도 ACCESS EXCLUSIVE 락을
  // 잡아서, 매치 테이블을 오래 읽는 쿼리(시드 후보 조회 등)가 있으면 부팅이
  // 그 뒤에 줄을 서고 advisory lock을 쥔 채 멈춰 다른 인스턴스까지 막았다.
  // (테이블이 아직 없으면 조회가 실패하므로 그때는 전체 실행)
  const applied = await sql`
    SELECT value FROM app_settings WHERE key = 'schema:version'`
    .then((r) => r[0]?.value as string | undefined)
    .catch(() => undefined);
  if (applied === SCHEMA_VERSION) return;

  // 콜드 스타트 비용을 줄이기 위해 전체 DDL을 단일 왕복으로 실행한다.
  // 파라미터가 없으므로 simple 프로토콜 = 배치 전체가 하나의 암묵적 트랜잭션이고,
  // 첫 줄의 advisory lock이 커밋까지 유지된다. lock_timeout으로 무한 대기 대신
  // 실패시키고(컨테이너가 재시작하며 재시도) 버전 기록도 같은 트랜잭션에 넣는다.
  await sql.unsafe(`
    SELECT pg_advisory_xact_lock(4919, 1);
    SET LOCAL lock_timeout = '120s';
    ${SCHEMA_SQL}
    INSERT INTO app_settings (key, value)
    VALUES ('schema:version', '"${SCHEMA_VERSION}"'::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  `);
}

async function createSql(): Promise<Sql> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다 (.env.local)");
  }
  const postgres = (await import("postgres")).default;
  // 서버리스 전제 설정:
  // - connect_timeout: 풀 포화 시 무한 대기 대신 빠르게 실패시킨다
  //   (없으면 함수 제한까지 매달려 "API가 안 옴"으로 보인다)
  // - idle_timeout은 쓰지 않는다: 유휴 커넥션을 닫는 타이머와 병렬 쿼리
  //   발사가 겹치면 쿼리가 에러 없이 유실돼 promise가 영원히 안 풀리는
  //   경합이 있다(집계 행의 원인). 죽은 소켓은 getSql의 해동 헬스체크가
  //   처리하고, 트랜잭션 풀러라 유휴 클라이언트 커넥션 유지 부담도 없다
  const sql = postgres(url, {
    max: 5,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
  });
  await initSchema(sql);
  return sql;
}

// ── 동결 감지 ────────────────────────────────────────────
// Vercel은 요청이 없으면 인스턴스를 동결하고, 그때 풀의 소켓이 산 채로
// 얼어붙는다(해동 후 재사용하면 응답이 영영 안 옴). 예전엔 SELECT 1
// 헬스체크로 감지했지만, 풀이 무거운 쿼리로 바쁠 때도 4초 안에 답을 못 해
// '죽음'으로 오판하고 멀쩡한 풀을 죽이는 사고가 났다(집계 행의 원인).
// 대신 하트비트 타이머를 쓴다: 타이머는 동결 중에 멈추므로, 마지막 틱이
// 오래됐는데 지금 코드가 돌고 있다 = 방금 해동됐다는 뜻이다. 해동 직후엔
// 진행 중인 쿼리가 있을 수 없어 풀 교체가 안전하다.
const TICK_MS = 5_000;
const FROZEN_GAP_MS = 20_000; // 틱을 3번 이상 놓쳤으면 동결됐다 깨어난 것

function ensureTicker(): void {
  const g = globalForDb;
  if (g.__mmrTick) return;
  g.__mmrTick = { last: Date.now() };
  const timer = setInterval(() => {
    g.__mmrTick!.last = Date.now();
  }, TICK_MS);
  // 로컬 프로세스가 타이머 때문에 안 죽는 것 방지 (서버리스에선 무의미)
  (timer as { unref?: () => void }).unref?.();
}

export async function getSql(): Promise<Sql> {
  const g = globalForDb;
  ensureTicker();

  const thawed =
    g.__mmrSql && g.__mmrTick && Date.now() - g.__mmrTick.last > FROZEN_GAP_MS;
  if (thawed) {
    // 동결 전의 풀은 소켓이 죽어 있을 수 있다 — 통째로 교체
    const dead = g.__mmrSql;
    g.__mmrSql = undefined;
    void dead?.then((sql) => sql.end({ timeout: 5 })).catch(() => {});
  }
  g.__mmrTick!.last = Date.now();

  if (!g.__mmrSql) {
    const fresh = (g.__mmrSql = createSql());
    // 초기화 실패를 캐시에 남기면 이 인스턴스는 영영 고장 상태가 된다
    fresh.catch(() => {
      if (g.__mmrSql === fresh) g.__mmrSql = undefined;
    });
  }
  return g.__mmrSql;
}
