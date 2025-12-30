import {
  Component,
  COM,
  context,
  Logger,
  Timeline,
  type TickState,
  type COMTimelineEntry,
  // State management
  signal,
  comState,
  computed,
} from "aidk";
import { getMessageRepository, type MessageEntity } from "../../persistence/repositories/messages";
import { input } from "aidk/state/use-state";
import { FormattedMessage } from "../messages/formatted-message.component";

export interface SlidingWindowTimelineProps {
  windowSize: number;
}

/**
 * Example: SlidingWindowTimeline using signals for reactive state management.
 *
 * This demonstrates:
 * 1. `signal()` - Component-local state (not shared)
 * 2. `comState()` - COM state (shared, auto-bound in onMount)
 * 3. `computed()` - Derived values (memoized)
 * 4. `input()` - Readonly signals for props values
 * 5. Automatic cleanup on unmount
 * 6. Manual disposal if needed
 */
export class SlidingWindowTimeline extends Component<SlidingWindowTimelineProps> {
  private log = Logger.for(this);

  // bind to the windowSize prop
  windowSize = input(100);

  // COM-bound signal - shared across components, persisted
  // Automatically bound to COM in onMount
  private timeline = comState<COMTimelineEntry[]>("timeline", []);

  // Computed signal - derived, memoized
  private windowMessages = computed(() => this.timeline().slice(-this.windowSize()));

  async onMount(com: COM): Promise<void> {
    // COM signals are automatically bound here by base class
    // No manual binding needed!
    const userInput = com.getUserInput();
    const { threadId, userId } = { ...(userInput.metadata || {}), ...context().metadata };

    let history: COMTimelineEntry[] = [];
    if (threadId && threadId !== "00000000-0000-0000-0000-000000000000" && userId) {
      history = await this.loadConversationHistory(userId as string, threadId as string);
    }

    this.timeline.set([...history, ...(userInput.timeline || [])]);
  }

  onTickStart(_com: COM, { current }: TickState): void {
    // Update timeline with new entries
    // on tick 1 this holds user input (timeline, metadata)
    this.timeline.update((curr) => [...curr, ...(current.timeline || [])]);
  }

  async render() {
    this.log.info({ windowSize: this.windowSize() }, "Rendering SlidingWindowTimeline");

    return (
      <Timeline>
        {this.windowMessages().map((entry, index) => (
          <FormattedMessage key={`msg-${index}`} message={entry.message} />
        ))}
      </Timeline>
    );
  }

  private async loadConversationHistory(
    userId: string,
    threadId: string,
  ): Promise<COMTimelineEntry[]> {
    if (!userId || !threadId) {
      return [];
    }

    // load messages for the conversation + interleaved user_action/system_event messages
    const persistedMessages = await getMessageRepository().findByThreadIdWithGlobalEvents(
      threadId,
      userId,
    );
    this.log.info({ count: persistedMessages.length }, "Loaded conversation history");

    // transform to COMTimelineEntry from database message entity
    return persistedMessages.map((msg: MessageEntity) => ({
      kind: "message" as const,
      message: {
        role: msg.role,
        content: JSON.parse(msg.content),
        createdAt: msg.created_at,
        id: msg.id,
        metadata: msg.metadata ? JSON.parse(msg.metadata || "{}") : undefined,
      },
    }));
  }
}
