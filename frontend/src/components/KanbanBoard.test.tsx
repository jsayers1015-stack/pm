import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import * as api from "@/lib/api";
import { initialData, type BoardData } from "@/lib/kanban";

// importOriginal keeps the real UnauthorizedError class, which the component
// checks with instanceof.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getBoard: vi.fn(),
  saveBoard: vi.fn(),
  sendChat: vi.fn(),
}));

const mockedApi = vi.mocked(api);

const renderBoard = async () => {
  const props = {
    username: "user",
    onSignOut: vi.fn(),
    onUnauthorized: vi.fn(),
  };
  render(<KanbanBoard {...props} />);
  await screen.findByRole("heading", { name: "Kanban Studio" });
  return props;
};

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];

const lastSavedBoard = (): BoardData =>
  mockedApi.saveBoard.mock.calls.at(-1)![0];

describe("KanbanBoard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedApi.getBoard.mockResolvedValue(structuredClone(initialData));
    mockedApi.saveBoard.mockResolvedValue(undefined);
    mockedApi.sendChat.mockResolvedValue({ reply: "Sure.", boardUpdated: false });
  });

  it("shows a loading state until the board arrives", async () => {
    let resolveBoard: (board: typeof initialData) => void = () => {};
    mockedApi.getBoard.mockReturnValue(
      new Promise((resolve) => {
        resolveBoard = resolve;
      })
    );

    render(
      <KanbanBoard username="user" onSignOut={vi.fn()} onUnauthorized={vi.fn()} />
    );

    expect(screen.getByTestId("board-loading")).toBeInTheDocument();
    resolveBoard(structuredClone(initialData));
    expect(
      await screen.findByRole("heading", { name: "Kanban Studio" })
    ).toBeInTheDocument();
  });

  it("renders the board returned by the API", async () => {
    await renderBoard();
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);
    expect(screen.getByText("Align roadmap themes")).toBeInTheDocument();
    expect(mockedApi.getBoard).toHaveBeenCalledOnce();
  });

  it("does not save anything on load", async () => {
    await renderBoard();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mockedApi.saveBoard).not.toHaveBeenCalled();
  });

  it("renames a column and saves once for the whole edit", async () => {
    await renderBoard();
    const input = within(getFirstColumn()).getByLabelText("Column title");

    await userEvent.clear(input);
    await userEvent.type(input, "Later");

    expect(input).toHaveValue("Later");
    await waitFor(() => expect(mockedApi.saveBoard).toHaveBeenCalled());
    // Five keystrokes plus a clear must coalesce into a single request.
    expect(mockedApi.saveBoard).toHaveBeenCalledOnce();
    expect(lastSavedBoard().columns[0].title).toBe("Later");
  });

  it("adds a card and saves it", async () => {
    await renderBoard();
    const column = getFirstColumn();

    await userEvent.click(
      within(column).getByRole("button", { name: /add a card/i })
    );
    await userEvent.type(
      within(column).getByPlaceholderText(/card title/i),
      "New card"
    );
    await userEvent.type(within(column).getByPlaceholderText(/details/i), "Notes");
    await userEvent.click(
      within(column).getByRole("button", { name: /add card/i })
    );

    expect(within(column).getByText("New card")).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.saveBoard).toHaveBeenCalledOnce());

    const saved = lastSavedBoard();
    const titles = Object.values(saved.cards).map((card) => card.title);
    expect(titles).toContain("New card");
  });

  it("removes a card and saves it", async () => {
    await renderBoard();
    const column = getFirstColumn();

    await userEvent.click(
      within(column).getByRole("button", { name: /delete align roadmap themes/i })
    );

    expect(within(column).queryByText("Align roadmap themes")).not.toBeInTheDocument();
    await waitFor(() => expect(mockedApi.saveBoard).toHaveBeenCalledOnce());
    expect(lastSavedBoard().cards["card-1"]).toBeUndefined();
  });

  it("edits a card and saves it", async () => {
    await renderBoard();
    const card = screen.getByTestId("card-card-1");

    await userEvent.click(
      within(card).getByRole("button", { name: /edit align roadmap themes/i })
    );
    const titleInput = within(card).getByLabelText("Edit title");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Reframed roadmap");
    const detailsInput = within(card).getByLabelText("Edit details");
    await userEvent.clear(detailsInput);
    await userEvent.type(detailsInput, "Updated notes.");
    await userEvent.click(within(card).getByRole("button", { name: /save/i }));

    expect(within(card).getByText("Reframed roadmap")).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.saveBoard).toHaveBeenCalledOnce());
    expect(lastSavedBoard().cards["card-1"].title).toBe("Reframed roadmap");
    expect(lastSavedBoard().cards["card-1"].details).toBe("Updated notes.");
  });

  it("leaves the card unchanged when an edit is discarded and saves nothing", async () => {
    await renderBoard();
    const card = screen.getByTestId("card-card-1");

    await userEvent.click(
      within(card).getByRole("button", { name: /edit align roadmap themes/i })
    );
    const titleInput = within(card).getByLabelText("Edit title");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Should not stick");
    await userEvent.click(within(card).getByRole("button", { name: /discard/i }));

    expect(within(card).getByText("Align roadmap themes")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mockedApi.saveBoard).not.toHaveBeenCalled();
  });

  it("does not save an edit with an empty title", async () => {
    await renderBoard();
    const card = screen.getByTestId("card-card-1");

    await userEvent.click(
      within(card).getByRole("button", { name: /edit align roadmap themes/i })
    );
    await userEvent.clear(within(card).getByLabelText("Edit title"));
    await userEvent.click(within(card).getByRole("button", { name: /save/i }));

    expect(within(card).getByLabelText("Edit title")).toBeInTheDocument();
    expect(mockedApi.saveBoard).not.toHaveBeenCalled();
  });

  it("shows the signed in user and calls back on sign out", async () => {
    const props = await renderBoard();

    expect(screen.getByText(/signed in as user/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(props.onSignOut).toHaveBeenCalledOnce());
    expect(mockedApi.saveBoard).not.toHaveBeenCalled();
  });

  it("saves a pending change before signing out", async () => {
    const props = await renderBoard();
    props.onSignOut.mockImplementation(() => {
      expect(mockedApi.saveBoard).toHaveBeenCalledOnce();
    });

    await userEvent.click(
      within(getFirstColumn()).getByRole("button", {
        name: /delete align roadmap themes/i,
      })
    );
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(props.onSignOut).toHaveBeenCalledOnce());
    expect(lastSavedBoard().cards["card-1"]).toBeUndefined();
  });

  it("sends a pending change when the board unmounts", async () => {
    const { unmount } = render(
      <KanbanBoard username="user" onSignOut={vi.fn()} onUnauthorized={vi.fn()} />
    );
    await screen.findByRole("heading", { name: "Kanban Studio" });

    await userEvent.click(
      within(getFirstColumn()).getByRole("button", {
        name: /delete align roadmap themes/i,
      })
    );
    unmount();

    expect(mockedApi.saveBoard).toHaveBeenCalledOnce();
    expect(mockedApi.saveBoard.mock.calls[0][1]).toEqual({ keepalive: true });
    expect(lastSavedBoard().cards["card-1"]).toBeUndefined();
  });

  it("sends a pending change when the page is hidden, and only once", async () => {
    await renderBoard();

    await userEvent.click(
      within(getFirstColumn()).getByRole("button", {
        name: /delete align roadmap themes/i,
      })
    );
    window.dispatchEvent(new Event("pagehide"));

    expect(mockedApi.saveBoard).toHaveBeenCalledOnce();
    // The debounce timer must not send the same change again.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mockedApi.saveBoard).toHaveBeenCalledOnce();
  });

  it("surfaces an error and refetches when a save fails", async () => {
    await renderBoard();
    mockedApi.saveBoard.mockRejectedValue(new Error("server exploded"));

    const resynced = structuredClone(initialData);
    resynced.cards["card-1"].title = "Server version";
    mockedApi.getBoard.mockResolvedValue(resynced);

    await userEvent.click(
      within(getFirstColumn()).getByRole("button", {
        name: /delete align roadmap themes/i,
      })
    );

    expect(await screen.findByTestId("save-error")).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.getBoard).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Server version")).toBeInTheDocument();
  });

  it("reports a failed load without rendering the board", async () => {
    mockedApi.getBoard.mockRejectedValue(new Error("offline"));
    render(
      <KanbanBoard username="user" onSignOut={vi.fn()} onUnauthorized={vi.fn()} />
    );

    expect(await screen.findByTestId("board-error")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kanban Studio" })).not.toBeInTheDocument();
  });

  it("reports unauthorized when the board load is rejected", async () => {
    mockedApi.getBoard.mockRejectedValue(new api.UnauthorizedError());
    const onUnauthorized = vi.fn();

    render(
      <KanbanBoard
        username="user"
        onSignOut={vi.fn()}
        onUnauthorized={onUnauthorized}
      />
    );

    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce());
  });

  it("shows the AI board change without a reload and saves nothing back", async () => {
    await renderBoard();
    const aiBoard = structuredClone(initialData);
    aiBoard.cards["card-9"] = {
      id: "card-9",
      title: "Book the venue",
      details: "From the assistant",
    };
    aiBoard.columns[0].cardIds.push("card-9");
    mockedApi.getBoard.mockResolvedValue(aiBoard);
    mockedApi.sendChat.mockResolvedValue({ reply: "Added it.", boardUpdated: true });

    await userEvent.click(screen.getByTestId("chat-toggle"));
    await userEvent.type(screen.getByLabelText("Message"), "Add a card{Enter}");

    expect(await screen.findByText("Book the venue")).toBeInTheDocument();
    // The AI already wrote the board, so pulling it must not trigger a PUT.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mockedApi.saveBoard).not.toHaveBeenCalled();
  });

  it("does not refetch the board when the assistant changed nothing", async () => {
    await renderBoard();

    await userEvent.click(screen.getByTestId("chat-toggle"));
    await userEvent.type(screen.getByLabelText("Message"), "How many cards?{Enter}");

    await screen.findByTestId("chat-assistant");
    expect(mockedApi.getBoard).toHaveBeenCalledOnce();
  });

  it("reports unauthorized when a save is rejected", async () => {
    const props = await renderBoard();
    mockedApi.saveBoard.mockRejectedValue(new api.UnauthorizedError());

    await userEvent.click(
      within(getFirstColumn()).getByRole("button", {
        name: /delete align roadmap themes/i,
      })
    );

    await waitFor(() => expect(props.onUnauthorized).toHaveBeenCalledOnce());
    expect(screen.queryByTestId("save-error")).not.toBeInTheDocument();
  });
});
