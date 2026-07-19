export const PIPELINE_STAGES = ["upload_validation", "audio_inspection", "audio_normalization", "speech_transcription", "speaker_diarization", "transcript_alignment", "transcript_assembly", "summarization", "structured_extraction", "completion"] as const;
export const SUMMARY_PIPELINE_STAGES = ["summarization", "structured_extraction", "completion"] as const;
export const REPROCESS_PIPELINE_STAGES = ["audio_inspection", "audio_normalization", "speech_transcription", "speaker_diarization", "transcript_alignment", "transcript_assembly", "summarization", "structured_extraction", "completion"] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];
