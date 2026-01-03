# User Memory Example

Tools that remember things about users and present relevant context to the model.

## The Concept

A memory system that:

1. **Stores** facts/preferences about users during conversations
2. **Retrieves** relevant memories based on the current context
3. **Presents** memories to the model so it can personalize responses

This demonstrates tools that **render context**, not just execute actions.

---

## Simple Memory Tool

A tool that stores and retrieves user memories:

::: code-group

```tsx [memory-tool.tsx]
import { createTool, context, Grounding, List, ListItem } from 'aidk';
import { z } from 'zod';

interface Memory {
  id: string;
  content: string;
  category?: 'preference' | 'fact' | 'context';
}

// Simple in-memory store (use a real DB in production)
const memories = new Map<string, Memory[]>();

const MemoryInputSchema = z.object({
  action: z.enum(['remember', 'recall', 'list']),
  content: z.string().optional(),
  query: z.string().optional(),
  category: z.enum(['preference', 'fact', 'context']).optional(),
});

export const UserMemoryTool = createTool({
  name: 'user_memory',
  description: 'Remember and recall information about the user.',
  input: MemoryInputSchema,

  async onMount(com) {
    const userId = context().user?.id || 'anonymous';
    if (!memories.has(userId)) {
      memories.set(userId, []);
    }
    com.setState('userId', userId);
  },

  // Render relevant memories as context for the model
  render(com, state) {
    const userId = com.getState<string>('userId');
    const userMemories = memories.get(userId!) || [];
    if (userMemories.length === 0) return null;

    return (
      <Grounding title="Known About This User" position="before-user">
        <List>
          {userMemories.map(m => (
            <ListItem key={m.id}>
              [{m.category || 'general'}] {m.content}
            </ListItem>
          ))}
        </List>
      </Grounding>
    );
  },

  handler: async (input) => {
    const userId = context().user?.id || 'anonymous';
    const userMemories = memories.get(userId) || [];

    switch (input.action) {
      case 'remember':
        const memory = {
          id: crypto.randomUUID(),
          content: input.content!,
          category: input.category,
        };
        userMemories.push(memory);
        memories.set(userId, userMemories);
        return [{ type: 'text', text: `Remembered: "${memory.content}"` }];

      case 'recall':
        const matches = userMemories.filter(m =>
          m.content.toLowerCase().includes((input.query || '').toLowerCase())
        );
        return [{
          type: 'text',
          text: matches.length
            ? matches.map(m => `- ${m.content}`).join('\n')
            : 'No matching memories found'
        }];

      case 'list':
        return [{
          type: 'text',
          text: userMemories.length
            ? userMemories.map(m => `- [${m.category || 'general'}] ${m.content}`).join('\n')
            : 'No memories stored'
        }];
    }
  },
});
```

```tsx [agent-with-memory.tsx]
import { Component, System, Timeline } from 'aidk';
import { Model } from 'aidk-ai-sdk';
import { openai } from '@ai-sdk/openai';
import { UserMemoryTool } from './memory-tool';

class PersonalizedAgent extends Component {
  render() {
    return (
      <>
        <Model model={openai('gpt-5.2')} />

        <System>
          You are a helpful assistant with memory. When the user shares
          personal info, preferences, or context, use the user_memory tool
          to remember it. The memories are shown in your context automatically.
        </System>

        <UserMemoryTool />

        <Timeline>{this.props.timeline}</Timeline>
      </>
    );
  }
}
```

:::

---

## With Embeddings

For semantic similarity search in production:

```tsx
import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (magA * magB);
}

async function addMemory(content: string) {
  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: content,
  });
  return { id: crypto.randomUUID(), content, embedding };
}

async function findRelevant(query: string, memories: Memory[], limit = 5) {
  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: query,
  });

  return memories
    .map(m => ({ memory: m, score: cosineSimilarity(embedding, m.embedding!) }))
    .filter(({ score }) => score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ memory }) => memory);
}
```

---

## Auto-Extract Memories

Have the model automatically extract memorable facts using lifecycle hooks:

```tsx
import { Component, comState, System, Grounding, Timeline, isTextBlock, isUserMessage } from 'aidk';

class AutoMemoryAgent extends Component {
  private shouldExtract = comState('shouldExtract', false);

  onTickEnd(com, state) {
    const lastUser = state.current?.timeline
      ?.filter(e => isUserMessage(e.message))
      .at(-1);

    const text = lastUser?.message?.content
      ?.filter(isTextBlock)
      .map(b => b.text)
      .join(' ') || '';

    // Trigger extraction when user shares personal info
    if (text.match(/\bI('m| am| have| like| prefer)\b/i)) {
      this.shouldExtract.set(true);
    }
  }

  render() {
    return (
      <>
        <Model model={openai('gpt-5.2')} />

        <System>
          You are a helpful assistant with memory. When the user shares
          personal info, quietly remember it. Don't announce that you're
          remembering - just do it naturally.
        </System>

        <UserMemoryTool />

        {this.shouldExtract() && (
          <Grounding title="Memory Hint">
            The user just shared something personal. Consider using
            user_memory to remember relevant facts or preferences.
          </Grounding>
        )}

        <Timeline>{this.props.timeline}</Timeline>
      </>
    );
  }
}
```

---

## Key Patterns

1. **Tools that render context** - The `render()` method injects memories into the model's context automatically

2. **Lifecycle hooks** - `onMount` initializes state, `onTickEnd` triggers extraction logic

3. **State management** - `com.setState/getState` for tool state, `comState` for reactive component state

4. **Context access** - `context()` provides user info and execution metadata

5. **Grounding** - Ephemeral content that provides context without being persisted to the timeline

---

## Next Steps

- [Voting Consensus](/examples/voting-consensus) - Multi-agent coordination
- [Tools Guide](/docs/guides/tools) - Deep dive into tool patterns
- [State Management](/docs/state-management) - Signals and reactive state
