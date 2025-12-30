import { createElement, type JSX } from "../jsx-runtime";
import { type ComponentBaseProps } from "../jsx-types";
import { XMLRenderer } from "../../renderers";
import { Renderer } from "./renderer";

/**
 * XML renderer component.
 * Provides XML rendering context for its children.
 *
 * Usage:
 * ```jsx
 * <XML>
 *   <H1>Title</H1>
 *   <Text>Content</Text>
 * </XML>
 * ```
 */
export interface XMLProps extends ComponentBaseProps {
  children?: any;
}

export function XML(props: XMLProps): JSX.Element {
  return createElement(Renderer, {
    instance: new XMLRenderer(),
    children: props.children,
  });
}
