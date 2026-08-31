import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/AppShell";
import * as api from "@/lib/api";
import { initialData } from "@/lib/kanban";

// importOriginal keeps the real UnauthorizedError class, which KanbanBoard
// checks with instanceof.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  getBoard: vi.fn(),
  saveBoard: vi.fn(),
}));

const mockedApi = vi.mocked(api);

const signIn = async () => {
  await userEvent.type(screen.getByLabelText("Username"), "user");
  await userEvent.type(screen.getByLabelText("Password"), "password");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
};

describe("AppShell", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedApi.getBoard.mockResolvedValue(structuredClone(initialData));
    mockedApi.saveBoard.mockResolvedValue(undefined);
  });

  it("shows the login form when there is no session", async () => {
    mockedApi.getMe.mockResolvedValue(null);
    render(<AppShell />);

    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kanban Studio" })).not.toBeInTheDocument();
  });

  it("shows the board when a session already exists", async () => {
    mockedApi.getMe.mockResolvedValue({ username: "user" });
    render(<AppShell />);

    expect(
      await screen.findByRole("heading", { name: "Kanban Studio" })
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
  });

  it("shows the board after a successful sign in", async () => {
    mockedApi.getMe.mockResolvedValue(null);
    mockedApi.login.mockResolvedValue({ username: "user" });
    render(<AppShell />);

    await screen.findByRole("button", { name: /sign in/i });
    await signIn();

    expect(
      await screen.findByRole("heading", { name: "Kanban Studio" })
    ).toBeInTheDocument();
    expect(mockedApi.login).toHaveBeenCalledWith("user", "password");
  });

  it("shows an error and stays on the form when credentials are rejected", async () => {
    mockedApi.getMe.mockResolvedValue(null);
    mockedApi.login.mockRejectedValue(new Error("Incorrect username or password"));
    render(<AppShell />);

    await screen.findByRole("button", { name: /sign in/i });
    await signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /incorrect username or password/i
    );
    expect(screen.queryByRole("heading", { name: "Kanban Studio" })).not.toBeInTheDocument();
  });

  it("returns to the login form after signing out", async () => {
    mockedApi.getMe.mockResolvedValue({ username: "user" });
    mockedApi.logout.mockResolvedValue(undefined);
    render(<AppShell />);

    await screen.findByRole("heading", { name: "Kanban Studio" });
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument()
    );
    expect(mockedApi.logout).toHaveBeenCalledOnce();
  });

  it("returns to the login form when the board reports the session expired", async () => {
    mockedApi.getMe.mockResolvedValue({ username: "user" });
    mockedApi.getBoard.mockRejectedValue(new api.UnauthorizedError());
    render(<AppShell />);

    expect(
      await screen.findByRole("button", { name: /sign in/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kanban Studio" })).not.toBeInTheDocument();
  });

  it("returns to the login form when a board save reports the session expired", async () => {
    mockedApi.getMe.mockResolvedValue({ username: "user" });
    mockedApi.saveBoard.mockRejectedValue(new api.UnauthorizedError());
    render(<AppShell />);

    await screen.findByRole("heading", { name: "Kanban Studio" });
    await userEvent.click(
      screen.getByRole("button", { name: /delete align roadmap themes/i })
    );

    expect(
      await screen.findByRole("button", { name: /sign in/i })
    ).toBeInTheDocument();
  });

  it("falls back to the login form when the session check fails", async () => {
    mockedApi.getMe.mockRejectedValue(new Error("network down"));
    render(<AppShell />);

    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });
});
