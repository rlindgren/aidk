# Renderers

AIDK's renderer system transforms your semantic JSX components into the format each AI model prefers—automatically.

## The Problem

Different AI models perform better with different context formats:

- **Claude** works best with XML: `<section><title>...</title></section>`
- **GPT models** prefer Markdown: `# Title\n\nContent...`
- **Custom models** might need JSON or plain text

Writing separate agents for each model is tedious and error-prone.

## The Solution

AIDK's renderers automatically format your context based on which model is running. Write once, render everywhere.

```tsx
// You write this ONCE
class MyAgent extends Component {
  render() {
    return (
      <Section audience="model">
        <H1>User Profile</H1>
        <Paragraph>
          Name: {user.name} | Tier: <strong>{user.tier}</strong>
        </Paragraph>
        <List ordered>
          <ListItem>Email: {user.email}</ListItem>
          <ListItem>Member since: {user.createdAt}</ListItem>
        </List>
      </Section>
    );
  }
}

// AIDK renders it as XML for Claude:
// <section>
//   <h1>User Profile</h1>
//   <p>Name: John Doe | Tier: <strong>premium</strong></p>
//   <ol>
//     <li>Email: john@example.com</li>
//     <li>Member since: 2024-01-15</li>
//   </ol>
// </section>

// Or as Markdown for GPT:
// # User Profile
//
// Name: John Doe | Tier: **premium**
//
// 1. Email: john@example.com
// 2. Member since: 2024-01-15
```

## Built-in Renderers

### Markdown Renderer

Default for most models. Formats content as Markdown.

```tsx
import { Markdown } from 'aidk';

// Used automatically for GPT models
<AiSdkModel
  model={openai('gpt-4o')}
  // preferredRenderer: 'markdown' (automatic)
/>

// Or explicitly with the <Markdown> component
<Markdown>
  <H1>Title</H1>
  <Paragraph>Content with <strong>bold</strong> and <em>italic</em></Paragraph>
</Markdown>
```

**Output:**

```markdown
# Title

Content with **bold** and *italic*
```

### XML Renderer

Preferred by Claude and other Anthropic models.

```tsx
import { XML } from 'aidk';

// Used automatically for Claude
<AiSdkModel
  model={anthropic('claude-3-5-sonnet-20241022')}
  // preferredRenderer: 'xml' (automatic)
/>

// Or explicitly with the <XML> component
<XML>
  <H1>Title</H1>
  <Paragraph>Content with <strong>bold</strong> and <em>italic</em></Paragraph>
</XML>
```

**Output:**

```xml
<h1>Title</h1>
<p>Content with <strong>bold</strong> and <em>italic</em></p>
```

## Automatic Renderer Selection

**This is the killer feature.** AIDK automatically selects the best renderer for each model.

### How It Works

1. Each model adapter broadcasts its preferred renderer
2. AIDK sets this as the default for that tick
3. Your components render using the optimal format
4. No code changes needed when switching models

```tsx
class AdaptiveAgent extends Component {
  render(com, state) {
    // Check response quality
    const quality = analyzeResponse(state.current);

    return (
      <>
        {/* Switch models based on need */}
        {quality === 'needs_power' ? (
          <AiSdkModel model={anthropic('claude-3-5-sonnet-20241022')} />
          // Renderer automatically switches to XML
        ) : (
          <AiSdkModel model={openai('gpt-4o-mini')} />
          // Renderer automatically uses Markdown
        )}

        {/* Same JSX, different output format per model */}
        <Section audience="model">
          <H2>Analysis</H2>
          <List ordered>
            <ListItem>Item 1</ListItem>
            <ListItem>Item 2</ListItem>
          </List>
        </Section>
      </>
    );
  }
}
```

**On Claude tick:**

```xml
<section>
  <h2>Analysis</h2>
  <ol><li>Item 1</li><li>Item 2</li></ol>
</section>
```

**On GPT tick:**

```markdown
## Analysis

1. Item 1
2. Item 2
```

### Model Preferences

AIDK includes built-in preferences for popular models:

```tsx
// From model adapter capabilities
const modelPreferences = {
  // Anthropic models prefer XML
  'claude-3-5-sonnet-20241022': 'xml',
  'claude-3-opus-20240229': 'xml',
  'claude-3-sonnet-20240229': 'xml',

  // OpenAI models prefer Markdown
  'gpt-4o': 'markdown',
  'gpt-4o-mini': 'markdown',
  'gpt-4-turbo': 'markdown',

  // Google models prefer Markdown
  'gemini-2.0-flash': 'markdown',
  'gemini-1.5-pro': 'markdown',
};
```

You can also configure this dynamically:

```tsx
import { createAiSdkModel } from '@aidk/ai-sdk';

const model = createAiSdkModel({
  model: customProvider('custom-model'),
  capabilities: {
    messageTransformation: (modelId, provider) => ({
      preferredRenderer: modelId.includes('claude') ? 'xml' : 'markdown',
      // ... other config
    }),
  },
});
```

## Manual Control

You always have full control over renderers.

### Via Model Configuration

Set the preferred renderer for a model:

```tsx
<AiSdkModel
  model={openai('gpt-4o')}
  preferredRenderer="xml"  // Override the default
/>
```

Or dynamically based on model:

```tsx
<AiSdkModel
  model={model}
  messageTransformation={{
    preferredRenderer: modelId.includes('claude') ? 'xml' : 'markdown',
  }}
/>
```

### Per-Section

Override the renderer for specific sections:

```tsx
import { Markdown, XML } from 'aidk';

<>
  {/* Use model's preferred renderer (automatic) */}
  <Section audience="model">
    <H2>Standard Content</H2>
  </Section>

  {/* Force Markdown for this section */}
  <Markdown>
    <Section audience="model">
      <H2>Markdown-only Content</H2>
      <Code language="python">print("Hello")</Code>
    </Section>
  </Markdown>

  {/* Force XML for this section */}
  <XML>
    <Section audience="model">
      <H2>XML-only Content</H2>
      <List><ListItem>Item</ListItem></List>
    </Section>
  </XML>
</>
```

### Nested Renderers

Switch renderers within a section:

```tsx
<Markdown>
  <H1>Outer Content (Markdown)</H1>

  <XML>
    <H2>Inner Content (XML)</H2>
    <Paragraph>This part uses XML</Paragraph>
  </XML>

  <Paragraph>Back to Markdown</Paragraph>
</Markdown>
```

### Inline Renderer Switching

You can even switch renderers **inline within content**:

```tsx
<Message role="assistant">
  <Text>
    This text uses <strong>default renderer</strong> for bold.
    <XML>
      But this part uses <strong>XML tags</strong> for formatting.
      <Markdown>
        And this nested part uses <em>Markdown</em> inside XML.
      </Markdown>
    </XML>
  </Text>
</Message>
```

**Output with Markdown as default:**

```
This text uses **default renderer** for bold. But this part uses <strong>XML tags</strong> for formatting. And this nested part uses *Markdown* inside XML.
```

This allows for extremely fine-grained control when you need mixed formatting within a single message.

## Semantic Primitives

All JSX primitives work with any renderer:

### Typography

```tsx
<H1>Heading 1</H1>
<H2>Heading 2</H2>
<H3>Heading 3</H3>
<Paragraph>Paragraph text</Paragraph>
```

### Inline Formatting

```tsx
<Paragraph>
  Text with <strong>bold</strong>, <em>italic</em>,
  <inlineCode>code</inlineCode>, <mark>highlight</mark>,
  <u>underline</u>, and <s>strikethrough</s>.
</Paragraph>
```

### Lists

```tsx
<List ordered>
  <ListItem>First item</ListItem>
  <ListItem>Second item</ListItem>
  <ListItem>Third item</ListItem>
</List>

<List>
  <ListItem>Unordered item</ListItem>
  <ListItem>Another item</ListItem>
</List>
```

### Tables

```tsx
<Table
  headers={['Name', 'Age', 'Role']}
  rows={[
    ['Alice', '30', 'Engineer'],
    ['Bob', '25', 'Designer'],
  ]}
/>
```

### Code Blocks

```tsx
<Code language="typescript">
  {`const greeting = "Hello, world!";
console.log(greeting);`}
</Code>
```

## Custom Renderers

Create your own renderer for custom formats:

```tsx
import { Renderer, SemanticContentBlock, SemanticNode } from 'aidk';

class JSONRenderer extends Renderer {
  formatNode(node: SemanticNode): string {
    // Custom formatting logic
    if (node.semantic === 'strong') {
      return `{"bold": "${node.children?.[0]?.text}"}`;
    }
    // ... more formatting
    return node.text || '';
  }

  formatSemantic(block: SemanticContentBlock): ContentBlock | null {
    // Handle semantic blocks
    if (block.semantic?.type === 'heading') {
      return {
        type: 'text',
        text: JSON.stringify({
          heading: extractText([block]),
          level: block.semantic.level
        }),
      };
    }
    return null;
  }

  formatStandard(block: SemanticContentBlock): ContentBlock[] {
    // Handle standard blocks
    return [block];
  }

  protected applyBlockLevelFormatting(
    block: SemanticContentBlock,
    formattedText: string
  ): string {
    return formattedText;
  }
}

// Use it
<Renderer renderer={new JSONRenderer()}>
  <H1>Title</H1>
</Renderer>
// Output: {"heading": "Title", "level": 1}
```

## Performance

Renderers are **zero-cost abstractions**:

- Rendering happens at compile time (before model call)
- No runtime overhead
- Efficient string building
- Results are cached per tick

## Best Practices

### 1. Let AIDK Choose (Default Behavior)

Trust the automatic renderer selection for most content:

```tsx
// ✅ Good: Let model choose its preferred format
<AiSdkModel model={model} />
<Section audience="model">
  <H2>Standard Content</H2>
  <Paragraph>This will use the model's preferred renderer.</Paragraph>
</Section>

// ❌ Less good: Force a renderer without reason
<Markdown>
  <AiSdkModel model={model} />
  <Section audience="model">
    <H2>Content</H2>
  </Section>
</Markdown>
```

**Why?** Models specify their preferences for a reason. Claude models parse XML more effectively. GPT models work better with Markdown. Let them choose.

### 2. Override for Specific Content Types

Use explicit renderers when content type demands it:

```tsx
// ✅ Good: Override for code-heavy content
<Markdown>
  <Section audience="model">
    <H2>Code Review</H2>
    <Code language="typescript">{code}</Code>
    <Paragraph>Analysis: The function uses <inlineCode>async/await</inlineCode>.</Paragraph>
  </Section>
</Markdown>

// ✅ Good: Override for structured data
<XML>
  <Section audience="model">
    <H2>Configuration Schema</H2>
    <Table headers={headers} rows={rows} />
  </Section>
</XML>
```

### 3. Use Inline Switching Sparingly

Inline renderer switching is powerful but can be complex:

```tsx
// ✅ Good: Use when truly needed
<Message role="assistant">
  <Text>
    Regular text here.
    <XML>Structured data: <tag>value</tag></XML>
    More regular text.
  </Text>
</Message>

// ⚠️ Caution: Don't overuse
<Text>
  This <XML>is</XML> <Markdown>too</Markdown> <XML>fragmented</XML>.
</Text>
```

**When to use inline switching:**

- Embedding structured data in natural text
- Code snippets in XML contexts
- Specific formatting requirements mid-content

### 4. Test Both Formats

When building reusable components, test with both renderers:

```tsx
import { MarkdownRenderer, XMLRenderer } from 'aidk';

describe('UserProfile component', () => {
  it('renders correctly as Markdown', () => {
    const rendered = render(<UserProfile />, new MarkdownRenderer());
    expect(rendered).toContain('# User Profile');
    expect(rendered).toContain('**Name:**');
  });

  it('renders correctly as XML', () => {
    const rendered = render(<UserProfile />, new XMLRenderer());
    expect(rendered).toContain('<h1>User Profile</h1>');
    expect(rendered).toContain('<strong>Name:</strong>');
  });

  it('produces semantically equivalent output', () => {
    const markdown = render(<UserProfile />, new MarkdownRenderer());
    const xml = render(<UserProfile />, new XMLRenderer());

    // Both should contain the same data
    expect(extractText(markdown)).toEqual(extractText(xml));
  });
});
```

### 5. Document Renderer Behavior

If your component has renderer requirements or preferences:

```tsx
/**
 * UserAnalytics component.
 *
 * Displays user analytics in table format.
 *
 * **Renderer Notes:**
 * - Works with any renderer (Markdown/XML)
 * - Complex tables may be more readable in Markdown
 * - For XML-preferring models, consider wrapping in <Markdown>
 *
 * @example
 * // Auto-detect
 * <UserAnalytics data={data} />
 *
 * @example
 * // Force Markdown for better table formatting
 * <Markdown>
 *   <UserAnalytics data={data} />
 * </Markdown>
 */
class UserAnalytics extends Component {
  // ...
}
```

### 6. Profile Renderer Performance

Different renderers may have different characteristics:

```tsx
// For large contexts, measure which renderer is more efficient
class OptimizedAgent extends Component {
  render(com, state) {
    const contextSize = estimateSize(state);

    // XML is often more compact for highly structured data
    const useXML = contextSize > 100000 && isHighlyStructured(state);

    return (
      <>
        <AiSdkModel model={model} />

        {useXML ? (
          <XML>
            <Section audience="model">
              {structuredContent}
            </Section>
          </XML>
        ) : (
          <Section audience="model">
            {structuredContent}
          </Section>
        )}
      </>
    );
  }
}
```

### 7. Consistency Within Messages

Keep renderer choice consistent within a message:

```tsx
// ✅ Good: Consistent renderer per message
<Message role="user">
  <Text>
    <H2>Request</H2>
    <List ordered>
      <ListItem>Item 1</ListItem>
      <ListItem>Item 2</ListItem>
    </List>
  </Text>
</Message>

// ⚠️ Avoid: Switching mid-message without reason
<Message role="user">
  <Text>
    <H2>Request</H2>
    <XML>
      <List><ListItem>XML Item</ListItem></List>
    </XML>
    <Markdown>
      <List><ListItem>Markdown Item</ListItem></List>
    </Markdown>
  </Text>
</Message>
```

**Exception:** Inline switching for embedded structured data is fine.

## Advanced Use Cases

### Dynamic Renderer Selection

Select renderers based on runtime conditions:

```tsx
class SmartAgent extends Component {
  render(com, state) {
    const ctx = context();

    // Choose renderer based on context size
    const useXML = ctx.metadata.contextSize > 50000;

    // Option 1: Conditional rendering with sugar components
    const content = (
      <Section audience="model">
        {/* Content automatically formatted */}
      </Section>
    );

    return (
      <>
        <AiSdkModel model={model} />
        {useXML ? <XML>{content}</XML> : <Markdown>{content}</Markdown>}
      </>
    );
  }
}
```

### Mixed Content Rendering

Combine multiple renderers for specialized content:

```tsx
class MixedFormatAgent extends Component {
  render(com, state) {
    return (
      <>
        <AiSdkModel model={model} />

        <Section audience="model">
          {/* Standard Markdown formatting */}
          <H2>Analysis Results</H2>
          <Paragraph>Here are the findings:</Paragraph>

          {/* Force XML for structured data */}
          <XML>
            <List ordered>
              <ListItem>
                <strong>Finding 1:</strong>
                {/* Nested Markdown for code samples */}
                <Markdown>
                  See <inlineCode>example.ts</inlineCode> for details.
                </Markdown>
              </ListItem>
              <ListItem>
                <strong>Finding 2:</strong> Data shows improvement.
              </ListItem>
            </List>
          </XML>

          {/* Back to standard rendering */}
          <Paragraph>
            Summary: <strong>Success</strong>
          </Paragraph>
        </Section>
      </>
    );
  }
}
```

**Why mix renderers?**

- XML for structured lists/tables that models parse better
- Markdown for code snippets and natural text
- Fine-tuned control for complex context

### Content-Type-Based Rendering

Different content types can use different renderers:

```tsx
class ContentAwareAgent extends Component {
  render(com, state) {
    return (
      <>
        {/* Technical content - use Markdown for code */}
        <Markdown>
          <Section audience="model">
            <H3>Code Review</H3>
            <Code language="typescript">{codeSnippet}</Code>
          </Section>
        </Markdown>

        {/* Structured data - use XML for clarity */}
        <XML>
          <Section audience="model">
            <H3>Configuration</H3>
            <Table headers={headers} rows={configRows} />
          </Section>
        </XML>

        {/* Let model preference decide for general content */}
        <Section audience="model">
          <H3>Instructions</H3>
          <Paragraph>Follow the steps above.</Paragraph>
        </Section>
      </>
    );
  }
}
```

## Renderer API Reference

### `Renderer` (Base Class)

```tsx
abstract class Renderer {
  abstract formatNode(node: SemanticNode): string;
  abstract formatSemantic(block: SemanticContentBlock): ContentBlock | null;
  abstract formatStandard(block: SemanticContentBlock): ContentBlock[];
  protected abstract applyBlockLevelFormatting(
    block: SemanticContentBlock,
    formattedText: string
  ): string;

  format(blocks: SemanticContentBlock[]): ContentBlock[];
  getCustomPrimitives?(): string[];
}
```

### `MarkdownRenderer`

```tsx
class MarkdownRenderer extends Renderer {
  constructor(flavor?: 'github' | 'commonmark' | 'gfm');
}
```

### `XMLRenderer`

```tsx
class XMLRenderer extends Renderer {
  constructor(rootTag?: string);
}
```

### Components

```tsx
// Sugar components (preferred)
<Markdown>{children}</Markdown>
<XML>{children}</XML>

// Low-level Renderer component (for custom renderers)
<Renderer renderer={new MarkdownRenderer()}>
  {children}
</Renderer>

// Set preferred renderer via model
<AiSdkModel model={model} preferredRenderer="xml" />
```

## Related

- [Semantic Primitives](/docs/semantic-primitives) - All available JSX components
- [Model Adapters](/docs/adapters/ai-sdk) - Model configuration
- [Context Engineering](/docs/concepts#context-engineering) - Building effective context

---

**Next:** [MCP Integration](/docs/guides/mcp)
