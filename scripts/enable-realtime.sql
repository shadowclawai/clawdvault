-- Enable realtime for key tables
-- Run this after Prisma schema is applied:
-- docker exec -i supabase_db_clawdvault psql -U postgres -d postgres -f /path/to/enable-realtime.sql
-- Or: docker exec -i supabase_db_clawdvault psql -U postgres -d postgres -c "ALTER PUBLICATION..."

ALTER PUBLICATION supabase_realtime ADD TABLE tokens;
ALTER PUBLICATION supabase_realtime ADD TABLE trades;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE price_candles;
