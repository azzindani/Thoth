-- Map notes (ROADMAP P5): a note can be pinned to a place.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS lon double precision;
