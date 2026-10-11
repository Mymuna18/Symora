// @ts-check

const consumeRateLimitSql = `
  INSERT INTO rate_limit_buckets (scope, bucket_hash, window_started_at, attempts, expires_at)
  VALUES ($1, $2, statement_timestamp(), 1,
    statement_timestamp() + ($3::bigint * INTERVAL '1 millisecond'))
  ON CONFLICT (scope, bucket_hash) DO UPDATE SET
    window_started_at = CASE
      WHEN rate_limit_buckets.expires_at <= statement_timestamp()
        THEN statement_timestamp()
      ELSE rate_limit_buckets.window_started_at
    END,
    attempts = CASE
      WHEN rate_limit_buckets.expires_at <= statement_timestamp() THEN 1
      ELSE LEAST(rate_limit_buckets.attempts + 1, $4::integer)
    END,
    expires_at = CASE
      WHEN rate_limit_buckets.expires_at <= statement_timestamp()
        THEN statement_timestamp() + ($3::bigint * INTERVAL '1 millisecond')
      ELSE rate_limit_buckets.expires_at
    END
  RETURNING attempts, expires_at`;

const cleanupExpiredSql = Object.freeze([
  `WITH expired AS (
     SELECT session_id_hash FROM browser_auth_sessions
     WHERE expires_at <= statement_timestamp()
     ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
   )
   DELETE FROM browser_auth_sessions AS sessions
   USING expired WHERE sessions.session_id_hash = expired.session_id_hash`,
  `WITH expired AS (
     SELECT scope, bucket_hash FROM rate_limit_buckets
     WHERE expires_at <= statement_timestamp()
     ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
   )
   DELETE FROM rate_limit_buckets AS buckets
   USING expired
   WHERE buckets.scope = expired.scope AND buckets.bucket_hash = expired.bucket_hash`,
]);
const RATE_LIMITS = Object.freeze({
  login_global: { attempts: 30, windowMs: 60_000 },
  login_account: { attempts: 5, windowMs: 15 * 60_000 },
  login_unknown: { attempts: 5, windowMs: 15 * 60_000 },
  analysis_global: { attempts: 120, windowMs: 60_000 },
});

/**
 * PostgreSQL-backed browser session and fixed-window rate-limit store.
 * @param {{getPool: () => {
 *   query: (sql: string, values?: unknown[]) => Promise<{rows: Record<string, unknown>[]}>,
 *   connect: () => Promise<{
 *     query: (sql: string, values?: unknown[]) => Promise<{rows: Record<string, unknown>[], command?: string}>,
 *     release: (destroy?: boolean) => void
 *   }>
 * }}} dependencies
 */
export function createBrowserAuthStore({ getPool }) {
  return {
    /** @param {string} sessionIdHash
     * @returns {Promise<{accountKeyHash: string, role: "participant" | "coordinator", configFingerprint: string, expires: number} | null>} */
    async findSession(sessionIdHash) {
      const result = await getPool().query(
        `SELECT account_key_hash, role, config_fingerprint,
          (EXTRACT(EPOCH FROM expires_at) * 1000)::bigint AS expires_ms
         FROM browser_auth_sessions
         WHERE session_id_hash = $1 AND expires_at > statement_timestamp()`,
        [sessionIdHash],
      );
      const row = result.rows[0];
      if (!row) return null;
      const expires = Number(row.expires_ms);
      if (typeof row.account_key_hash !== "string"
        || (row.role !== "participant" && row.role !== "coordinator")
        || typeof row.config_fingerprint !== "string" || !Number.isSafeInteger(expires)) {
        throw new Error("Unexpected browser session response.");
      }
      return {
        accountKeyHash: row.account_key_hash,
        role: row.role,
        configFingerprint: row.config_fingerprint,
        expires,
      };
    },

    /**
     * @param {string | null} previousSessionIdHash
     * @param {{sessionIdHash: string, accountKeyHash: string, role: string, configFingerprint: string, createdAt: number, expires: number}} session
     */
    async replaceSession(previousSessionIdHash, session) {
      const poolClient = await getPool().connect();
      let transaction = false;
      let destroy = false;
      try {
        await poolClient.query("BEGIN");
        transaction = true;
        if (previousSessionIdHash) {
          await poolClient.query(
            "DELETE FROM browser_auth_sessions WHERE session_id_hash = $1",
            [previousSessionIdHash],
          );
        }
        await poolClient.query(
          `INSERT INTO browser_auth_sessions
            (session_id_hash, account_key_hash, role, config_fingerprint, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [session.sessionIdHash, session.accountKeyHash, session.role, session.configFingerprint,
            new Date(session.createdAt), new Date(session.expires)],
        );
        await poolClient.query("COMMIT");
        transaction = false;
      } catch (error) {
        if (transaction) {
          try { await poolClient.query("ROLLBACK"); } catch { destroy = true; }
        } else {
          destroy = true;
        }
        throw error;
      } finally {
        poolClient.release(destroy);
      }
    },

    /** @param {string} sessionIdHash */
    async deleteSession(sessionIdHash) {
      await getPool().query(
        "DELETE FROM browser_auth_sessions WHERE session_id_hash = $1",
        [sessionIdHash],
      );
    },

    async cleanupExpired() {
      for (const sql of cleanupExpiredSql) await getPool().query(sql);
    },

    /** @param {"login_global" | "login_account" | "login_unknown" | "analysis_global"} scope
     * @param {string} bucketHash @param {number} maxAttempts @param {number} windowMs */
    async consumeRateLimit(scope, bucketHash, maxAttempts, windowMs) {
      const policy = RATE_LIMITS[scope];
      if (!policy || !/^[0-9a-f]{64}$/.test(bucketHash)
        || maxAttempts !== policy.attempts || windowMs !== policy.windowMs) {
        throw new TypeError("Invalid rate-limit bucket.");
      }
      if (scope === "login_global") await this.cleanupExpired();
      const result = await getPool().query(consumeRateLimitSql, [
        scope, bucketHash, windowMs, maxAttempts + 1,
      ]);
      const row = result.rows[0];
      const expiresAt = row?.expires_at instanceof Date || typeof row?.expires_at === "string"
        ? new Date(row.expires_at).getTime() : NaN;
      const attempts = Number(row?.attempts);
      if (!Number.isSafeInteger(attempts) || attempts < 1 || !Number.isFinite(expiresAt)) {
        throw new Error("Unexpected rate-limit response.");
      }
      return { attempts, expiresAt };
    },
  };
}

export { consumeRateLimitSql };
