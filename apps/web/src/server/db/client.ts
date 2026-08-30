import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getServerEnv } from "@/src/server/env";
import * as schema from "./schema";

type Database = ReturnType<typeof createDatabase>;

const globalDatabase = globalThis as typeof globalThis & {
  xianyuDatabase?: Database;
};

function createDatabase() {
  const { DATABASE_URL } = getServerEnv();
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL 未配置，当前不能访问 PostgreSQL。");
  }

  const client = postgres(DATABASE_URL, {
    max: 6,
    connect_timeout: 5,
    idle_timeout: 20,
    prepare: false,
  });

  return {
    client,
    db: drizzle(client, { schema }),
  };
}

export function getDatabase(): Database {
  if (!globalDatabase.xianyuDatabase) {
    globalDatabase.xianyuDatabase = createDatabase();
  }
  return globalDatabase.xianyuDatabase;
}

