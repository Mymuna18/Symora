CREATE TABLE participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_code TEXT NOT NULL UNIQUE,
    trial_id TEXT NOT NULL,
    preferred_language VARCHAR(35) NOT NULL DEFAULT 'en',
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'withdrawn')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
    source TEXT NOT NULL DEFAULT 'portal'
        CHECK (source IN ('portal', 'voice')),
    original_language VARCHAR(35) NOT NULL,
    original_transcript TEXT,
    english_summary TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    workflow_status TEXT NOT NULL DEFAULT 'submitted'
        CHECK (
            workflow_status IN (
                'draft',
                'submitted',
                'reviewed',
                'follow_up_requested',
                'closed'
            )
        ),
    CONSTRAINT reports_submission_complete CHECK (
        (workflow_status = 'draft' AND submitted_at IS NULL)
        OR
        (workflow_status <> 'draft' AND submitted_at IS NOT NULL
            AND original_transcript IS NOT NULL
            AND original_transcript ~ '[^[:space:]]')
    )
);

CREATE TABLE symptoms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE report_symptoms (
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    symptom_id UUID NOT NULL REFERENCES symptoms(id) ON DELETE RESTRICT,
    reported_intensity SMALLINT
        CHECK (reported_intensity IS NULL OR reported_intensity BETWEEN 0 AND 10),
    onset_date DATE,
    ongoing BOOLEAN,
    participant_description TEXT,
    PRIMARY KEY (report_id, symptom_id)
);

CREATE TABLE review_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
    reviewer_user_id TEXT NOT NULL,
    action TEXT NOT NULL
        CHECK (action IN ('status_changed', 'note_added')),
    previous_workflow_status TEXT
        CHECK (
            previous_workflow_status IS NULL
            OR previous_workflow_status IN (
                'submitted',
                'reviewed',
                'follow_up_requested',
                'closed'
            )
        ),
    new_workflow_status TEXT
        CHECK (
            new_workflow_status IS NULL
            OR new_workflow_status IN (
                'submitted',
                'reviewed',
                'follow_up_requested',
                'closed'
            )
        ),
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT review_history_reviewer_present CHECK (
        reviewer_user_id ~ '[^[:space:]]'
    ),
    CONSTRAINT review_history_note_nonblank CHECK (
        review_note IS NULL OR review_note ~ '[^[:space:]]'
    ),
    CONSTRAINT review_history_action_consistent CHECK (
        previous_workflow_status IS NOT NULL
        AND new_workflow_status IS NOT NULL
        AND (
            (action = 'status_changed'
                AND previous_workflow_status <> new_workflow_status)
            OR
            (action = 'note_added'
                AND previous_workflow_status = new_workflow_status
                AND review_note IS NOT NULL)
        )
    )
);

CREATE INDEX reports_participant_submitted_idx
    ON reports (participant_id, submitted_at DESC);
CREATE INDEX reports_review_queue_idx
    ON reports (workflow_status, submitted_at DESC);
CREATE INDEX reports_submitted_at_idx
    ON reports (submitted_at DESC);
CREATE INDEX report_symptoms_symptom_report_idx
    ON report_symptoms (symptom_id, report_id);
CREATE INDEX review_history_report_created_idx
    ON review_history (report_id, created_at DESC);

COMMENT ON COLUMN reports.english_summary IS
    'Optional English rendering/summary; must not introduce a diagnosis or inferred clinical severity.';
COMMENT ON COLUMN report_symptoms.reported_intensity IS
    'Participant-reported value only; never inferred or assigned by an automated system.';

COMMENT ON COLUMN reports.workflow_status IS
    'Drafts may be incomplete and must have submitted_at explicitly set to NULL. Submission must atomically set a nonblank original transcript, submitted_at, and a non-draft status.';
COMMENT ON TABLE review_history IS
    'Coordinator audit records: status changes require distinct non-null statuses; notes require matching non-null statuses and nonblank text. The backend must update the report and append its audit record in one transaction.';
