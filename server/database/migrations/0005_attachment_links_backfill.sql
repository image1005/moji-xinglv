-- Drizzle custom data migration: retain references for installations that applied 0003.
INSERT INTO attachment_links (attachment_id, message_id)
SELECT id, message_id FROM attachments WHERE message_id IS NOT NULL
ON CONFLICT (attachment_id, message_id) DO NOTHING;
