import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { AppConfig } from "../config";
import * as schema from "./schema";

export interface DatabaseContext {
  sqlite: Database;
  db: BunSQLiteDatabase<typeof schema>;
  close(): void;
}

export function createDatabase(
  config: Pick<AppConfig, "databasePath" | "migrationsDir">,
): DatabaseContext {
  if (config.databasePath !== ":memory:") {
    mkdirSync(dirname(config.databasePath), { recursive: true });
  }

  const sqlite = new Database(config.databasePath, {
    create: true,
    strict: true,
  });
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  if (config.databasePath !== ":memory:") {
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA synchronous = NORMAL");
  }

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: config.migrationsDir });

  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
}
