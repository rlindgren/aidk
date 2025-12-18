import { 
  Component, 
  ContextObjectModel, 
  Context, 
  Logger,
  Message,
  MessageRole,
  Timeline,
  type TickState,
  type COMTimelineEntry,
  Paragraph,
  // State management
  signal,
  comState,
  computed,
  COMInput,
} from 'aidk';
import { getMessageRepository, type MessageEntity } from '../../persistence/repositories/messages';
import { Text } from 'aidk/jsx/components/content';
import { input } from 'aidk/state/use-state';

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
  windowSize = input<number>(100);
  
  // Component-local signal - NOT shared, NOT persisted
  private startedAt = signal<Date>(new Date());
  
  // COM-bound signal - shared across components, persisted
  // Automatically bound to COM in onMount
  private timeline = comState<COMTimelineEntry[]>('timeline', []);
  
  // Computed signal - derived, memoized
  private windowMessages = computed(() => {
    this.log.info({ windowSize: this.windowSize() }, 'Calculating window messages');
    return this.timeline()?.slice(-this.windowSize());
  });

  async onMount(com: ContextObjectModel): Promise<void> {
    // COM signals are automatically bound here by base class
    // No manual binding needed!
    const ctx = Context.get();
    const userInput = com.getUserInput();
    const { thread_id, user_id } = { ...(userInput.metadata || {}), ...ctx.metadata };

    let history: COMTimelineEntry[] = [];
    if (thread_id && thread_id !== '00000000-0000-0000-0000-000000000000' && user_id) {
      history = await this.loadConversationHistory(user_id as string, thread_id as string);
    }

    this.timeline.set([...history, ...(userInput.timeline || [])]);
  }

  onTickStart(_com: ContextObjectModel, { currentState }: TickState): void {
    // Update timeline with new entries
    // on tick 1 this holds user input (timeline, metadata)
    this.timeline.update((t) => [...t, ...(currentState.timeline || [])]);
  }

  async render() {
    this.log.info({ windowSize: this.windowSize() }, 'Rendering SlidingWindowTimeline');

    // Read from signals - clean, reactive API
    const startedAt = this.startedAt();

    return (
      <Timeline>
        {this.windowMessages().map((entry, index) => {
          const message = entry.message;
          const isHistorical = message.created_at && message.created_at < startedAt;
          const isUserMessage = message.role === MessageRole.USER;

          return <Message id={`msg-${index}`} {...message}>
            {[
              ...(
                (isHistorical && isUserMessage) ?
                  [<Text><strong>[{message.created_at.toLocaleString()}]</strong></Text>] :
                  []
              ),
              ...message.content.map((block, i) => {
                if (!isHistorical) {
                  return block;
                }
  
                const blockId = block.id || `msg_${message.id}_${i}`;
  
                if (block.type === 'image') {
                  return (
                    <Text id={blockId}>
                      [Summarized image content]: {block.alt_text}
                      {block.source.type === 'url' && (
                        <Paragraph>[Image url]: {block.source.url}</Paragraph>
                      )}
                    </Text>
                  );
                } else if (block.type === 'audio') {
                  return (
                    <Text id={blockId}>
                      [Audio transcript]: {block.transcript}
                    </Text>
                  );
                } else if (block.type === 'video') {
                  return (
                    <Text id={blockId}>
                      [Summarized video content]: {block.transcript}
                      {block.source.type === 'url' && (
                        <Paragraph>[Video url]: {block.source.url}</Paragraph>
                      )}
                    </Text>
                  );
                } else if (block.type === 'document') {
                  return (
                    <Text id={blockId}>
                      [Document title]: <strong>{block.title}</strong>
                      {block.source.type === 'url' && (
                        <Paragraph>[Document url]: {block.source.url}</Paragraph>
                      )}
                    </Text>
                  );
                }
  
                return block;
              })
            ]}
          </Message>;
        })}
      </Timeline>
    );
  }

  private async loadConversationHistory(userId: string, threadId: string): Promise<COMTimelineEntry[]> {
    if (!userId || !threadId) {
      return [];
    }
    
    // load messages for the conversation + interleaved user_action/system_event messages
    const persistedMessages = await getMessageRepository().findByThreadIdWithGlobalEvents(threadId, userId);
    this.log.info({ count: persistedMessages.length }, 'Loaded conversation history');
    
    // transform to COMTimelineEntry from database message entity
    return persistedMessages.map((msg: MessageEntity) => ({
      kind: 'message' as const,
      message: {
        role: msg.role,
        content: JSON.parse(msg.content),
        created_at: msg.created_at,
        id: msg.id,
        metadata: msg.metadata ? JSON.parse(msg.metadata || '{}') : undefined,
      }
    }));
  }
}
