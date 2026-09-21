import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { seedWfmUser } from "../lib/server/auth/users";
import { getPool } from "../lib/server/auth/db";

function loadEnvFile(file: string) {
  try {
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index < 1) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* optional */
  }
}

async function main() {
  const root = resolve(process.cwd());
  loadEnvFile(resolve(root, ".env.local"));
  loadEnvFile(resolve(root, ".env"));

  const email = process.env.WFM_SEED_EMAIL?.trim();
  const password = process.env.WFM_SEED_PASSWORD?.trim();
  const name = process.env.WFM_SEED_NAME?.trim() || "WFM";
  if (!email || !password) {
    throw new Error("Set WFM_SEED_EMAIL and WFM_SEED_PASSWORD before seeding.");
  }

  const result = await seedWfmUser({ email, name, password });
  if (result.created) {
    console.log(`Seeded WFM superadmin: ${result.email}`);
  } else {
    console.log(`WFM superadmin already exists. Left ${result.email} unchanged.`);
  }
  await getPool().end();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  try {
    await getPool().end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
