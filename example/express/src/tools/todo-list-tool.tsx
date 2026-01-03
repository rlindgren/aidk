import {
  Column,
  Context,
  COM,
  createTool,
  Grounding,
  Header,
  JSX,
  Paragraph,
  Row,
  Section,
  Table,
  TickState,
} from "aidk";
import { type ContentBlock } from "aidk";
import { z } from "zod";
import { TodoListService, TodoTask, type TodoActionOptions } from "../services/todo-list.service";

// ============================================================================
// Tool Schema
// ============================================================================

const TodoListInputSchema = z.object({
  action: z.enum(["create", "update", "complete", "uncomplete", "delete", "list"]),
  task_id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  completed: z.boolean().optional(),
});

type TodoListInput = z.infer<typeof TodoListInputSchema>;

export const TodoListTool = createTool({
  name: "todo_list",
  description: "Manage a todo list. Create, update, complete, and delete tasks.",
  input: TodoListInputSchema,
  handler: async (input: TodoListInput): Promise<ContentBlock[]> => {
    // Get context during execution
    const ctx = Context.get();
    const userId = ctx.user.id || ctx.metadata.userId || "anonymous";
    const sourceConnectionId = ctx.metadata.sessionId;
    const threadId = ctx.metadata.threadId;

    const options: TodoActionOptions = {
      sourceConnectionId,
      threadId,
    };

    // Delegate to service
    let result;
    switch (input.action) {
      case "create":
        result = await TodoListService.createTask(
          userId,
          input.title || "",
          input.description,
          options,
        );
        break;
      case "update":
        // Only include defined values to avoid overwriting with undefined
        const updates: { title?: string; description?: string; completed?: boolean } = {};
        if (input.title !== undefined) updates.title = input.title;
        if (input.description !== undefined) updates.description = input.description;
        if (input.completed !== undefined) updates.completed = input.completed;
        result = await TodoListService.updateTask(userId, input.task_id || "", updates, options);
        break;
      case "complete":
        result = await TodoListService.updateTask(
          userId,
          input.task_id || "",
          { completed: true },
          options,
        );
        break;
      case "uncomplete":
        result = await TodoListService.updateTask(
          userId,
          input.task_id || "",
          { completed: false },
          options,
        );
        break;
      case "delete":
        result = await TodoListService.deleteTask(userId, input.task_id || "", options);
        break;
      case "list":
        result = await TodoListService.listTasks(userId);
        break;
      default:
        result = {
          success: false,
          tasks: [],
          message: `Unknown action: ${input.action}. Please use one of the following actions: create, update, complete, uncomplete, delete, list.`,
        };
        break;
    }

    return [{ type: "text", text: result.message }];
  },

  async onMount(com: COM): Promise<void> {
    // Resolve userId from context
    const ctx = Context.get();
    const userId =
      ctx.user.id || ctx.metadata.userId || (com.getUserInput() as any)?.userId || "anonymous";

    // Load initial tasks and cache in COM state
    const tasks = await TodoListService.getTasks(userId);
    com.setState("todo_list_tasks", tasks);

    // Register this execution's context with the channel
    // Callback is auto-invoked when channel events are handled
    if (ctx) {
      TodoListService.channel?.registerContext(ctx, { userId }, (event, result: any) => {
        if (result?.success && result?.tasks) {
          com.setState("todo_list_tasks", result.tasks);
        }
      });
    }
  },

  async onUnmount(): Promise<void> {
    // Unregister context (also auto-cleaned on execution end as fail-safe)
    TodoListService.channel?.unregisterContext(Context.get());
  },

  render(com: COM, state: TickState): JSX.Element | null {
    const tasks = com.getState<TodoTask[]>("todo_list_tasks") || [];

    return (
      <>
        {/* Instructions - always rendered so model knows how to use this tool */}
        <Section
          id="todo-list-instructions"
          title="Todo List Tool"
          audience="model"
          tags={["todo-list", "instructions"]}
        >
          <Paragraph>
            You have a <inlineCode>todo_list</inlineCode> tool for managing tasks. ALWAYS use this
            tool when asked to create, update, or manage tasks.
          </Paragraph>
          <Paragraph>Available actions:</Paragraph>
          <Paragraph>
            - <inlineCode>create</inlineCode>: Create a new task (requires title, optional
            description)
          </Paragraph>
          <Paragraph>
            - <inlineCode>update</inlineCode>: Update an existing task (requires task_id, optional
            title/description/completed)
          </Paragraph>
          <Paragraph>
            - <inlineCode>complete</inlineCode>: Mark a task as complete (requires task_id)
          </Paragraph>
          <Paragraph>
            - <inlineCode>uncomplete</inlineCode>: Mark a task as incomplete (requires task_id)
          </Paragraph>
          <Paragraph>
            - <inlineCode>delete</inlineCode>: Delete a task (requires task_id)
          </Paragraph>
          <Paragraph>
            - <inlineCode>list</inlineCode>: List all tasks
          </Paragraph>
        </Section>

        {/* Current state - only rendered if tasks exist */}
        {tasks.length > 0 && (
          <Grounding
            id="current-tasks"
            position="after-system"
            audience="model"
            tags={["todo-list", "state"]}
          >
            <Header level={2}>Current Tasks</Header>
            <Table>
              <Row header>
                <Column>ID</Column>
                <Column>Title</Column>
                <Column>Description</Column>
                <Column>Completed</Column>
              </Row>
              {tasks.map((t) => (
                <Row key={t.id}>
                  <Column>[{t.completed ? "✔" : " "}]</Column>
                  <Column>{t.id}</Column>
                  <Column>{t.title}</Column>
                  <Column>{t.description || "-"}</Column>
                </Row>
              ))}
            </Table>
          </Grounding>
        )}
      </>
    );
  },
});
