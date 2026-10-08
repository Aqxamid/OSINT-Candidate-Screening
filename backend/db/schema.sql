-- Reference schema for the applicants table (PostgreSQL / Supabase).
-- The OSINT export reads ONLY: id, fullname, handle.
-- Every other column below is intentionally never selected by the export query.

CREATE TABLE IF NOT EXISTS applicants (
  id                   SERIAL PRIMARY KEY,
  fullname             TEXT        NOT NULL,
  handle               TEXT,                 -- candidate-supplied public handle (e.g. GitHub username)

  -- Private fields: NEVER exported to the OSINT scanner
  student_number       TEXT,
  course               TEXT,
  year_level           TEXT,
  college_department   TEXT,
  secondary_divisions  TEXT[],
  essay_answers        JSONB,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
