import { randomUUID } from "node:crypto";
import type { ModelMessage } from "ai";
import { db } from "./db";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  parts: { type: string; text?: string }[];
  metadata?: { tools?: string[]; by?: string };
};

export type ConversationRow = {
  id: string;
  agent: "explainer" | "tutor";
  source: "you" | "reader" | "student" | "dig-in";
  title: string;
  context: string | null;
  messages: string;
  created_at: string;
  updated_at: string;
};

export function createConversation(c: { id?: string; agent: ConversationRow["agent"]; source: ConversationRow["source"]; title: string; context?: string }) {
  const id = c.id ?? randomUUID();
  db.prepare("INSERT INTO conversations(id, agent, source, title, context) VALUES (?,?,?,?,?)").run(id, c.agent, c.source, c.title, c.context ?? null);
  return id;
}

export function getConversation(id: string) {
  const row = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | undefined;
  if (!row) return undefined;
  return { ...row, messages: JSON.parse(row.messages) as StoredMessage[] };
}

export function saveMessages(id: string, messages: StoredMessage[]) {
  db.prepare("UPDATE conversations SET messages = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(messages), id);
}

export function listConversations(limit = 50) {
  return db
    .prepare("SELECT id, agent, source, title, created_at, updated_at, json_array_length(messages) AS n FROM conversations ORDER BY updated_at DESC LIMIT ?")
    .all(limit) as (Pick<ConversationRow, "id" | "agent" | "source" | "title" | "created_at" | "updated_at"> & { n: number })[];
}

export function textMessage(role: "user" | "assistant", text: string, metadata?: StoredMessage["metadata"]): StoredMessage {
  return { id: randomUUID(), role, parts: [{ type: "text", text }], metadata };
}

export function toModelMessages(messages: StoredMessage[]): ModelMessage[] {
  return messages
    .map((m) => ({ role: m.role, content: m.parts.filter((p) => p.type === "text" && p.text).map((p) => p.text).join("\n") }))
    .filter((m) => m.content.length > 0);
}
