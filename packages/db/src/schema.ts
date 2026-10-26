import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const flags = sqliteTable("flags", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  owner: text("owner").notNull(),
  expiresAt: text("expires_at").notNull(),
  killSwitch: integer("kill_switch", { mode: "boolean" }).notNull().default(false),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const flagEnvironments = sqliteTable(
  "flag_environments",
  {
    flagKey: text("flag_key")
      .notNull()
      .references(() => flags.key, { onDelete: "cascade" }),
    environment: text("environment").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    rolloutPercentage: integer("rollout_percentage").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.flagKey, table.environment] }),
    check(
      "flag_environments_environment_check",
      sql`${table.environment} IN ('development', 'staging', 'production')`,
    ),
    check("flag_environments_rollout_check", sql`${table.rolloutPercentage} BETWEEN 0 AND 100`),
  ],
);

export const flagEnvironmentCompanies = sqliteTable(
  "flag_environment_companies",
  {
    flagKey: text("flag_key").notNull(),
    environment: text("environment").notNull(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    list: text("list").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.flagKey, table.environment, table.companyId] }),
    foreignKey({
      columns: [table.flagKey, table.environment],
      foreignColumns: [flagEnvironments.flagKey, flagEnvironments.environment],
    }).onDelete("cascade"),
    check("flag_environment_companies_list_check", sql`${table.list} IN ('allow', 'deny')`),
  ],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    flagKey: text("flag_key").notNull(),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    beforeState: text("before_state"),
    afterState: text("after_state").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "audit_log_action_check",
      sql`${table.action} IN ('create', 'update', 'archive', 'unarchive', 'kill_switch_on', 'kill_switch_off', 'targeting_update', 'rollback')`,
    ),
    index("audit_log_flag_key_id_idx").on(table.flagKey, table.id),
  ],
);
