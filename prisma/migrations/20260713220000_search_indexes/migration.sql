CREATE INDEX "Meeting_title_search_idx" ON "Meeting" USING GIN (to_tsvector('simple', "title"));
CREATE INDEX "Speaker_name_search_idx" ON "Speaker" USING GIN (to_tsvector('simple', "displayName"));
CREATE INDEX "TranscriptSegment_text_search_idx" ON "TranscriptSegment" USING GIN (to_tsvector('simple', "text"));
CREATE INDEX "ActionItem_text_search_idx" ON "ActionItem" USING GIN (to_tsvector('simple', "description" || ' ' || COALESCE("typedOwner", '')));
CREATE INDEX "SummaryVersion_content_search_idx" ON "SummaryVersion" USING GIN (to_tsvector('simple', COALESCE("content"::text, '')));
