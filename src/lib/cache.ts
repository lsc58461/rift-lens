// 키-값 JSON 캐시. REDIS_URL이 있으면 Redis, 아니면 DATABASE_URL이 있으면
// Postgres(cache_entries 테이블), 둘 다 없으면 인메모리 Map으로 동작한다.
// 라이엇 API 호출량을 줄이는 게 목적. (자체 서버는 Redis, Vercel은 Postgres)

import "server-only";

interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  /** 프리픽스로 시작하는 살아있는 키 목록 (어드민 조회용) */
  keys(prefix: string): Promise<string[]>;
  /** 프리픽스로 시작하는 살아있는 항목들 (어드민 조회용) */
  entries<T>(prefix: string): Promise<{ key: string; value: T }[]>;
  delete(key: string): Promise<void>;
}

class MemoryStore implements CacheStore {
  private map = new Map<string, { value: unknown; expiresAt: number }>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.map.size > 10_000) this.map.clear();
    this.map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async keys(prefix: string): Promise<string[]> {
    const now = Date.now();
    return [...this.map.entries()]
      .filter(([k, v]) => k.startsWith(prefix) && v.expiresAt > now)
      .map(([k]) => k);
  }

  async entries<T>(prefix: string): Promise<{ key: string; value: T }[]> {
    const now = Date.now();
    return [...this.map.entries()]
      .filter(([k, v]) => k.startsWith(prefix) && v.expiresAt > now)
      .map(([k, v]) => ({ key: k, value: v.value as T }));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

class PostgresStore implements CacheStore {
  private db: Promise<{
    sql: import("postgres").Sql;
  }>;

  constructor() {
    // 스키마 초기화 포함 공유 커넥션 (db.ts)
    this.db = import("./db").then(async (m) => ({ sql: await m.getSql() }));
  }

  async get<T>(key: string): Promise<T | null> {
    const { sql } = await this.db;
    const rows = await sql`
      SELECT value FROM cache_entries
      WHERE key = ${key} AND expires_at > now()`;
    return rows.length ? (rows[0].value as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const { sql } = await this.db;
    await sql`
      INSERT INTO cache_entries (key, value, expires_at)
      VALUES (${key}, ${sql.json(value as never)}, now() + ${`${ttlSeconds} seconds`}::interval)
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`;
  }

  async keys(prefix: string): Promise<string[]> {
    const { sql } = await this.db;
    const rows = await sql`
      SELECT key FROM cache_entries
      WHERE key LIKE ${prefix + "%"} AND expires_at > now()`;
    return rows.map((r) => r.key as string);
  }

  async entries<T>(prefix: string): Promise<{ key: string; value: T }[]> {
    const { sql } = await this.db;
    const rows = await sql`
      SELECT key, value FROM cache_entries
      WHERE key LIKE ${prefix + "%"} AND expires_at > now()`;
    return rows.map((r) => ({ key: r.key as string, value: r.value as T }));
  }

  async delete(key: string): Promise<void> {
    const { sql } = await this.db;
    await sql`DELETE FROM cache_entries WHERE key = ${key}`;
  }
}

class RedisStore implements CacheStore {
  private client: Promise<import("redis").RedisClientType>;

  constructor(url: string) {
    this.client = import("redis").then(async (m) => {
      const c = m.createClient({
        url,
        socket: { connectTimeout: 5000 },
      }) as import("redis").RedisClientType;
      // 끊겨도 프로세스는 살아야 한다 — 재연결은 클라이언트가 알아서 한다
      c.on("error", (e) => console.error("[cache] redis error:", e?.message));
      await c.connect();
      return c;
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const c = await this.client;
    const raw = await c.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const c = await this.client;
    await c.set(key, JSON.stringify(value), { EX: Math.max(1, Math.ceil(ttlSeconds)) });
  }

  private async scan(prefix: string): Promise<string[]> {
    const c = await this.client;
    const keys: string[] = [];
    for await (const batch of c.scanIterator({ MATCH: `${prefix}*`, COUNT: 500 })) {
      keys.push(...batch);
    }
    return keys;
  }

  async keys(prefix: string): Promise<string[]> {
    return this.scan(prefix);
  }

  async entries<T>(prefix: string): Promise<{ key: string; value: T }[]> {
    const c = await this.client;
    const keys = await this.scan(prefix);
    if (!keys.length) return [];
    const values = await c.mGet(keys);
    return keys.flatMap((key, i) =>
      values[i] === null ? [] : [{ key, value: JSON.parse(values[i]) as T }],
    );
  }

  async delete(key: string): Promise<void> {
    const c = await this.client;
    await c.del(key);
  }
}

const globalForCache = globalThis as unknown as { __mmrCache?: CacheStore };

export const cache: CacheStore =
  globalForCache.__mmrCache ??
  (globalForCache.__mmrCache = process.env.REDIS_URL
    ? new RedisStore(process.env.REDIS_URL)
    : process.env.DATABASE_URL
      ? new PostgresStore()
      : new MemoryStore());

/** 캐시에 있으면 반환, 없으면 fn 실행 후 저장 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== null) return hit;
  const value = await fn();
  await cache.set(key, value, ttlSeconds);
  return value;
}
