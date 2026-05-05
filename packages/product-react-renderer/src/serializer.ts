import type { CustomRendererNodeType } from './context.js';
import type { Background, BorderStyle, Dimensions, Modifier, Padding, Size } from './types.js';

export type WidgetInstance = {
  type: string;
  props: Record<string, unknown>;
  children: (WidgetInstance | TextInstance)[];
};

export type TextInstance = {
  __isText: true;
  text: string;
};

function isTextInstance(node: WidgetInstance | TextInstance): node is TextInstance {
  return '__isText' in node;
}

function convertDimensions(value: Padding): Dimensions {
  if (typeof value === 'number' || typeof value === 'bigint') {
    return [value, value, undefined, undefined];
  }
  return value;
}

function convertModifiers(props: Record<string, unknown>): Modifier[] {
  const modifiers: Modifier[] = [];

  if (props.margin !== undefined) {
    modifiers.push({ tag: 'margin', value: convertDimensions(props.margin as Padding) });
  }
  if (props.padding !== undefined) {
    modifiers.push({ tag: 'padding', value: convertDimensions(props.padding as Padding) });
  }
  if (props.background !== undefined) {
    const bg = props.background as Background;
    modifiers.push({
      tag: 'background',
      value: typeof bg === 'string' ? { color: bg, shape: undefined } : { color: bg.color, shape: bg.shape },
    });
  }
  if (props.border !== undefined) {
    const border = props.border as BorderStyle;
    modifiers.push({ tag: 'border', value: border });
  }
  if (props.width !== undefined) modifiers.push({ tag: 'width', value: props.width as Size });
  if (props.height !== undefined) modifiers.push({ tag: 'height', value: props.height as Size });
  if (props.minWidth !== undefined) modifiers.push({ tag: 'minWidth', value: props.minWidth as Size });
  if (props.minHeight !== undefined) modifiers.push({ tag: 'minHeight', value: props.minHeight as Size });
  if (props.fillMaxWidth) modifiers.push({ tag: 'fillWidth', value: true });
  if (props.fillMaxHeight) modifiers.push({ tag: 'fillHeight', value: true });

  return modifiers;
}

function convertWidgetProps(widgetType: string, props: Record<string, unknown>): unknown {
  switch (widgetType) {
    case 'Box':
      return { contentAlignment: props.contentAlignment as string | undefined };
    case 'Column':
      return {
        horizontalAlignment: props.horizontalAlignment as string | undefined,
        verticalArrangement: props.verticalArrangement as string | undefined,
      };
    case 'Row':
      return {
        verticalAlignment: props.verticalAlignment as string | undefined,
        horizontalArrangement: props.horizontalArrangement as string | undefined,
      };
    case 'Spacer':
      return undefined;
    case 'Text':
      return {
        style: props.style as string | undefined,
        color: props.color as string | undefined,
      };
    case 'Button':
      return {
        text: (props.text as string | undefined) ?? '',
        variant: props.variant as string | undefined,
        enabled: props.enabled as boolean | undefined,
        loading: props.loading as boolean | undefined,
        clickAction: props.clickAction,
      };
    case 'TextField':
      return {
        text: (props.value as string | undefined) ?? '',
        placeholder: props.placeholder as string | undefined,
        label: props.label as string | undefined,
        enabled: props.enabled as boolean | undefined,
        valueChangeAction: props.valueChangeAction,
      };
    default:
      return undefined;
  }
}

// ---------- Serialization ----------

function serializeNode(node: WidgetInstance | TextInstance): CustomRendererNodeType {
  if (isTextInstance(node)) {
    return { tag: 'String', value: node.text };
  }

  return {
    tag: node.type,
    value: {
      modifiers: convertModifiers(node.props),
      props: convertWidgetProps(node.type, node.props),
      children: node.children.map(child => serializeNode(child)),
    },
  } as CustomRendererNodeType;
}

/**
 * Serialize the reconciler tree and deliver the result via the render callback.
 * Clears stale callbacks, serializes the tree, and wraps multiple roots in a Column.
 */
export function serializeAndRender(children: (WidgetInstance | TextInstance)[]): CustomRendererNodeType {
  const serialized = children.map(serializeNode);

  let rootNode: CustomRendererNodeType;
  if (serialized.length === 0) {
    rootNode = { tag: 'Nil', value: undefined };
  } else if (serialized.length === 1 && serialized[0] !== undefined) {
    rootNode = serialized[0];
  } else {
    rootNode = {
      tag: 'Column',
      value: {
        modifiers: [],
        props: { horizontalAlignment: undefined, verticalArrangement: undefined },
        children: serialized,
      },
    };
  }

  return rootNode;
}
