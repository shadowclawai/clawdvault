-- SOL Price Table for Real-time Streaming
-- Stores the current SOL/USD price with timestamps

CREATE TABLE sol_price (
  id TEXT PRIMARY KEY DEFAULT 'current',
  price DECIMAL(20, 6) NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('coingecko', 'jupiter')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert initial row
INSERT INTO sol_price (id, price, source, updated_at)
VALUES ('current', 0, 'coingecko', NOW())
ON CONFLICT (id) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE sol_price ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "SOL price is viewable by everyone" 
  ON sol_price FOR SELECT 
  USING (true);

-- Service role can update
CREATE POLICY "Service role can update SOL price"
  ON sol_price FOR ALL
  USING (auth.role() = 'service_role');

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE sol_price;

SELECT 'SOL price table created successfully! 💰' as status;
