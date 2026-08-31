-- Preserve the raw diarized transcript segments and STT provider metadata
-- delivered by the Gemini 3.5 Transcribe webhook, separate from the refined
-- `transcript` the UI shows. Both columns are additive and nullable; no
-- production rows exist yet, so no backfill is required.
ALTER TABLE "call_record"
    ADD COLUMN IF NOT EXISTS "transcript_raw" JSONB,
    ADD COLUMN IF NOT EXISTS "stt_meta" JSONB;
