import {
  Context,
  COM,
  createTool,
  Grounding,
  JSX,
  List,
  ListItem,
  Paragraph,
  Section,
  TickState,
} from "aidk";
import { type ContentBlock } from "aidk";
import { z } from "zod";
import {
  ScratchpadNote,
  ScratchpadService,
  type ScratchpadActionOptions,
} from "../services/scratchpad.service";
import { GLOBAL_THREAD_ID } from "../services";

// ============================================================================
// Tool Schema
// ============================================================================

const ScratchpadInputSchema = z.object({
  action: z.enum(["add", "remove", "clear", "list"]),
  note_id: z.string().optional(),
  text: z.string().optional(),
});

type ScratchpadInput = z.infer<typeof ScratchpadInputSchema>;

// ============================================================================
// ScratchpadTool - Component wrapper for ScratchpadService
// ============================================================================

export const ScratchpadTool = createTool({
  name: "scratchpad",
  description:
    "A scratchpad for quick notes during this conversation. Use it to jot down important points, track context, or organize your thoughts. Notes are visible to both you and the user.",
  input: ScratchpadInputSchema,
  handler: async (input: ScratchpadInput): Promise<ContentBlock[]> => {
    // Get context during execution
    const ctx = Context.get();
    const threadId = ctx.metadata.threadId || GLOBAL_THREAD_ID;
    const sourceConnectionId = ctx.metadata.sessionId;

    const options: ScratchpadActionOptions = {
      sourceConnectionId,
    };

    // Delegate to service
    let result;
    switch (input.action) {
      case "add":
        result = await ScratchpadService.addNote(threadId, input.text || "", "model", options);
        break;
      case "remove":
        result = await ScratchpadService.removeNote(threadId, input.note_id || "", options);
        break;
      case "clear":
        result = await ScratchpadService.clearNotes(threadId, options);
        break;
      case "list":
        result = await ScratchpadService.listNotes(threadId);
        break;
      default:
        result = {
          success: false,
          message: `Unknown action: ${input.action}. Please use one of the following actions: add, remove, clear, list.`,
        };
        break;
    }

    return [{ type: "text", text: result.message }];
  },

  async onMount(com: COM): Promise<void> {
    // Resolve threadId from context
    const ctx = Context.get();
    const userInput = com.getUserInput() as any;
    const threadId =
      (ctx?.metadata?.["threadId"] as string) ||
      (ctx?.metadata?.["threadId"] as string) ||
      userInput?.threadId ||
      userInput?.threadId ||
      userInput?.metadata?.threadId ||
      userInput?.metadata?.threadId ||
      "00000000-0000-0000-0000-000000000000";

    console.log(`📝 ScratchpadTool.onMount: threadId=${threadId}`);

    // Load initial notes and cache in COM state
    const notes = await ScratchpadService.getNotes(threadId);
    com.setState("scratchpad_notes", notes);

    // Register this execution's context with the channel
    // Callback is auto-invoked when channel events are handled
    if (ctx) {
      ScratchpadService.channel?.registerContext(
        ctx,
        { threadId: threadId },
        (event, result: any) => {
          if (result?.success && result?.notes) {
            com.setState("scratchpad_notes", result.notes);
          }
        },
      );
    }
  },

  async onUnmount(): Promise<void> {
    // Unregister context (also auto-cleaned on execution end as fail-safe)
    ScratchpadService.channel?.unregisterContext(Context.get());
  },

  render(com: COM, state: TickState): JSX.Element | null {
    const notes = com.getState<ScratchpadNote[]>("scratchpad_notes") || [];

    return (
      <>
        {/* Instructions - always rendered so model knows how to use this tool */}
        <Section
          id="scratchpad-instructions"
          title="Scratchpad Tool"
          audience="model"
          tags={["scratchpad", "instructions"]}
        >
          <Paragraph>
            You have a <inlineCode>scratchpad</inlineCode> tool for taking notes during this
            conversation. Use it to jot down important points, track context, or organize your
            thoughts. Notes are visible to both you and the user.
          </Paragraph>
          <Paragraph>Available actions:</Paragraph>
          <Paragraph>- add: Add a note (requires text)</Paragraph>
          <Paragraph>- remove: Remove a note (requires note_id)</Paragraph>
          <Paragraph>- clear: Clear all notes</Paragraph>
          <Paragraph>- list: List all notes</Paragraph>
        </Section>

        {/* Current state - rendered as user message for better model attention */}
        {notes.length === 0 ? (
          <Grounding
            position="after-system"
            id="scratchpad-empty-state"
            audience="model"
            tags={["scratchpad", "state"]}
          >
            <Paragraph>
              <strong>Current Scratchpad State:</strong> You have NO notes saved. The scratchpad is
              empty.
            </Paragraph>
          </Grounding>
        ) : (
          <Grounding
            position="after-system"
            id="scratchpad-notes"
            audience="model"
            tags={["scratchpad", "state"]}
          >
            <Paragraph>
              <strong>Current Scratchpad State:</strong> You have {notes.length} active note(s)
              saved:
            </Paragraph>
            <List ordered>
              {notes.map((note, index) => (
                <ListItem key={note.id || index.toString()}>
                  <strong>Note {index + 1}:</strong> "{note.text}" (ID: {note.id})
                </ListItem>
              ))}
            </List>
            <Paragraph>
              <em>
                These notes are currently active and visible to the user. When the user asks about
                notes, these are the notes they are referring to.
              </em>
            </Paragraph>
          </Grounding>
        )}
      </>
    );
  },
});
