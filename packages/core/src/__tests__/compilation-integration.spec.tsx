/**
 * Comprehensive integration tests for the JSX → Compilation → Rendering pipeline.
 * 
 * Tests the full stack:
 * 1. JSX elements
 * 2. FiberCompiler (reconciliation, fiber tree, structure collection)
 * 3. StructureRenderer (application to COM, formatting)
 * 4. Final output (ContentBlocks ready for model)
 * 
 * Uses CompileJSXService for isolated testing without full Engine.
 */

import { Message, Section, Text, Image, Audio, Code, Markdown, XML, UserAction, Event } from '../jsx/components';
import { H1, H2, H3, Paragraph } from '../jsx/components/semantic';
import { CompileJSXService } from '../utils/compile-jsx-service';
import { MarkdownRenderer, XMLRenderer } from '../renderers';
import type { EventMessage, UserActionBlock } from '../content';

describe('Compilation Integration Tests', () => {
  // Helper function to compile and return result in same format as old compileJSX
  async function compileJSX(jsx: any, options?: { renderer?: MarkdownRenderer | XMLRenderer }) {
    const service = new CompileJSXService({
      defaultRenderer: options?.renderer || new MarkdownRenderer(),
    });
    const result = await service.compile(jsx);
    // Return in same format as old compileJSX for compatibility
    return {
      ...result.formatted, // Includes timeline, sections, system, etc.
      com: result.com,
      compiled: result.compiled,
    };
  }
  
  describe('System Message Consolidation', () => {
    it('should consolidate multiple sections into single system message', async () => {
      const jsx = (
        <>
          <Section id="instructions" title="Instructions">
            <XML>
              <p>You are a helpful assistant</p>
            </XML>
          </Section>
          <Section id="context" title="Context">
            <Paragraph>Current time 10:00 AM</Paragraph>
          </Section>
        </>
      );

      const result = await compileJSX(jsx);
      
      // Should have single system message
      expect(result.system).toHaveLength(1);
      
      const systemContent = result.system[0].message.content[0];
      expect(systemContent.type).toBe('text');
      expect((systemContent as any).text).toContain('## Instructions');
      expect((systemContent as any).text).toContain('<p>You are a helpful assistant</p>');
      expect((systemContent as any).text).toContain('## Context');
      expect((systemContent as any).text).toContain('Current time 10:00 AM');
    });

    it('should preserve section order in system message', async () => {
      const jsx = (
        <>
          <Section id="first" title="First">
            <Text>A</Text>
          </Section>
          <Section id="second" title="Second">
            <Text>B</Text>
          </Section>
          <Section id="third" title="Third">
            <Text>C</Text>
          </Section>
        </>
      );

      const result = await compileJSX(jsx);
      const systemText = (result.system[0].message.content[0] as any).text;
      
      const firstIndex = systemText.indexOf('## First');
      const secondIndex = systemText.indexOf('## Second');
      const thirdIndex = systemText.indexOf('## Third');
      
      expect(firstIndex).toBeLessThan(secondIndex);
      expect(secondIndex).toBeLessThan(thirdIndex);
    });

    it('should handle free-floating JSX as system content', async () => {
      const jsx = (
        <>
          <Text>This is loose content</Text>
          <Message role="user">
            <Text>Hello</Text>
          </Message>
        </>
      );

      const result = await compileJSX(jsx);
      
      // Free-floating Text becomes system message
      expect(result.system[0].message.role).toBe('system');
      expect((result.system[0].message.content[0] as any).text).toBe('This is loose content');
      
      // User message is separate
      expect(result.timeline[0].message.role).toBe('user');
      expect((result.timeline[0].message.content[0] as any).text).toBe('Hello');
    });
  });

  describe('Text Wrapping', () => {
    it('should wrap unwrapped strings in sections as TextBlocks', async () => {
      const jsx = (
        <Section id="test" title="Test">
          Unwrapped string content
        </Section>
      );

      const result = await compileJSX(jsx);
      
      // Check section content in formatted output
      expect(result.sections['test'].content).toBeDefined();
      const content = result.sections['test'].content as any[];
      expect(Array.isArray(content)).toBe(true);
      expect(content[0].type).toBe('text');
      expect((content[0] as any).text).toBe('Unwrapped string content');
    });

    it('should wrap unwrapped strings in messages as TextBlocks', async () => {
      const jsx = (
        <Message role="user">
          Plain string message
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline[0].message.content[0].type).toBe('text');
      expect((result.timeline[0].message.content[0] as any).text).toBe('Plain string message');
    });

    it('should handle mixed wrapped and unwrapped content', async () => {
      const jsx = (
        <Message role="user">
          Start text
          <Text>Middle <strong>formatted</strong> text</Text>
          End text
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline[0].message.content).toHaveLength(3);
      expect((result.timeline[0].message.content[0] as any).text).toBe('Start text');
      expect((result.timeline[0].message.content[1] as any).text).toBe('Middle **formatted** text');
      expect((result.timeline[0].message.content[2] as any).text).toBe('End text');
    });
  });

  describe('Content Blocks from JSX', () => {
    it('should create native ImageBlock from <Image> component', async () => {
      const jsx = (
        <Message role="user">
          <Image 
            source={{ type: 'url', url: 'https://example.com/photo.jpg' }}
            altText="A photo"
            mimeType="image/jpeg"
          />
        </Message>
      );

      const result = await compileJSX(jsx);
      const content = result.timeline[0].message.content[0];
      
      expect(content.type).toBe('image');
      expect((content as any).source.url).toBe('https://example.com/photo.jpg');
      expect((content as any).altText).toBe('A photo');
      expect((content as any).mimeType).toBe('image/jpeg');
    });

    it('should create native AudioBlock from <Audio> component', async () => {
      const jsx = (
        <Message role="user">
          <Audio 
            source={{ type: 'url', url: 'https://example.com/sound.mp3' }}
            transcript="Hello world"
          />
        </Message>
      );

      const result = await compileJSX(jsx);
      const content = result.timeline[0].message.content[0];
      
      expect(content.type).toBe('audio');
      expect((content as any).source.url).toBe('https://example.com/sound.mp3');
      expect((content as any).transcript).toBe('Hello world');
    });

    it('should handle mixed content blocks (JSX + native)', async () => {
      const nativeBlock = { type: 'text' as const, text: 'Native block' };
      
      const jsx = (
        <Message role="user">
          <Text>JSX block</Text>
          {nativeBlock}
          <Text>Another JSX block</Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline[0].message.content).toHaveLength(3);
      expect((result.timeline[0].message.content[0] as any).text).toBe('JSX block');
      expect((result.timeline[0].message.content[1] as any).text).toBe('Native block');
      expect((result.timeline[0].message.content[2] as any).text).toBe('Another JSX block');
    });
  });

  describe('Semantic Component Rendering', () => {
    it('should render all inline text formatting', async () => {
      const jsx = (
        <Message role="user">
          <Text>
            <strong>bold</strong> <b>also bold</b>{' '}
            <em>italic</em> <i>also italic</i>{' '}
            <code>code</code>{' '}
            <mark>marked</mark>{' '}
            <u>underlined</u>{' '}
            <s>strikethrough</s>{' '}
            <sub>subscript</sub>{' '}
            <sup>superscript</sup>{' '}
            <small>small</small>
          </Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      const text = (result.timeline[0].message.content[0] as any).text;
      
      expect(text).toContain('**bold**');
      expect(text).toContain('**also bold**');
      expect(text).toContain('*italic*');
      expect(text).toContain('*also italic*');
      expect(text).toContain('`code`');
      expect(text).toContain('==marked==');
      expect(text).toContain('<u>underlined</u>');
      expect(text).toContain('~~strikethrough~~');
      expect(text).toContain('<sub>subscript</sub>');
      expect(text).toContain('<sup>superscript</sup>');
      expect(text).toContain('<small>small</small>');
    });

    it('should render headings with formatting', async () => {
      const jsx = (
        <>
          <Message role="user">
            <H1>Title with <strong>bold</strong></H1>
            <H2>Subtitle with <em>italic</em></H2>
            <H3>Section with <code>code</code></H3>
          </Message>
        </>
      );

      const result = await compileJSX(jsx);
      
      expect((result.timeline[0].message.content[0] as any).text).toBe('# Title with **bold**');
      expect((result.timeline[0].message.content[1] as any).text).toBe('## Subtitle with *italic*');
      expect((result.timeline[0].message.content[2] as any).text).toBe('### Section with `code`');
    });

    it('should render semantic HTML elements', async () => {
      const jsx = (
        <Message role="user">
          <Text>
            Link: <a href="https://example.com">Click here</a>{' '}
            Quote: <q>quoted text</q>{' '}
            Citation: <cite>Reference</cite>{' '}
            Keyboard: <kbd>Ctrl+C</kbd>{' '}
            Variable: <var>x</var>
          </Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      const text = (result.timeline[0].message.content[0] as any).text;
      
      expect(text).toContain('[Click here](https://example.com)');
      expect(text).toContain('"quoted text"');
      expect(text).toContain('*Reference*');
      expect(text).toContain('`Ctrl+C`');
      expect(text).toContain('*x*');
    });

    it('should render block elements with nested formatting', async () => {
      const jsx = (
        <Message role="user">
          <p>Paragraph with <strong>bold</strong> and <em>italic</em></p>
          <blockquote>Quote with <code>code</code></blockquote>
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect((result.timeline[0].message.content[0] as any).text)
        .toBe('Paragraph with **bold** and *italic*');
      expect((result.timeline[0].message.content[1] as any).text)
        .toContain('Quote with `code`');
    });

    it('should render inline media elements (img, audio, video)', async () => {
      const jsx = (
        <Message role="user">
          <Text>
            See this: <img src="photo.jpg" alt="Photo" />{' '}
            Listen: <audio src="sound.mp3" />{' '}
            Watch: <video src="video.mp4" />
          </Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      const text = (result.timeline[0].message.content[0] as any).text;
      
      expect(text).toContain('![Photo](photo.jpg)');
      expect(text).toContain('[Audio: sound.mp3]');
      expect(text).toContain('[Video: video.mp4]');
    });
  });

  describe('Structural vs Semantic Media', () => {
    it('should pass through structural <Image> as ImageBlock', async () => {
      const jsx = (
        <Message role="user">
          <Text>Here is an image:</Text>
          <Image source={{ type: 'url', url: 'photo.jpg' }} altText="Photo" />
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline[0].message.content).toHaveLength(2);
      expect(result.timeline[0].message.content[0].type).toBe('text');
      expect(result.timeline[0].message.content[1].type).toBe('image');
      expect((result.timeline[0].message.content[1] as any).altText).toBe('Photo');
    });

    it('should convert semantic <img> to inline markdown', async () => {
      const jsx = (
        <Message role="user">
          <Text>Inline image: <img src="photo.jpg" alt="Photo" /></Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline[0].message.content).toHaveLength(1);
      expect(result.timeline[0].message.content[0].type).toBe('text');
      expect((result.timeline[0].message.content[0] as any).text)
        .toBe('Inline image: ![Photo](photo.jpg)');
    });
  });

  describe('Renderer Component Behavior', () => {
    it('should use default MarkdownRenderer by default', async () => {
      const jsx = (
        <Message role="user">
          <Text>Hello <strong>world</strong></Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect((result.timeline[0].message.content[0] as any).text)
        .toBe('Hello **world**');
    });

    it('should render with XMLRenderer when specified', async () => {
      const jsx = (
        <Message role="user">
          <Text>Hello <strong>world</strong></Text>
        </Message>
      );

      const result = await compileJSX(jsx, { renderer: new XMLRenderer() });
      
      expect((result.timeline[0].message.content[0] as any).text)
        .toBe('Hello <strong>world</strong>');
    });

    it('should apply <Markdown> renderer wrapper', async () => {
      const jsx = (
        <Markdown>
          <Message role="user">
            <Text>Hello <strong>world</strong></Text>
          </Message>
        </Markdown>
      );

      const result = await compileJSX(jsx);
      
      expect((result.timeline[0].message.content[0] as any).text)
        .toBe('Hello **world**');
    });

    it('should apply <XML> renderer wrapper', async () => {
      const jsx = (
        <XML>
          <Message role="user">
            <Text>Hello <strong>world</strong></Text>
          </Message>
        </XML>
      );

      const result = await compileJSX(jsx, { renderer: new MarkdownRenderer() });
      
      // XML wrapper should override default renderer
      expect((result.timeline[0].message.content[0] as any).text)
        .toBe('Hello <strong>world</strong>');
    });

    it('should handle mixed renderers (XML inside Markdown)', async () => {
      const jsx = (
        <Markdown>
          <Message role="user">
            <Text>Markdown: <strong>bold</strong></Text>
          </Message>
          <XML>
            <Message role="assistant">
              <Text>XML: <strong>bold</strong></Text>
            </Message>
          </XML>
        </Markdown>
      );

      const result = await compileJSX(jsx);
      
      // First message uses Markdown
      expect((result.timeline[0].message.content[0] as any).text)
        .toBe('Markdown: **bold**');
      
      // Second message uses XML (overrides parent Markdown)
      expect((result.timeline[1].message.content[0] as any).text)
        .toBe('XML: <strong>bold</strong>');
    });

    it('should support nested renderer switches', async () => {
      const jsx = (
        <XML>
          <Section id="xml-section">
            <Text>XML content: <em>italic</em></Text>
          </Section>
          <Markdown>
            <Section id="md-section">
              <Text>Markdown content: <em>italic</em></Text>
            </Section>
          </Markdown>
        </XML>
      );

      const result = await compileJSX(jsx);
      
      // XML section
      expect((result.sections['xml-section'].content as any[])[0].text)
        .toBe('XML content: <em>italic</em>');
      
      // Markdown section (nested override)
      expect((result.sections['md-section'].content as any[])[0].text)
        .toBe('Markdown content: *italic*');
    });
  });

  describe('Custom XML Tags', () => {
    it('should handle unknown custom tags', async () => {
      const jsx = (
        <Message role="user">
          <Text>
            Regular text with <customTag>custom content</customTag>
          </Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      
      // Custom tag content should be preserved (pass through in markdown)
      const text = (result.timeline[0].message.content[0] as any).text;
      expect(text).toContain('custom content');
    });

    it('should preserve formatting inside custom tags', async () => {
      const jsx = (
        <Message role="user">
          <Text>
            <equation>x = <sup>2</sup></equation>
          </Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      const text = (result.timeline[0].message.content[0] as any).text;
      
      // Should preserve the <sup> formatting inside custom tag
      expect(text).toContain('x = ');
      expect(text).toContain('<sup>2</sup>');
    });

    it('should render custom tags as XML elements in XMLRenderer', async () => {
      const jsx = (
        <Message role="user">
          <Text>
            <metric value="42">Performance</metric>
          </Text>
        </Message>
      );

      const result = await compileJSX(jsx, { renderer: new XMLRenderer() });
      const text = (result.timeline[0].message.content[0] as any).text;
      
      // XMLRenderer should preserve custom tags
      expect(text).toContain('<metric');
      expect(text).toContain('Performance');
      expect(text).toContain('</metric>');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty content', async () => {
      const jsx = (
        <Message role="user">
          <Text></Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline[0].message.content).toHaveLength(1);
      expect((result.timeline[0].message.content[0] as any).text).toBe('');
    });

    it('should handle fragments', async () => {
      const jsx = (
        <Message role="user">
          <>
            <Text>First</Text>
            <Text>Second</Text>
          </>
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline[0].message.content).toHaveLength(2);
      expect((result.timeline[0].message.content[0] as any).text).toBe('First');
      expect((result.timeline[0].message.content[1] as any).text).toBe('Second');
    });

    it('should flatten nested arrays', async () => {
      const jsx = (
        <Message role="user">
          {[
            <Text key="a">A</Text>,
            [<Text key="b">B</Text>, <Text key="c">C</Text>],
            <Text key="d">D</Text>
          ]}
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline[0].message.content).toHaveLength(4);
      expect((result.timeline[0].message.content[0] as any).text).toBe('A');
      expect((result.timeline[0].message.content[1] as any).text).toBe('B');
      expect((result.timeline[0].message.content[2] as any).text).toBe('C');
      expect((result.timeline[0].message.content[3] as any).text).toBe('D');
    });

    it('should handle null and undefined children gracefully', async () => {
      const jsx = (
        <Message role="user">
          <Text>Start</Text>
          {null}
          {undefined}
          <Text>End</Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline[0].message.content).toHaveLength(2);
      expect((result.timeline[0].message.content[0] as any).text).toBe('Start');
      expect((result.timeline[0].message.content[1] as any).text).toBe('End');
    });

    it('should preserve metadata and tags', async () => {
      const jsx = (
        <Message 
          role="user" 
          tags={['test', 'important']}
          metadata={{ custom: 'value' }}
        >
          <Text>Content</Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline[0].tags).toEqual(['test', 'important']);
      expect(result.timeline[0].metadata).toMatchObject({ custom: 'value' });
    });

    it('should handle deeply nested formatting', async () => {
      const jsx = (
        <Message role="user">
          <Text>
            Level 1 <strong>
              Level 2 <em>
                Level 3 <code>
                  Level 4
                </code>
              </em>
            </strong>
          </Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      const text = (result.timeline[0].message.content[0] as any).text;
      
      expect(text).toBe('Level 1 **Level 2 *Level 3 `Level 4`***');
    });
  });

  describe('Multiple Messages and Timeline', () => {
    it('should maintain message order in timeline', async () => {
      const jsx = (
        <>
          <Message role="user">
            <Text>First message</Text>
          </Message>
          <Message role="assistant">
            <Text>Second message</Text>
          </Message>
          <Message role="user">
            <Text>Third message</Text>
          </Message>
        </>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline).toHaveLength(3);
      expect(result.timeline[0].message.role).toBe('user');
      expect((result.timeline[0].message.content[0] as any).text).toBe('First message');
      expect(result.timeline[1].message.role).toBe('assistant');
      expect((result.timeline[1].message.content[0] as any).text).toBe('Second message');
      expect(result.timeline[2].message.role).toBe('user');
      expect((result.timeline[2].message.content[0] as any).text).toBe('Third message');
    });

    it('should handle mixed system and timeline messages', async () => {
      const jsx = (
        <>
          <Section id="instructions">
            <Text>System instructions</Text>
          </Section>
          <Message role="user">
            <Text>User message</Text>
          </Message>
          <Section id="context">
            <Text>More context</Text>
          </Section>
          <Message role="assistant">
            <Text>Assistant response</Text>
          </Message>
        </>
      );

      const result = await compileJSX(jsx);
      
      // System message consolidated at beginning
      expect(result.system[0].message.role).toBe('system');
      const systemText = (result.system[0].message.content[0] as any).text;
      expect(systemText).toContain('System instructions');
      expect(systemText).toContain('More context');
      
      // Timeline messages follow
      expect(result.timeline[0].message.role).toBe('user');
      expect(result.timeline[1].message.role).toBe('assistant');
    });
  });

  describe('Code Block Handling', () => {
    it('should preserve structural <Code> as code block', async () => {
      const jsx = (
        <Message role="user">
          <Code language="javascript" text="const x = 42;" />
        </Message>
      );

      const result = await compileJSX(jsx);
      const block = result.timeline[0].message.content[0];
      
      // Code blocks remain as code blocks in COMInput (conversion to markdown happens in adapters)
      expect(block.type).toBe('code');
      expect((block as any).language).toBe('javascript');
      expect((block as any).text).toBe('const x = 42;');
    });

    it('should handle inline <code> differently', async () => {
      const jsx = (
        <Message role="user">
          <Text>Use <code>const x = 42;</code> for assignment</Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      const text = (result.timeline[0].message.content[0] as any).text;
      
      expect(text).toBe('Use `const x = 42;` for assignment');
    });

    it('should pass through native code blocks unchanged', async () => {
      const nativeCodeBlock = {
        type: 'code' as const,
        language: 'python' as const,
        text: 'print("hello")'
      };

      const jsx = (
        <Message role="user">
          {nativeCodeBlock}
        </Message>
      );

      const result = await compileJSX(jsx);
      
      // Code blocks remain as code blocks in COMInput (conversion to markdown happens in adapters)
      expect(result.timeline[0].message.content[0].type).toBe('code');
      expect((result.timeline[0].message.content[0] as any).language).toBe('python');
      expect((result.timeline[0].message.content[0] as any).text).toBe('print("hello")');
    });
  });

  describe('Special Content Block Types', () => {
    it('should pass through reasoning blocks', async () => {
      const reasoningBlock = {
        type: 'reasoning' as const,
        text: 'Let me think...'
      };

      const jsx = (
        <Message role="assistant">
          {reasoningBlock}
        </Message>
      );

      const result = await compileJSX(jsx);
      
      // Reasoning blocks should pass through unchanged
      expect(result.timeline[0].message.content[0].type).toBe('reasoning');
      expect((result.timeline[0].message.content[0] as any).text).toBe('Let me think...');
    });

    it('should pass through tool_use blocks', async () => {
      const toolUseBlock = {
        type: 'tool_use' as const,
        toolUseId: 'test-id',
        name: 'calculator',
        input: { expression: '2+2' }
      };

      const jsx = (
        <Message role="assistant">
          {toolUseBlock}
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline[0].message.content[0].type).toBe('tool_use');
      expect((result.timeline[0].message.content[0] as any).name).toBe('calculator');
    });

    it('should pass through tool_result blocks', async () => {
      const toolResultBlock = {
        type: 'tool_result' as const,
        toolUseId: 'test-id',
        content: [{ type: 'text' as const, text: 'Result: 4' }]
      };

      const jsx = (
        <Message role="user">
          {toolResultBlock}
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline[0].message.content[0].type).toBe('tool_result');
    });
  });

  describe('Complex Real-World Scenarios', () => {
    it('should handle conversation with system + user + assistant', async () => {
      const jsx = (
        <>
          <Section id="instructions" title="Instructions">
            <Paragraph>You are a helpful assistant</Paragraph>
            <Paragraph>Use tools when needed</Paragraph>
          </Section>
          
          <Message role="user">
            <Text>Calculate <code>2 + 2</code></Text>
          </Message>
          
          <Message role="assistant">
            <Text>Let me calculate that.</Text>
            {{ type: 'tool_use' as const, toolUseId: 'calc1', name: 'calculator', input: { expr: '2+2' } }}
          </Message>
          
          <Message role="user">
            {{ type: 'tool_result' as const, toolUseId: 'calc1', content: [{ type: 'text' as const, text: '4' }] }}
          </Message>
          
          <Message role="assistant">
            <Text>The result is <strong>4</strong>.</Text>
          </Message>
        </>
      );

      const result = await compileJSX(jsx);
      
      // System message
      expect(result.system[0].message.role).toBe('system');
      expect((result.system[0].message.content[0] as any).text).toContain('You are a helpful assistant');
      
      // User message
      expect(result.timeline[0].message.role).toBe('user');
      expect((result.timeline[0].message.content[0] as any).text).toBe('Calculate `2 + 2`');
      
      // Assistant with tool use
      expect(result.timeline[1].message.role).toBe('assistant');
      expect(result.timeline[1].message.content[0].type).toBe('text');
      expect(result.timeline[1].message.content[1].type).toBe('tool_use');
      
      // Tool result
      expect(result.timeline[2].message.role).toBe('user');
      expect(result.timeline[2].message.content[0].type).toBe('tool_result');
      
      // Final response
      expect(result.timeline[3].message.role).toBe('assistant');
      expect((result.timeline[3].message.content[0] as any).text).toBe('The result is **4**.');
    });

    it('should handle message with mixed media types', async () => {
      const jsx = (
        <Message role="user">
          <Text>Check out:</Text>
          <Image source={{ type: 'url', url: 'photo.jpg' }} altText="Photo" />
          <Text>And listen to:</Text>
          <Audio source={{ type: 'url', url: 'sound.mp3' }} transcript="Hello" />
          <Text>Final text</Text>
        </Message>
      );

      const result = await compileJSX(jsx);
      
      expect(result.timeline[0].message.content).toHaveLength(5);
      expect(result.timeline[0].message.content[0].type).toBe('text');
      expect(result.timeline[0].message.content[1].type).toBe('image');
      expect(result.timeline[0].message.content[2].type).toBe('text');
      expect(result.timeline[0].message.content[3].type).toBe('audio');
      expect(result.timeline[0].message.content[4].type).toBe('text');
    });

    it('should handle paragraph with inline media', async () => {
      const jsx = (
        <Message role="user">
          <p>
            See the diagram <img src="diagram.png" alt="Diagram" /> for details.
            Also check <a href="https://docs.example.com">the documentation</a>.
          </p>
        </Message>
      );

      const result = await compileJSX(jsx);
      const text = (result.timeline[0].message.content[0] as any).text;
      
      expect(text).toContain('![Diagram](diagram.png)');
      expect(text).toContain('[the documentation](https://docs.example.com)');
    });
  });

  describe('Event messages types', () => {

    it('should handle event messages', async () => {
      const jsx = (
        <Event>
          <UserAction action="view_invoice" actor="user" details={{ invoice_id: '123' }} />
        </Event>
      );

      const result = await compileJSX(jsx);

      const event = result.timeline[0].message as EventMessage;
      // After formatting, event blocks are converted to text blocks by the renderer
      expect(event.role).toBe('event');
      expect(result.timeline[0].message.content[0].type).toBe('text');
      // Check that the text contains the event information (renderer generates text from props)
      const text = (result.timeline[0].message.content[0] as any).text;
      expect(text).toContain('User');
      expect(text).toContain('view_invoice');
      
      // Check raw compiled structure for original block type
      const rawContent = result.compiled.timelineEntries?.[0]?.message?.content[0] as UserActionBlock;
      expect(rawContent.type).toBe('user_action');
      expect(rawContent.action).toBe('view_invoice');
      expect(rawContent.actor).toBe('user');
      expect(rawContent.details).toEqual({ invoice_id: '123' });
    });
  });

  describe('Renderer Granularity', () => {
    // TODO: Test renderer at different tree levels once block-level renderer support is added
    // For now, renderer is applied at Message/Section level
    
    it('should apply renderer at message level', async () => {
      const jsx = (
        <>
          <Markdown>
            <Message role="user">
              <Text><strong>Markdown</strong></Text>
            </Message>
          </Markdown>
          <XML>
            <Message role="assistant">
              <Text><strong>XML</strong></Text>
            </Message>
          </XML>
        </>
      );

      const result = await compileJSX(jsx);
      
      expect((result.timeline[0].message.content[0] as any).text).toBe('**Markdown**');
      expect((result.timeline[1].message.content[0] as any).text).toBe('<strong>XML</strong>');
    });

    it('should apply renderer at section level', async () => {
      const jsx = (
        <>
          <Markdown>
            <Section id="md-section">
              <Text><em>Markdown section</em></Text>
            </Section>
          </Markdown>
          <XML>
            <Section id="xml-section">
              <Text><em>XML section</em></Text>
            </Section>
          </XML>
        </>
      );

      const result = await compileJSX(jsx);
      
      expect((result.sections['md-section'].content as any[])[0].text).toBe('*Markdown section*');
      expect((result.sections['xml-section'].content as any[])[0].text).toBe('<em>XML section</em>');
    });
  });

  it('should apply renderer at content block level (inline)', async () => {
    const jsx = (
      <>
        <Message role="user">
          <Text><strong>Markdown</strong></Text>
        </Message>
        <Message role="assistant">
          <Text><XML><strong><Markdown><i>XML</i></Markdown></strong></XML></Text>
        </Message>
      </>
    );

    const result = await compileJSX(jsx);
    
    expect((result.timeline[0].message.content[0] as any).text).toBe('**Markdown**');
    expect((result.timeline[1].message.content[0] as any).text).toBe('<strong>*XML*</strong>');
  });

  it('should apply renderer at message wrapper level', async () => {
    const jsx = (
      <Message role="assistant">
        <XML><Text><strong>XML</strong></Text></XML>
      </Message>
    );

    const result = await compileJSX(jsx);
    expect((result.timeline[0].message.content[0] as any).text).toBe('<strong>XML</strong>');
  });
});