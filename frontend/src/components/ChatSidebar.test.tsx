import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSidebar } from "@/components/ChatSidebar";
import * as api from "@/lib/api";

// importOriginal keeps the real UnauthorizedError class, which the component
// checks with instanceof.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  sendChat: vi.fn(),
}));

const mockedApi = vi.mocked(api);

type HarnessProps = {
  onBoardUpdated?: () => void;
  onUnauthorized?: () => void;
};

/** Open state lives in KanbanBoard, so the tests supply it the same way. */
const Harness = ({ onBoardUpdated, onUnauthorized }: HarnessProps) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <ChatSidebar
      isOpen={isOpen}
      onToggle={() => setIsOpen((previous) => !previous)}
      onBoardUpdated={onBoardUpdated ?? vi.fn()}
      onUnauthorized={onUnauthorized ?? vi.fn()}
    />
  );
};

const openSidebar = async (props: HarnessProps = {}) => {
  render(<Harness {...props} />);
  await userEvent.click(screen.getByTestId("chat-toggle"));
  return screen.getByLabelText("Message");
};

describe("ChatSidebar", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedApi.sendChat.mockResolvedValue({ reply: "Sure.", boardUpdated: false });
  });

  it("opens and closes", async () => {
    render(<Harness />);
    expect(screen.queryByTestId("chat-sidebar")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("chat-toggle"));
    expect(screen.getByTestId("chat-sidebar")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByTestId("chat-sidebar")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-toggle")).toBeInTheDocument();
  });

  it("focuses the input when opened, so it is usable from the keyboard", async () => {
    const input = await openSidebar();
    expect(input).toHaveFocus();
  });

  it("renders the sent message and then the reply", async () => {
    mockedApi.sendChat.mockResolvedValue({
      reply: "You have eight cards.",
      boardUpdated: false,
    });
    const input = await openSidebar();

    await userEvent.type(input, "How many cards?");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(screen.getByTestId("chat-user")).toHaveTextContent("How many cards?");
    expect(await screen.findByTestId("chat-assistant")).toHaveTextContent(
      "You have eight cards."
    );
    expect(input).toHaveValue("");
  });

  it("shows a thinking indicator while the request is in flight", async () => {
    let resolveReply: (reply: api.ChatReply) => void = () => {};
    mockedApi.sendChat.mockReturnValue(
      new Promise((resolve) => {
        resolveReply = resolve;
      })
    );
    const input = await openSidebar();

    await userEvent.type(input, "Hello");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(screen.getByTestId("chat-thinking")).toBeInTheDocument();

    resolveReply({ reply: "Hi.", boardUpdated: false });
    await screen.findByTestId("chat-assistant");
    expect(screen.queryByTestId("chat-thinking")).not.toBeInTheDocument();
  });

  it("reports a board change and confirms it in the conversation", async () => {
    const onBoardUpdated = vi.fn();
    mockedApi.sendChat.mockResolvedValue({ reply: "Added it.", boardUpdated: true });
    const input = await openSidebar({ onBoardUpdated });

    await userEvent.type(input, "Add a card");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(onBoardUpdated).toHaveBeenCalledOnce());
    expect(screen.getByTestId("chat-board-updated")).toBeInTheDocument();
  });

  it("does not report a board change when nothing changed", async () => {
    const onBoardUpdated = vi.fn();
    const input = await openSidebar({ onBoardUpdated });

    await userEvent.type(input, "How many cards?");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await screen.findByTestId("chat-assistant");
    expect(onBoardUpdated).not.toHaveBeenCalled();
    expect(screen.queryByTestId("chat-board-updated")).not.toBeInTheDocument();
  });

  it("shows an error and keeps the conversation when a request fails", async () => {
    mockedApi.sendChat.mockResolvedValueOnce({ reply: "Sure.", boardUpdated: false });
    const input = await openSidebar();

    await userEvent.type(input, "First question");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await screen.findByTestId("chat-assistant");

    mockedApi.sendChat.mockRejectedValueOnce(new Error("gateway"));
    await userEvent.type(input, "Second question");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByTestId("chat-error")).toBeInTheDocument();
    expect(screen.getAllByTestId("chat-user")).toHaveLength(2);
    expect(screen.getByText("First question")).toBeInTheDocument();
    expect(screen.getByText("Sure.")).toBeInTheDocument();
  });

  it("sends the accumulated history with each turn", async () => {
    mockedApi.sendChat.mockResolvedValueOnce({ reply: "First reply", boardUpdated: false });
    const input = await openSidebar();

    await userEvent.type(input, "One");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await screen.findByText("First reply");

    await userEvent.type(input, "Two");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(mockedApi.sendChat).toHaveBeenCalledTimes(2));
    expect(mockedApi.sendChat).toHaveBeenNthCalledWith(1, "One", []);
    expect(mockedApi.sendChat).toHaveBeenNthCalledWith(2, "Two", [
      { role: "user", content: "One" },
      { role: "assistant", content: "First reply" },
    ]);
  });

  it("sends on Enter", async () => {
    const input = await openSidebar();

    await userEvent.type(input, "Ship it{Enter}");

    await waitFor(() => expect(mockedApi.sendChat).toHaveBeenCalledOnce());
    expect(mockedApi.sendChat).toHaveBeenCalledWith("Ship it", []);
  });

  it("adds a newline on Shift+Enter without sending", async () => {
    const input = await openSidebar();

    await userEvent.type(input, "One{Shift>}{Enter}{/Shift}Two");

    expect(input).toHaveValue("One\nTwo");
    expect(mockedApi.sendChat).not.toHaveBeenCalled();
  });

  it("does not send an empty message", async () => {
    const input = await openSidebar();

    await userEvent.type(input, "   {Enter}");

    expect(mockedApi.sendChat).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("reports unauthorized without showing an error", async () => {
    const onUnauthorized = vi.fn();
    mockedApi.sendChat.mockRejectedValue(new api.UnauthorizedError());
    const input = await openSidebar({ onUnauthorized });

    await userEvent.type(input, "Hello");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce());
    expect(screen.queryByTestId("chat-error")).not.toBeInTheDocument();
  });
});
