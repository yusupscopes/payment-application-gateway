import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const transactions = pgTable("transactions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  provider: varchar("provider", { length: 32 }).notNull(),
  providerRef: varchar("provider_ref", { length: 256 }).notNull(),
  operation: varchar("operation", { length: 32 }).notNull(),
  amount: integer("amount").notNull(),
  currency: varchar("currency", { length: 8 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  rawResponse: jsonb("raw_response"),
  errorCode: varchar("error_code", { length: 64 }),
  errorMessage: text("error_message"),
  retryable: boolean("retryable"),
  correlationId: varchar("correlation_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const transactionLogs = pgTable("transaction_logs", {
  id: serial("id").primaryKey(),
  transactionId: varchar("transaction_id", { length: 64 }).notNull(),
  level: varchar("level", { length: 16 }).notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
