// 관리자 대시보드 — 데이터베이스가 디스크를 얼마나 쓰고 있나.
//
// 실데이터는 지우지 않는 방침이라(만료 캐시만 청소) 용량은 단조 증가한다.
// 그래서 "DB 가 몇 GB 인가"보다 "디스크가 얼마나 남았나"가 실제로 봐야 할 숫자다.
// 디스크는 앱 컨테이너에서 statfs 로 읽는다 — 오버레이 파일시스템이라도 호스트 디스크를
// 그대로 보고한다(실측: 컨테이너 안 144.3G / 호스트 df 145G).
import "server-only";
import { statfs } from "fs/promises";
import { getSql } from "@/lib/db";

export interface TableSize {
  table: string;
  /** 데이터+인덱스+TOAST 합 */
  bytes: number;
  dataBytes: number;
  indexBytes: number;
  /** 통계 기반 추정 행 수 (VACUUM 시점 기준이라 정확하진 않다) */
  rows: number;
}

export interface DbStats {
  dbBytes: number;
  disk: { totalBytes: number; freeBytes: number } | null;
  tables: TableSize[];
}

let memo: { at: number; value: DbStats } | null = null;
const TTL_MS = 60_000; // 용량은 분 단위로 변하지 않는다

export async function databaseStats(): Promise<DbStats> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.value;
  const sql = await getSql();

  const [sizeRows, tableRows, disk] = await Promise.all([
    sql`SELECT pg_database_size(current_database())::bigint AS bytes` as unknown as Promise<
      { bytes: string }[]
    >,
    sql`
      SELECT c.relname AS name,
             pg_total_relation_size(c.oid)::bigint AS total,
             pg_relation_size(c.oid)::bigint AS data,
             pg_indexes_size(c.oid)::bigint AS idx,
             c.reltuples::bigint AS rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 12` as unknown as Promise<
      { name: string; total: string; data: string; idx: string; rows: string }[]
    >,
    statfs("/")
      .then((s) => ({
        totalBytes: Number(s.blocks) * Number(s.bsize),
        freeBytes: Number(s.bavail) * Number(s.bsize),
      }))
      .catch(() => null),
  ]);

  const value: DbStats = {
    dbBytes: Number(sizeRows[0]?.bytes ?? 0),
    disk,
    tables: tableRows.map((r) => ({
      table: r.name,
      bytes: Number(r.total),
      dataBytes: Number(r.data),
      indexBytes: Number(r.idx),
      rows: Number(r.rows),
    })),
  };
  memo = { at: Date.now(), value };
  return value;
}
