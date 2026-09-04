import type { BoardData } from "@/lib/kanban";

export type Me = { username: string };

/** Thrown on any 401, so callers can send the user back to the login form. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthorizedError";
  }
}

const request = (path: string, init?: RequestInit) =>
  fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });

export const getMe = async (): Promise<Me | null> => {
  const response = await request("/me");
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Could not load session (${response.status})`);
  }
  return response.json();
};

export const login = async (
  username: string,
  password: string
): Promise<Me> => {
  const response = await request("/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (response.status === 401) {
    throw new Error("Incorrect username or password");
  }
  if (!response.ok) {
    throw new Error(`Sign in failed (${response.status})`);
  }
  return response.json();
};

export const logout = async (): Promise<void> => {
  await request("/logout", { method: "POST" });
};

export const getBoard = async (): Promise<BoardData> => {
  const response = await request("/board");
  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    throw new Error(`Could not load the board (${response.status})`);
  }
  return response.json();
};

export const saveBoard = async (board: BoardData): Promise<void> => {
  const response = await request("/board", {
    method: "PUT",
    body: JSON.stringify(board),
  });
  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    throw new Error(`Could not save the board (${response.status})`);
  }
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatReply = { reply: string; boardUpdated: boolean };

export const sendChat = async (
  message: string,
  history: ChatMessage[]
): Promise<ChatReply> => {
  const response = await request("/chat", {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    throw new Error(`The assistant could not reply (${response.status})`);
  }
  const data = await response.json();
  return { reply: data.reply, boardUpdated: data.board_updated };
};
