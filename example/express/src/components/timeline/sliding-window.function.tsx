import { 
  context,
  Logger,
  Timeline,
  type COMTimelineEntry,
} from 'aidk';
import { getMessageRepository, type MessageEntity } from '../../persistence/repositories/messages';
import { useComState, useTickStart, useInit, useSignal, useComputed } from 'aidk/state/hooks';
import { FormattedMessage } from '../messages/formatted-message.component';

export interface SlidingWindowTimelineProps {
  windowSize: number;
}

const log = Logger.for(SlidingWindowTimeline);

/**
 * Example: SlidingWindowTimeline using function component with hooks.
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
  
  // COM-bound state - shared across components, persistent
  const timeline = useComState<COMTimelineEntry[]>('timeline', []);

  const windowMessages = useComputed(() => timeline().slice(-windowSize), [windowSize]);
  
  // Initialize timeline once on mount - loads history + initial user input
  await useInit(async (com, _state) => {
    log.info('Initializing timeline');
    const userInput = com.getUserInput();
    const { threadId, userId } = { ...(userInput.metadata || {}), ...context().metadata };

    log.info({ userInput }, 'Loading conversation history');

    let history: COMTimelineEntry[] = [];
    if (threadId && threadId !== '00000000-0000-0000-0000-000000000000' && userId) {
      history = await loadConversationHistory(userId as string, threadId as string);
    }
    
    // Combine history + initial user input in one atomic operation
    timeline.set([...history, ...(userInput.timeline || [])]);
  });

  // Append new entries on subsequent ticks (tick 2+)
  useTickStart((_com, { current }) => {
    timeline.update(curr => [...curr, ...(current.timeline || [])]);
  });
  
  // Render
  return (
    <Timeline>
      {windowMessages().map((entry, index) => 
        <FormattedMessage key={`msg-${index}`} message={entry.message} />
      )}
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
      createdAt: msg.created_at,
      id: msg.id,
      metadata: msg.metadata ? JSON.parse(msg.metadata || '{}') : undefined,
    }
  }));
}
