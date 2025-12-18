import { createElement, type JSX } from '../jsx-runtime';
import { type ComponentBaseProps } from '../jsx-types';
import { MarkdownRenderer } from '../../renderers';
import { Renderer } from './renderer';

/**
 * Markdown renderer component.
 * Provides markdown rendering context for its children.
 * 
 * Usage:
 * ```jsx
 * <Markdown>
 *   <H1>Title</H1>
 *   <Text>Content</Text>
 * </Markdown>
 * ```
 */
export interface MarkdownProps extends ComponentBaseProps {
  /**
   * Markdown flavor: 'github', 'commonmark', or 'gfm'
   */
  flavor?: 'github' | 'commonmark' | 'gfm';
  children?: any;
}

export function Markdown(props: MarkdownProps): JSX.Element {
  return createElement(Renderer, { 
    instance: new MarkdownRenderer(props.flavor),
    children: props.children 
  });
}

