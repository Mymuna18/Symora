CREATE TABLE browser_auth_sessions (
    session_id_hash TEXT NOT NULL,
    account_key_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    config_fingerprint TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT browser_auth_sessions_pkey PRIMARY KEY (session_id_hash),
    CONSTRAINT browser_auth_sessions_session_hash_check CHECK (session_id_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT browser_auth_sessions_account_hash_check CHECK (account_key_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT browser_auth_sessions_role_check CHECK (role IN ('participant', 'coordinator')),
    CONSTRAINT browser_auth_sessions_fingerprint_check CHECK (config_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT browser_auth_sessions_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX browser_auth_sessions_expires_idx
    ON browser_auth_sessions (expires_at);

CREATE TABLE rate_limit_buckets (
    scope TEXT NOT NULL,
    bucket_hash TEXT NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (scope, bucket_hash),
    CONSTRAINT rate_limit_buckets_scope_check CHECK (scope IN ('login_global', 'login_account', 'login_unknown', 'analysis_global')),
    CONSTRAINT rate_limit_buckets_hash_check CHECK (bucket_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT rate_limit_buckets_attempts_positive_check CHECK (attempts > 0),
    CONSTRAINT rate_limit_buckets_expiry_check CHECK (expires_at > window_started_at),
    CONSTRAINT rate_limit_buckets_attempts_bound_check CHECK (
        (scope = 'login_global' AND attempts <= 31)
        OR (scope IN ('login_account', 'login_unknown') AND attempts <= 6)
        OR (scope = 'analysis_global' AND attempts <= 121)
    )
);

CREATE INDEX rate_limit_buckets_expires_idx
    ON rate_limit_buckets (expires_at);
