#!/usr/bin/env node

import process from "node:process";

import pg from "pg";

const { Pool } = pg;

const [command, ...rawArguments] = process.argv.slice(2);
const args = parseArguments(rawArguments);
const databaseUrl = process.env.DATABASE_URL;
const appEnvironment = process.env.APP_ENV;

if (!databaseUrl) {
  fail("DATABASE_URL is required.");
}
if (
  !appEnvironment ||
  !["development", "test", "preview", "staging", "production"].includes(
    appEnvironment,
  )
) {
  fail("APP_ENV must be explicitly set for operator changes.");
}
if (
  !command ||
  ![
    "grant",
    "revoke",
    "bootstrap-admin",
    "invalidate",
    "disable",
    "enable",
    "rebind-subject",
  ].includes(command)
) {
  fail(
    "Usage: npm run auth:role -- <grant|revoke|bootstrap-admin|invalidate|disable|enable|rebind-subject> --user USER_ID --operator OPERATOR_ID --ticket CHANGE_TICKET [--role professor|admin] [--issuer HTTPS_URL --subject OIDC_SUBJECT] [--confirm-production PRODUCTION]",
  );
}
if (!args.user || !args.operator || !args.ticket) {
  fail("--user, --operator, and --ticket are required.");
}
if (
  appEnvironment === "production" &&
  args["confirm-production"] !== "PRODUCTION"
) {
  fail("Production changes require --confirm-production PRODUCTION.");
}
if (
  ["grant", "revoke"].includes(command) &&
  !["professor", "admin"].includes(args.role)
) {
  fail("--role must be professor or admin for grant/revoke.");
}
if (command === "bootstrap-admin" && args.role && args.role !== "admin") {
  fail("bootstrap-admin only grants the admin role.");
}
if (command === "rebind-subject") {
  if (!args.issuer || !args.subject) {
    fail(
      "rebind-subject requires --issuer and --subject after documented IT verification.",
    );
  }
  let issuer;
  try {
    issuer = new URL(args.issuer);
  } catch {
    fail("--issuer must be a valid HTTPS URL.");
  }
  if (issuer.protocol !== "https:") {
    fail("--issuer must be a valid HTTPS URL.");
  }
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

try {
  await client.query("begin");
  const target = await humanUser(client, args.user);
  if (!target) {
    fail("Target must be an existing human user.");
  }

  if (command === "bootstrap-admin") {
    if (target.status !== "active") {
      fail("The first administrator must be an active user.");
    }
    const existingAdmin = await client.query(`
      select 1
      from user_roles ur
      join users u on u.id = ur.user_id
      where ur.role_id = 'admin'
        and ur.revoked_at is null
        and (ur.expires_at is null or ur.expires_at > now())
        and u.user_type = 'human'
        and u.status = 'active'
      limit 1
    `);
    if (existingAdmin.rowCount) {
      fail(
        "A human administrator already exists; use the audited grant command.",
      );
    }
    await grantRole(client, args.user, "admin", "system:schema-migration");
  } else {
    const operator = await activeAdmin(client, args.operator);
    if (!operator) {
      fail("--operator must identify an existing active administrator.");
    }

    if (
      ["grant", "revoke", "invalidate", "disable"].includes(command) &&
      target.status !== "active"
    ) {
      fail(`${command} requires an active target user.`);
    }

    if (command === "grant") {
      await grantRole(client, args.user, args.role, args.operator);
    } else if (command === "revoke") {
      const result = await client.query(
        `
          update user_roles
          set revoked_at = now(),
              revoked_by_user_id = $3,
              updated_at = now()
          where user_id = $1
            and role_id = $2
            and revoked_at is null
        `,
        [args.user, args.role, args.operator],
      );
      if (!result.rowCount) {
        fail("The requested active role grant was not found.");
      }
    } else if (command === "disable") {
      await client.query(
        `update users set status = 'disabled', disabled_at = now() where id = $1`,
        [args.user],
      );
    } else if (command === "enable") {
      if (target.status !== "disabled") {
        fail("enable requires a disabled target user.");
      }
      await client.query(
        `update users set status = 'active', disabled_at = null where id = $1`,
        [args.user],
      );
    } else if (command === "rebind-subject") {
      await client.query(
        `
          update users
          set identity_provider = $2,
              external_subject = $3,
              updated_at = now()
          where id = $1
        `,
        [args.user, args.issuer, args.subject],
      );
    }
  }

  await client.query(
    `update users set session_version = session_version + 1 where id = $1`,
    [args.user],
  );
  await client.query(
    `
      insert into audit_events (
        actor_user_id,
        actor_subject,
        action,
        entity_type,
        entity_id,
        metadata_json
      )
      values ($1, $2, $3, 'user', $4, $5::jsonb)
    `,
    [
      command === "bootstrap-admin" ? null : args.operator,
      args.operator,
      `auth.role_${command.replace("-", "_")}`,
      args.user,
      JSON.stringify({
        ...(args.role ? { role: args.role } : {}),
        ...(command === "rebind-subject" ? { issuer: args.issuer } : {}),
        ticket: args.ticket,
      }),
    ],
  );
  await client.query("commit");
  process.stdout.write(
    `${command} completed for ${args.user}; application sessions invalidated.\n`,
  );
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}

async function humanUser(client, userId) {
  const result = await client.query(
    `select id, status from users where id = $1 and user_type = 'human'`,
    [userId],
  );
  return result.rows[0];
}

async function activeAdmin(client, userId) {
  const result = await client.query(
    `
      select u.id
      from users u
      join user_roles ur on ur.user_id = u.id
      where u.id = $1
        and u.user_type = 'human'
        and u.status = 'active'
        and ur.role_id = 'admin'
        and ur.revoked_at is null
        and (ur.expires_at is null or ur.expires_at > now())
    `,
    [userId],
  );
  return result.rows[0];
}

async function grantRole(client, userId, role, grantedByUserId) {
  await client.query(
    `
      insert into user_roles (user_id, role_id, granted_by_user_id)
      values ($1, $2, $3)
      on conflict (user_id, role_id) do update
      set granted_by_user_id = excluded.granted_by_user_id,
          revoked_by_user_id = null,
          granted_at = now(),
          expires_at = null,
          revoked_at = null,
          updated_at = now()
    `,
    [userId, role, grantedByUserId],
  );
}

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      fail(`Invalid argument near ${key ?? "end of command"}.`);
    }
    parsed[key.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

function fail(message) {
  throw new Error(message);
}
