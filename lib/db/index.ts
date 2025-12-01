import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

const dbPath = "bank.db";

// Singleton pattern for database connection using globalThis for Next.js hot reloading
const globalForDb = globalThis as unknown as {
  sqliteConnection: Database.Database | undefined;
};

function getSqliteConnection(): Database.Database {
  if (!globalForDb.sqliteConnection) {
    globalForDb.sqliteConnection = new Database(dbPath);
    // Enable WAL mode for better concurrency
    globalForDb.sqliteConnection.pragma('journal_mode = WAL');
  }
  return globalForDb.sqliteConnection;
}

export const sqlite = getSqliteConnection();
export const db = drizzle(sqlite, { schema });

// Graceful shutdown function
export function closeDb() {
  if (globalForDb.sqliteConnection) {
    globalForDb.sqliteConnection.close();
    globalForDb.sqliteConnection = undefined;
  }
}

// Register shutdown handlers
if (typeof process !== 'undefined') {
  process.on('SIGINT', () => {
    closeDb();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    closeDb();
    process.exit(0);
  });
}

export function initDb() {
  const conn = getSqliteConnection();

  // Create tables if they don't exist
  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      ssn TEXT NOT NULL,
      ssn_hash TEXT UNIQUE,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      zip_code TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      account_number TEXT UNIQUE NOT NULL,
      account_type TEXT NOT NULL,
      balance REAL DEFAULT 0 NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Initialize database on import
initDb();
