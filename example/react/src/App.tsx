import { useEngineClient, useExecution, useTodoList, useScratchpad } from "./hooks";
import { ChatInterface, TodoListUI, ScratchpadUI } from "./components";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "";

function App() {
  // Get client from shared hook with environment-specific config
  const { client } = useEngineClient({
    baseUrl: API_URL,
    userId: "demo-user", // Default for demo; in real app, would come from auth
    callbacks: {
      onConnect: () => console.log("Connected!"),
      onDisconnect: (reason) => console.log("Disconnected:", reason),
      onReconnecting: (attempt, delay) => console.log(`Retry ${attempt} in ${delay}ms`),
      onReconnected: (attempts) => console.log(`Reconnected after ${attempts} attempts`),
      onReconnectFailed: (attempts) => console.log("Gave up after", attempts),
      onError: (error) => console.error("SSE error:", error),
      onOffline: () => console.log("Browser went offline"),
      onOnline: () => console.log("Browser back online"),
      onStateChange: (state, info) => console.log("State changed:", state, info),
    },
  });

  // Use shared execution hook
  const { messages, isStreaming, sendMessage, clearMessages, threadId } = useExecution({
    client,
    agentId: "task-assistant",
  });

  // App-specific todo list hook (tasks are user-scoped, not thread-scoped)
  const {
    tasks,
    isLoading: isTaskLoading,
    createTask,
    toggleComplete,
    deleteTask,
  } = useTodoList(client, "demo-user"); // userId matches client config

  // App-specific scratchpad hook (thread-scoped)
  const {
    notes,
    isLoading: isNoteLoading,
    addNote,
    removeNote,
    clearNotes,
  } = useScratchpad(client, threadId);

  // Scratchpad component to render in chat
  const scratchpad = (
    <ScratchpadUI
      notes={notes}
      isLoading={isNoteLoading}
      onAddNote={addNote}
      onRemoveNote={removeNote}
      onClear={clearNotes}
    />
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>aidk Example</h1>
        <p>Task Assistant with Channel-Synced Components</p>
      </header>

      <main className="app-main">
        <div className="panel chat-panel">
          <ChatInterface
            messages={messages.filter((m) => m.role !== "tool")}
            isStreaming={isStreaming}
            onSendMessage={sendMessage}
            onClear={clearMessages}
            topContent={scratchpad}
          />
        </div>

        <div className="panel todo-panel">
          <TodoListUI
            tasks={tasks}
            isLoading={isTaskLoading}
            onCreateTask={createTask}
            onToggleComplete={toggleComplete}
            onDeleteTask={deleteTask}
          />
        </div>
      </main>

      <footer className="app-footer">
        <p>
          Powered by <strong>aidk</strong> • Channel-based state sync • React frontend
        </p>
      </footer>
    </div>
  );
}

export default App;
