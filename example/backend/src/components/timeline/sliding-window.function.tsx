import { 
  Context, 
  Logger,
  Message,
  MessageRole,
  Timeline,
  type COMTimelineEntry,
  Paragraph,
  EngineInput,
} from 'aidk';
import { getMessageRepository, type MessageEntity } from '../../persistence/repositories/messages';
import { Text } from 'aidk/jsx/components/content';
import { useComState, useTickStart, useInit, useSignal, useComputed } from 'aidk/compiler/hooks';

export interface SlidingWindowTimelineProps {
  windowSize: number;
}

const log = Logger.for('SlidingWindowTimeline');

/**
 * Example: SlidingWindowTimeline using V2 function component with hooks.
 * 
 * This demonstrates:
 * 1. Function components with props
 * 2. `useState()` - Component-local state
 * 3. `useComState()` - COM state (shared, persisted)
 * 4. `useComputed()` - Derived values (memoized)
 * 5. `useInit()` - Initialization (once on mount)
 * 6. `useTickStart()` - Tick start lifecycle
 */
export async function SlidingWindowTimeline(props: SlidingWindowTimelineProps) {
  const { windowSize = 100 } = props;
  
  // Component-local state - NOT shared, NOT persistent
  const startedAt = useSignal<Date>(new Date());
  
  // COM-bound state - shared across components, persistent
  const timeline = useComState<COMTimelineEntry[]>('timeline', []);

  const windowMessages = useComputed(() => {
    log.info({ windowSize }, 'Calculating window messages');
    return timeline().slice(-windowSize);
  }, [windowSize, timeline]);
  
  // Initialize timeline once on mount - loads history + initial user input
  await useInit(async (com, _state) => {
    log.info('Initializing timeline');
    const ctx = Context.get();
    const userInput = com.getUserInput();
    const { thread_id, user_id } = { ...(userInput.metadata || {}), ...ctx.metadata };

    log.info({ userInput }, 'Loading conversation history');

    let history: COMTimelineEntry[] = [];
    if (thread_id && thread_id !== '00000000-0000-0000-0000-000000000000' && user_id) {
      history = await loadConversationHistory(user_id as string, thread_id as string);
    }
    
    // Combine history + initial user input in one atomic operation
    timeline.set([...history, ...(userInput.timeline || [])]);
  });

  // Append new entries on subsequent ticks (tick 2+)
  useTickStart((_com, { currentState }) => {
    timeline.update(t => [...t, ...(currentState.timeline || [])]);
  });
  
  // Render
  return (
    <Timeline>
      {windowMessages().map((entry, index) => {
        const message = entry.message;
        const isHistorical = message.created_at && message.created_at < startedAt();
        const isUserMessage = message.role === MessageRole.USER;

        return <Message 
          key={`msg-${index}`} 
          id={message.id || `msg-${index}`}
          role={message.role}
          metadata={message.metadata}
          created_at={message.created_at}
          updated_at={message.updated_at}
        >
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

// Helper function to load conversation history
async function loadConversationHistory(userId: string, threadId: string): Promise<COMTimelineEntry[]> {
  if (!userId || !threadId) {
    return [];
  }
  
  const persistedMessages = await getMessageRepository().findByThreadIdWithGlobalEvents(threadId, userId);
  log.info({ count: persistedMessages.length }, 'Loaded conversation history');
  
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
