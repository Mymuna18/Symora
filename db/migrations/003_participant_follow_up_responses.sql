CREATE TABLE participant_follow_up_responses (
    report_id UUID PRIMARY KEY
        REFERENCES reports(id) ON DELETE RESTRICT,
    participant_id UUID NOT NULL
        REFERENCES participants(id) ON DELETE RESTRICT,
    response TEXT NOT NULL
        CHECK (response IN ('appointment_scheduled', 'will_schedule_later')),
    responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX participant_follow_up_responses_participant_idx
    ON participant_follow_up_responses (participant_id, response);

CREATE TABLE participant_follow_up_reminders (
    report_id UUID NOT NULL
        REFERENCES reports(id) ON DELETE RESTRICT,
    reminder_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (report_id, reminder_date)
);

COMMENT ON TABLE participant_follow_up_responses IS
    'Participant-reported follow-up response. Does not schedule appointments.';
COMMENT ON TABLE participant_follow_up_reminders IS
    'Idempotent in-app reminder records keyed by report and UTC calendar day. No background delivery.';
