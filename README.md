# WhatCanWePlayToday

A game recommendation platform for Steam users, designed to help groups of friends find new games to play together.

## Overview

"WhatCanWePlayToday" is a web application that connects to the Steam platform to provide game recommendations. Users can log in via Steam, join "rooms" with their friends, and receive game suggestions based on the games that the room's members do not own.

## Features

- **Steam Authentication**: Users can easily log in using their Steam accounts.
- **Room Creation and Joining**: Users can create or join rooms to collaborate with friends.
- **Game Recommendations**: The application provides game suggestions tailored to the preferences and game libraries of the room's members.
- **User-Friendly Interface**: A clean and intuitive interface ensures a seamless user experience.

## Getting Started

### Prerequisites

- Node.js

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/YukioRivera/WhatCanWePlayToday.git
   ```

2. Navigate to the project directory:
   ```bash
   cd WhatCanWePlayToday
   ```

3. Install the required dependencies:
   ```bash
   npm install
   ```

4. Start the server:
   ```bash
   npm start
   ```

5. Open a web browser and navigate to `http://localhost:3000` to access the application.

## Supabase CLI: Login (Linux & Windows)

- **Purpose:** Use the Supabase CLI to run SQL against your hosted database (e.g., apply `supabase-migration.sql`) and manage the linked project. Docker is only required for local containers (`supabase start`); for remote DB work, you can skip Docker.

**Recommended (No Install): Use npx**

- **Login:** `npx supabase@latest login` (paste your Supabase Personal Access Token)
- **Link Project:** `npx supabase@latest link --project-ref rorwijbtoztlhdfcnbjo`
- **Execute Migration Remotely:**
  - Linux/macOS: `POSTGRES_URL_NON_POOLING` should point to your database URL
    - `export POSTGRES_URL_NON_POOLING="<your-db-url>"`
    - `npx supabase@latest db execute --file supabase-migration.sql --db-url "$POSTGRES_URL_NON_POOLING"`
  - Windows (PowerShell):
    - `$env:POSTGRES_URL_NON_POOLING="<your-db-url>"`
    - `npx supabase@latest db execute --file supabase-migration.sql --db-url "$env:POSTGRES_URL_NON_POOLING"`

**Where CLI Login Is Stored**

- **Linux/macOS:** `~/.config/supabase/config.json`
- **Windows:** `%AppData%\Supabase\config.json`

**Windows Install Alternatives (Optional)**

- **Scoop:**
  - `iwr get.scoop.sh -UseBasicParsing | iex`
  - `scoop bucket add supabase https://github.com/supabase/scoop-bucket`
  - `scoop install supabase`
- **Manual Binary:** Download `supabase_windows_amd64.zip` from GitHub Releases, unzip `supabase.exe` to a folder on `PATH` (e.g., `C:\Tools\supabase\`) and run `supabase --version`.

**Notes**

- **Do not use** `npm i -g supabase` — global install via npm is not supported by the CLI.
- The deployed app authenticates to Supabase using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` from your hosting environment (e.g., Vercel). The CLI login is only for your local machine and is not used by the app at runtime.

## Feedback and Contributions

Feedback is always welcome!

## License

This project is licensed under the MIT License.
