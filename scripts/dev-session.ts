/**
 * Creates a signed-in session without going through Microsoft, so the CRM can
 * be worked on before the Entra app registration exists.
 *
 *   npm run dev:session -- you@ankord.com.au "Your Name"
 *
 * It prints a cookie to paste into the browser. The session it creates has no
 * Microsoft tokens, so anything that talks to Graph — linking email, browsing
 * SharePoint — will correctly report that it needs a real sign-in.
 *
 * Refuses to run against a production build.
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import * as schema from "../src/lib/db/schema";

const { sessions, users } = schema;

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("dev:session is for local development only.");
  }

  const url = process.env.DATABASE_URL;
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!secret) throw new Error("APP_ENCRYPTION_KEY is not set.");

  const email = (process.argv[2] ?? "dev@ankord.local").toLowerCase();
  const name = process.argv[3] ?? "Dev User";

  const client = new Client({
    connectionString: url,
    ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  const db = drizzle(client, { schema, casing: "snake_case" });

  try {
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    const userId =
      existing?.id ??
      (
        await db
          .insert(users)
          .values({
            azureOid: `dev-${email}`,
            tenantId: process.env.AZURE_AD_TENANT_ID ?? "dev",
            email,
            name,
            jobTitle: "Local development",
            role: "admin",
            lastSeenAt: new Date(),
          })
          .returning({ id: users.id })
      )[0].id;

    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    const [session] = await db
      .insert(sessions)
      .values({ userId, expiresAt, userAgent: "dev:session" })
      .returning({ id: sessions.id });

    const cookie = await new SignJWT({ sid: session.id })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(Uint8Array.from(Buffer.from(secret, "base64")));

    console.log(`\nSigned in as ${name} <${email}> (admin).`);
    console.log("\nRun this in the browser console on http://localhost:3000 :\n");
    console.log(`document.cookie = "ankord_session=${cookie}; path=/; max-age=604800"`);
    console.log("\nThen reload.\n");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
