# Semantic Primitives

AIDK provides a complete set of JSX components for building context. These primitives work with any renderer and are automatically formatted for each model.

## Why Semantic Primitives?

Instead of string templates:

```python
# ❌ String templates
prompt = f"""
## User Profile

Name: {user.name}
Tier: **{user.tier}**

1. Email: {user.email}
2. Member since: {user.createdAt}
"""
```

Use typed, composable components:

```tsx
// ✅ Semantic primitives
<Section audience="model">
  <H2>User Profile</H2>
  <Paragraph>
    Name: {user.name} | Tier: <strong>{user.tier}</strong>
  </Paragraph>
  <List ordered>
    <ListItem>Email: {user.email}</ListItem>
    <ListItem>Member since: {user.createdAt}</ListItem>
  </List>
</Section>
```

**Benefits:**

- ✅ Type-safe
- ✅ IDE autocomplete
- ✅ Refactorable
- ✅ Testable
- ✅ Works with any renderer
- ✅ No escaping issues

## Typography

### Headings

```tsx
<H1>Heading Level 1</H1>
<H2>Heading Level 2</H2>
<H3>Heading Level 3</H3>
<H4>Heading Level 4</H4>
<H5>Heading Level 5</H5>
<H6>Heading Level 6</H6>
```

**Markdown output:**

```markdown
# Heading Level 1

## Heading Level 2

### Heading Level 3
```

**XML output:**

```xml
<h1>Heading Level 1</h1>
<h2>Heading Level 2</h2>
<h3>Heading Level 3</h3>
```

### Paragraphs

```tsx
<Paragraph>
  This is a paragraph of text. It can contain inline formatting.
</Paragraph>

<Paragraph>
  Multiple paragraphs are separated by blank lines.
</Paragraph>
```

## Inline Formatting

### Bold / Strong

```tsx
<Paragraph>
  This text is <strong>bold and important</strong>.
</Paragraph>
```

### Italic / Emphasis

```tsx
<Paragraph>
  This text is <em>emphasized</em>.
</Paragraph>
```

### Inline Code

```tsx
<Paragraph>
  Use <inlineCode>console.log()</inlineCode> to debug.
</Paragraph>
```

### Highlight / Mark

```tsx
<Paragraph>
  This is <mark>highlighted text</mark>.
</Paragraph>
```

### Underline

```tsx
<Paragraph>
  This text is <u>underlined</u>.
</Paragraph>
```

### Strikethrough

```tsx
<Paragraph>
  This text is <s>crossed out</s> or <del>deleted</del>.
</Paragraph>
```

### Subscript & Superscript

```tsx
<Paragraph>
  H<sub>2</sub>O is water. E=mc<sup>2</sup> is Einstein's equation.
</Paragraph>
```

### Combined

```tsx
<Paragraph>
  Text with <strong>bold</strong>, <em>italic</em>,<inlineCode>code</inlineCode>
  , <mark>highlight</mark>, and{" "}
  <strong>
    <em>both bold and italic</em>
  </strong>
  .
</Paragraph>
```

## Lists

### Ordered Lists

```tsx
<List ordered>
  <ListItem>First item</ListItem>
  <ListItem>Second item</ListItem>
  <ListItem>Third item</ListItem>
</List>
```

**Markdown:**

```markdown
1. First item
2. Second item
3. Third item
```

**XML:**

```xml
<ol>
  <li>First item</li>
  <li>Second item</li>
  <li>Third item</li>
</ol>
```

### Unordered Lists

```tsx
<List>
  <ListItem>Bullet point</ListItem>
  <ListItem>Another point</ListItem>
  <ListItem>Third point</ListItem>
</List>
```

**Markdown:**

```markdown
- Bullet point
- Another point
- Third point
```

### Nested Lists

```tsx
<List>
  <ListItem>
    Parent item
    <List ordered>
      <ListItem>Nested item 1</ListItem>
      <ListItem>Nested item 2</ListItem>
    </List>
  </ListItem>
  <ListItem>Another parent item</ListItem>
</List>
```

### Task Lists

Task lists render as checkboxes for tracking completion:

```tsx
<List task>
  <ListItem checked>Completed task</ListItem>
  <ListItem checked={false}>Pending task</ListItem>
  <ListItem>Also pending (defaults to unchecked)</ListItem>
</List>
```

**Markdown (GFM):**

```markdown
- [x] Completed task
- [ ] Pending task
- [ ] Also pending (defaults to unchecked)
```

**Markdown (CommonMark):**

```markdown
- ✓ Completed task
- ○ Pending task
- ○ Also pending (defaults to unchecked)
```

**XML:**

```xml
<ul class="task-list">
  <li class="task-list-item"><input type="checkbox" checked disabled />Completed task</li>
  <li class="task-list-item"><input type="checkbox" disabled />Pending task</li>
  <li class="task-list-item"><input type="checkbox" disabled />Also pending (defaults to unchecked)</li>
</ul>
```

### Dynamic Task Lists

```tsx
const tasks = [
  { id: 1, title: "Setup project", done: true },
  { id: 2, title: "Write tests", done: false },
  { id: 3, title: "Deploy", done: false },
];

<List task>
  {tasks.map((task) => (
    <ListItem key={task.id} checked={task.done}>
      {task.title}
    </ListItem>
  ))}
</List>;
```

## Tables

### Simple Table

```tsx
<Table
  headers={["Name", "Age", "Role"]}
  rows={[
    ["Alice", "30", "Engineer"],
    ["Bob", "25", "Designer"],
    ["Carol", "28", "Manager"],
  ]}
/>
```

**Markdown:**

```markdown
| Name  | Age | Role     |
| ----- | --- | -------- |
| Alice | 30  | Engineer |
| Bob   | 25  | Designer |
| Carol | 28  | Manager  |
```

**XML:**

```xml
<table>
  <thead>
    <tr><th>Name</th><th>Age</th><th>Role</th></tr>
  </thead>
  <tbody>
    <tr><td>Alice</td><td>30</td><td>Engineer</td></tr>
    <tr><td>Bob</td><td>25</td><td>Designer</td></tr>
    <tr><td>Carol</td><td>28</td><td>Manager</td></tr>
  </tbody>
</table>
```

### Dynamic Table

```tsx
const users = [
  { name: "Alice", age: 30, role: "Engineer" },
  { name: "Bob", age: 25, role: "Designer" },
];

<Table
  headers={["Name", "Age", "Role"]}
  rows={users.map((u) => [u.name, String(u.age), u.role])}
/>;
```

### Table with Formatting

```tsx
<Table
  headers={["Metric", "Value", "Status"]}
  rows={[
    ["Revenue", "$1.2M", "<strong>Up</strong>"],
    ["Users", "10K", "<em>Stable</em>"],
    ["Churn", "2%", "<mark>Down</mark>"],
  ]}
/>
```

## Code Blocks

### With Language

```tsx
<Code language="typescript">
  {`function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet('World'));`}
</Code>
```

### Without Language

```tsx
<Code>
  {`Plain text code block
No syntax highlighting`}
</Code>
```

### JSON Block

```tsx
<Json>
  {{
    user: { name: "Alice", tier: "premium" },
    status: "active",
  }}
</Json>
```

## Quotes & Citations

### Blockquote

```tsx
<Blockquote>
  This is a quoted passage. It can span multiple lines and contain inline
  formatting like <strong>bold</strong>.
</Blockquote>
```

### Inline Quote

```tsx
<Paragraph>
  As the saying goes, <quote>Practice makes perfect</quote>.
</Paragraph>
```

### Citation

```tsx
<Paragraph>
  According to <cite>Smith et al. (2023)</cite>, context matters.
</Paragraph>
```

## Multimodal Content

### Images

```tsx
// Native content block (always preserved)
<Image
  source={{ type: 'url', url: 'https://example.com/photo.jpg' }}
  altText="A beautiful sunset"
/>

// Inline semantic image (rendered to markdown/xml)
<img src="https://example.com/icon.png" alt="Icon" />
```

### Audio

```tsx
<Audio source={{ type: "url", url: "https://example.com/audio.mp3" }} />
```

### Video

```tsx
<Video source={{ type: "url", url: "https://example.com/video.mp4" }} />
```

### Documents

```tsx
<Document
  source={{ type: "url", url: "https://example.com/doc.pdf" }}
  document_type="application/pdf"
/>
```

## Structural Elements

### Section

Container for related content:

```tsx
<Section id="user-profile" audience="model">
  <H2>User Profile</H2>
  <Paragraph>User information goes here.</Paragraph>
</Section>
```

**Audience options:**

- `"model"` - Only model sees it
- `"user"` - Only user sees it
- `"all"` - Both see it (default)

### Grounding

Additional context that appears after system messages:

```tsx
<Grounding position="after-system" audience="model">
  <H3>Additional Context</H3>
  <Paragraph>Background information for the model.</Paragraph>
</Grounding>
```

### Divider

Visual separator:

```tsx
<Divider />
```

**Markdown:** `---`  
**XML:** `<hr />`

## Composition Patterns

### Complex Sections

```tsx
<Section audience="model">
  <H2>Order Summary</H2>

  <Table
    headers={["Item", "Qty", "Price"]}
    rows={order.items.map((item) => [
      item.name,
      String(item.quantity),
      `$${item.price}`,
    ])}
  />

  <Paragraph>
    <strong>Total:</strong> ${order.total}
  </Paragraph>

  <List>
    <ListItem>
      Status: <mark>{order.status}</mark>
    </ListItem>
    <ListItem>Estimated delivery: {order.deliveryDate}</ListItem>
  </List>
</Section>
```

### Conditional Content

```tsx
<Section audience="model">
  <H2>User Context</H2>

  {user.isPremium && (
    <>
      <Paragraph>
        Premium user: <strong>{user.name}</strong>
      </Paragraph>
      <List>
        <ListItem>Priority support enabled</ListItem>
        <ListItem>Advanced features unlocked</ListItem>
      </List>
    </>
  )}

  {!user.isPremium && <Paragraph>Standard user: {user.name}</Paragraph>}
</Section>
```

### Nested Structures

```tsx
<Section audience="model">
  <H1>Project Status</H1>

  {projects.map((project) => (
    <Section key={project.id}>
      <H2>{project.name}</H2>
      <Paragraph>{project.description}</Paragraph>

      <H3>Tasks</H3>
      <List ordered>
        {project.tasks.map((task) => (
          <ListItem key={task.id}>
            {task.name}: <em>{task.status}</em>
          </ListItem>
        ))}
      </List>
    </Section>
  ))}
</Section>
```

## Renderer Switching

Switch renderers for specific content using `<Markdown>` and `<XML>` components:

```tsx
import { Markdown, XML } from "aidk";

<>
  {/* Default renderer (from model) */}
  <Section audience="model">
    <H2>Standard Content</H2>
  </Section>

  {/* Force Markdown */}
  <Markdown>
    <Section audience="model">
      <H2>Markdown-only Section</H2>
      <Code language="python">print("Hello")</Code>
    </Section>
  </Markdown>

  {/* Force XML */}
  <XML>
    <Section audience="model">
      <H2>XML-only Section</H2>
      <List>
        <ListItem>Item</ListItem>
      </List>
    </Section>
  </XML>
</>;
```

## Best Practices

### 1. Use Semantic Types

```tsx
// ✅ Good: Semantic meaning clear
<Paragraph>
  Price: <strong>$99.99</strong> (was <s>$149.99</s>)
</Paragraph>

// ❌ Less good: Meaning unclear
<Paragraph>
  Price: **$99.99** (was ~~$149.99~~)
</Paragraph>
```

### 2. Structure Content Logically

```tsx
// ✅ Good: Clear hierarchy
<Section audience="model">
  <H2>Main Topic</H2>
  <Paragraph>Overview...</Paragraph>

  <H3>Subtopic</H3>
  <List>
    <ListItem>Detail 1</ListItem>
    <ListItem>Detail 2</ListItem>
  </List>
</Section>
```

### 3. Use Tables for Structured Data

```tsx
// ✅ Good: Structured data in table
<Table
  headers={['Metric', 'Value']}
  rows={metrics.map(m => [m.name, m.value])}
/>

// ❌ Less good: Structured data as text
<Paragraph>
  Metric 1: {value1}
  Metric 2: {value2}
  ...
</Paragraph>
```

### 4. Combine Primitives

```tsx
// ✅ Good: Rich, formatted content
<Section audience="model">
  <H2>API Response</H2>
  <Paragraph>
    Status: <mark>Success</mark> | Time: <inlineCode>{duration}ms</inlineCode>
  </Paragraph>
  <Code language="json">{JSON.stringify(response, null, 2)}</Code>
</Section>
```

## Testing

Test your components with both renderers:

```tsx
import { MarkdownRenderer, XMLRenderer, Markdown, XML } from 'aidk';
import { render } from './test-utils';

describe('OrderSummary', () => {
  it('renders as Markdown', () => {
    const output = render(
      <Markdown>
        <OrderSummary order={testOrder} />
      </Markdown>
    );
    expect(output).toContain('## Order Summary');
    expect(output).toContain('| Item | Qty |');
  });

  it('renders as XML', () => {
    const output = render(
      <XML>
        <OrderSummary order={testOrder} />
      </XML>
    );
    expect(output).toContain('<h2>Order Summary</h2>');
    expect(output).toContain('<table>');
  });
});
```

## Related

- [Renderers Guide](/docs/guides/renderers) - Renderer system deep dive
- [Core Concepts](/docs/concepts) - Understanding components
- [Examples](/examples/) - See primitives in action

---

**Next:** [Creating Tools](/docs/guides/tools)
