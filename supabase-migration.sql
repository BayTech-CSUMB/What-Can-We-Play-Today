-- Supabase Migration for What Can We Play Today
-- Run this in your Supabase SQL Editor

-- Games table - stores all game information
CREATE TABLE games (
  id SERIAL PRIMARY KEY,
  game_id TEXT UNIQUE NOT NULL,
  name TEXT,
  genre TEXT,
  tags TEXT,
  age DATE,
  price DECIMAL(10,2) DEFAULT 0,
  initial_price DECIMAL(10,2) DEFAULT 0,
  is_multiplayer INTEGER DEFAULT 0,
  header_image TEXT,
  store_url TEXT,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users table - stores user-game relationships (many-to-many)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, game_id)
);

-- Pending games table - queue for processing games
CREATE TABLE pending_games (
  id SERIAL PRIMARY KEY,
  game_id TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX idx_games_game_id ON games(game_id);
CREATE INDEX idx_games_is_multiplayer ON games(is_multiplayer);
CREATE INDEX idx_games_price ON games(price);
CREATE INDEX idx_users_user_id ON users(user_id);
CREATE INDEX idx_users_game_id ON users(game_id);
CREATE INDEX idx_pending_games_created_at ON pending_games(created_at);

-- Enable Row Level Security (RLS) - optional but recommended
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_games ENABLE ROW LEVEL SECURITY;

-- Policies for public access (adjust as needed)
CREATE POLICY "Public can read games" ON games FOR SELECT USING (true);
CREATE POLICY "Public can read users" ON users FOR SELECT USING (true);
CREATE POLICY "Public can read pending games" ON pending_games FOR SELECT USING (true);

-- Allow inserts/updates for authenticated users
CREATE POLICY "Authenticated can insert games" ON games FOR INSERT WITH CHECK (true);
CREATE POLICY "Authenticated can update games" ON games FOR UPDATE USING (true);
CREATE POLICY "Authenticated can insert users" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "Authenticated can insert pending games" ON pending_games FOR INSERT WITH CHECK (true);
CREATE POLICY "Authenticated can delete pending games" ON pending_games FOR DELETE USING (true);