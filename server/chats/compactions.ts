import { getDb } from "../database/connection.js";

const createCompaction = ({ chatId, startMessageId, endMessageId, summary, tokens = 0 }: {
  chatId: string; startMessageId: number; endMessageId: number; summary: string; tokens?: number;
}) => {
  const result = getDb().prepare(`
    INSERT INTO compactions (chat_id, start_message_id, end_message_id, summary, tokens)
    VALUES (?, ?, ?, ?, ?)
  `).run(String(chatId), Number(startMessageId), Number(endMessageId), String(summary || ""), Number(tokens) || 0);
  return Number(result.lastInsertRowid);
};

const getLatestCompaction = (chatId: string) => getDb().prepare(`
  SELECT id, chat_id, start_message_id, end_message_id, summary, tokens, created_at
  FROM compactions
  WHERE chat_id = ?
  ORDER BY end_message_id DESC, id DESC
  LIMIT 1
`).get(String(chatId)) || null;

export { createCompaction, getLatestCompaction };
