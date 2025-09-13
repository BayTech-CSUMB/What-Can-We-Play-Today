// Database utility module for Supabase
const { createClient } = require('@supabase/supabase-js');

// Enforce Supabase requirements in production/Vercel environment
if (process.env.VERCEL && (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required for Vercel deployment');
}

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  // Prefer service role key on the server to bypass RLS for inserts/updates
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// Database helper functions
const db = {
  // Mock the SQLite prepare method structure
  prepare: (query) => {
    return {
      run: async (...params) => {
        try {
          // Convert SQLite INSERT to Supabase insert
          if (query.includes('INSERT INTO Games')) {
            const [gameID, name, genre, tags, age, price, initial_price, is_multiplayer, header_image, store_url, description] = params;
            const { data, error } = await supabase
              .from('games')
              .insert([{
                game_id: gameID,
                name: name,
                genre: genre || '',
                tags: tags || '',
                age: age,
                price: price || 0,
                initial_price: initial_price || 0,
                is_multiplayer: parseInt(is_multiplayer) || 0,
                header_image: header_image || '',
                store_url: store_url || '',
                description: description || ''
              }]);
            if (error) throw error;
            return { changes: 1 };
          }
          
          if (query.includes('INSERT INTO Users')) {
            const [userID, gameID] = params;
            const { data, error } = await supabase
              .from('users')
              .insert([{
                user_id: userID,
                game_id: gameID
              }]);
            if (error && !error.message.includes('duplicate')) throw error;
            return { changes: 1 };
          }
          
          if (query.includes('INSERT OR IGNORE INTO PendingGames') || query.includes('INSERT INTO PendingGames')) {
            const [gameID, created_at] = params;
            const { data, error } = await supabase
              .from('pending_games')
              .insert([{
                game_id: gameID,
                created_at: created_at || new Date().toISOString()
              }]);
            if (error && !error.message.includes('duplicate')) throw error;
            return { changes: 1 };
          }
          
          if (query.includes('UPDATE Games SET price')) {
            const [price, initial_price, age, gameID] = params;
            const { data, error } = await supabase
              .from('games')
              .update({
                price: price,
                initial_price: initial_price,
                age: age
              })
              .eq('game_id', gameID);
            if (error) throw error;
            return { changes: 1 };
          }
          
          if (query.includes('UPDATE Games SET name')) {
            const [name, genre, price, initial_price, header_image, description, gameID] = params;
            const { data, error } = await supabase
              .from('games')
              .update({
                name: name,
                genre: genre,
                price: price,
                initial_price: initial_price,
                header_image: header_image,
                description: description
              })
              .eq('game_id', gameID);
            if (error) throw error;
            return { changes: 1 };
          }
          
          if (query.includes('DELETE FROM PendingGames')) {
            const [gameID] = params;
            const { data, error } = await supabase
              .from('pending_games')
              .delete()
              .eq('game_id', gameID);
            if (error) throw error;
            return { changes: 1 };
          }
          
          // Handle INSERT OR REPLACE
          if (query.includes('INSERT OR REPLACE INTO Games')) {
            const [gameID, name, genre, tags, age, price, initial_price, is_multiplayer, header_image, store_url, description] = params;
            
            // First try to update, if no rows affected, insert
            const { data: updateData, error: updateError } = await supabase
              .from('games')
              .update({
                name: name || '',
                genre: genre || '',
                tags: tags || '',
                age: age,
                price: price || 0,
                initial_price: initial_price || 0,
                is_multiplayer: parseInt(is_multiplayer) || 0,
                header_image: header_image || '',
                store_url: store_url || '',
                description: description || ''
              })
              .eq('game_id', gameID);
              
            if (updateError) {
              // If update fails, try insert
              const { data: insertData, error: insertError } = await supabase
                .from('games')
                .insert([{
                  game_id: gameID,
                  name: name || '',
                  genre: genre || '',
                  tags: tags || '',
                  age: age,
                  price: price || 0,
                  initial_price: initial_price || 0,
                  is_multiplayer: parseInt(is_multiplayer) || 0,
                  header_image: header_image || '',
                  store_url: store_url || '',
                  description: description || ''
                }]);
              if (insertError) throw insertError;
            }
            return { changes: 1 };
          }
          
          return { changes: 0 };
        } catch (error) {
          console.error('Database operation failed:', error);
          return { changes: 0 };
        }
      },
      
      get: async (...params) => {
        try {
          if (query.includes('SELECT * FROM Games WHERE gameID = ?')) {
            const [gameID] = params;
            const { data, error } = await supabase
              .from('games')
              .select('*')
              .eq('game_id', gameID)
              .single();
            if (error || !data) return null;
            
            // Convert back to SQLite format
            return {
              gameID: data.game_id,
              name: data.name,
              genre: data.genre,
              tags: data.tags,
              age: data.age,
              price: data.price,
              initial_price: data.initial_price,
              is_multiplayer: data.is_multiplayer,
              header_image: data.header_image,
              store_url: data.store_url,
              description: data.description
            };
          }
          
          if (query.includes('SELECT * FROM Users WHERE userID = ? AND gameID = ?')) {
            const [userID, gameID] = params;
            const { data, error } = await supabase
              .from('users')
              .select('*')
              .eq('user_id', userID)
              .eq('game_id', gameID)
              .single();
            return error || !data ? null : data;
          }
          
          return null;
        } catch (error) {
          console.error('Database get failed:', error);
          return null;
        }
      },
      
      all: async (...params) => {
        try {
          if (query.includes('SELECT gameID FROM Games')) {
            const { data, error } = await supabase
              .from('games')
              .select('game_id');
            if (error) {
              console.error('Supabase query error:', error);
              return [];
            }
            return (data || []).map(row => ({ gameID: row.game_id }));
          }
          
          if (query.includes('SELECT gameID FROM PendingGames')) {
            const limit = params[0] || 50;
            const { data, error } = await supabase
              .from('pending_games')
              .select('game_id')
              .order('created_at', { ascending: true })
              .limit(limit);
            if (error) {
              console.error('Supabase query error:', error);
              return [];
            }
            return (data || []).map(row => ({ gameID: row.game_id }));
          }
          
          // Handle complex game queries with joins
          if (query.includes('SELECT * FROM Games NATURAL JOIN Users')) {
            const [userID] = params;
            
            // First get user's game IDs
            const { data: userGames, error: userError } = await supabase
              .from('users')
              .select('game_id')
              .eq('user_id', userID);
              
            if (userError) {
              console.error('User games query error:', userError);
              return [];
            }
            
            if (!userGames || userGames.length === 0) {
              return [];
            }
            
            const gameIds = userGames.map(ug => ug.game_id);
            
            // Then get games that match the user's games
            let supabaseQuery = supabase
              .from('games')
              .select('*')
              .in('game_id', gameIds);
            
            // Add multiplayer filter if present
            if (query.includes('is_multiplayer = 1')) {
              supabaseQuery = supabaseQuery.eq('is_multiplayer', 1);
            }
            
            // Add tag filter if present
            const tagMatch = query.match(/tags LIKE '%([^%]+)%'/);
            if (tagMatch) {
              supabaseQuery = supabaseQuery.ilike('tags', `%${tagMatch[1]}%`);
            }
            
            // Add genre filter if present
            const genreMatch = query.match(/genre LIKE '%([^%]+)%'/);
            if (genreMatch) {
              supabaseQuery = supabaseQuery.ilike('genre', `%${genreMatch[1]}%`);
            }
            
            // Add price filters
            if (query.includes('price = 0')) {
              supabaseQuery = supabaseQuery.eq('price', 0);
            } else if (query.includes('price <= 10')) {
              supabaseQuery = supabaseQuery.lte('price', 10);
            } else if (query.includes('price <= 40')) {
              supabaseQuery = supabaseQuery.lte('price', 40);
            }
            
            const { data, error } = await supabaseQuery;
            if (error) {
              console.error('Supabase query error:', error);
              return [];
            }
            
            // Convert back to SQLite format
            return (data || []).map(row => ({
              gameID: row.game_id,
              name: row.name,
              genre: row.genre,
              tags: row.tags,
              age: row.age,
              price: row.price,
              initial_price: row.initial_price,
              is_multiplayer: row.is_multiplayer,
              header_image: row.header_image,
              store_url: row.store_url,
              description: row.description
            }));
          }
          
          return [];
        } catch (error) {
          console.error('Database all failed:', error);
          return [];
        }
      }
    };
  }
};

module.exports = db;
