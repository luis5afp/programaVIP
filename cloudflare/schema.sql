-- ====================================================================
-- CourseHub Admin V6 - Cloudflare D1 Database Schema
-- Run with: npx wrangler d1 execute coursehub-db --file=./cloudflare/schema.sql
-- ====================================================================

-- 1. Modules Table
CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '◇',
  desc TEXT,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Profiles Table (belongs to a module, includes image support)
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  username TEXT,
  credential_ok INTEGER DEFAULT 1,
  last_check TEXT,
  image TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
);

-- 3. Clients Table
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  status TEXT DEFAULT 'active',
  plan TEXT,
  start_date TEXT,
  end_date TEXT,
  renewal TEXT DEFAULT 'manual',
  modules_json TEXT DEFAULT '{}',
  profile_ids_json TEXT DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Admin Users Table
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  last_login TEXT
);

-- 5. Roles & Permissions Table
CREATE TABLE IF NOT EXISTS roles (
  name TEXT PRIMARY KEY,
  permissions_json TEXT NOT NULL
);
