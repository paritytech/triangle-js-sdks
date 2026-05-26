/* eslint-disable @typescript-eslint/no-non-null-assertion */

// @ts-expect-error Untyped
globalThis['IS_REACT_ACT_ENVIRONMENT'] = true;

import type { CodecType } from '@novasamatech/host-api';
import { CustomRendererNode, Modifier, createTransport, enumValue } from '@novasamatech/host-api';
import { createProductChatManager } from '@novasamatech/host-api-wrapper';
import { createContainer } from '@novasamatech/host-container';
import {
  Box,
  Button,
  Column,
  Row,
  Spacer,
  Text,
  TextField,
  registerChatMessageRenderer,
} from '@novasamatech/product-react-renderer';

import { nanoid } from 'nanoid';
import { act, useState } from 'react';
import { str } from 'scale-ts';
import { describe, expect, it, vi } from 'vitest';

import { createHostApiProviders } from './__mocks__/hostApiProviders.js';

type RendererNode = CodecType<typeof CustomRendererNode>;
type RendererModifier = CodecType<typeof Modifier>;

function findChildOfTag<T extends RendererNode['tag']>(
  children: RendererNode[],
  tag: T,
): Extract<RendererNode, { tag: T }> {
  const found = children.find((c): c is Extract<RendererNode, { tag: T }> => c.tag === tag);
  if (!found) throw new Error(`No child with tag ${tag}`);
  return found;
}

type ActionMsg = {
  roomId: string;
  peer: string;
  payload: {
    tag: 'ActionTriggered';
    value: { messageId: string; actionId: string; payload: Uint8Array };
  };
};

function setup() {
  const providers = createHostApiProviders();
  const container = createContainer(providers.host);
  const sdkTransport = createTransport(providers.sdk);
  const chat = createProductChatManager(sdkTransport);

  /**
   * Collect every action-send function the host receives — one per product
   * chatActionSubscribe() call (each rendered message creates its own subscription).
   * triggerAction fans out to all of them so the per-messageId filter inside
   * subscribeActions can route each event to the correct renderer.
   */
  const sendActions: ((action: ActionMsg) => void)[] = [];
  container.handleChatActionSubscribe((_, send) => {
    sendActions.push(send);
    return () => {
      /* empty */
    };
  });

  /**
   * Simulate the host firing an ActionTriggered event for a rendered message.
   * payload is optional — omit it for Button clicks, pass a SCALE-encoded value
   * (e.g. str.enc('text')) for TextField changes.
   */
  function triggerAction(messageId: string, actionId: string, payload: Uint8Array) {
    sendActions.forEach(send =>
      send({
        roomId: 'room',
        peer: 'bot',
        payload: enumValue('ActionTriggered', { messageId, actionId, payload }),
      }),
    );
  }

  /**
   * Subscribe and wait for the initial render in one act() pass so the mount
   * that happens synchronously inside renderChatCustomMessage is properly tracked.
   */
  async function subscribe(
    messageId: string,
    messageType: string,
    payload: Uint8Array,
    callback: (node: CodecType<typeof CustomRendererNode>) => VoidFunction,
  ) {
    return act(async () => {
      return container.renderChatCustomMessage({ messageId, messageType, payload }, callback);
    });
  }

  return { container, chat, triggerAction, subscribe };
}

describe('registerChatMessageRenderer + createProductChatManager integration', () => {
  it('renders a React element and delivers it as a CustomRendererNode to the container', async () => {
    const { chat, subscribe } = setup();

    chat.onCustomMessageRenderingRequest(
      registerChatMessageRenderer(
        payload => payload,
        () => (
          <Column horizontalAlignment="center" verticalArrangement="spaceBetween" padding={16} fillMaxWidth>
            {/* Box A: contentAlignment, background+Rounded shape, border, fillMaxWidth */}
            <Box
              contentAlignment="topStart"
              background={{ color: 'bg.surface.container', shape: { tag: 'Rounded', value: 8 } }}
              border={{ width: 1, color: 'fg.tertiary', shape: undefined }}
              fillMaxWidth
            >
              <Text style="title.medium.regular" color="fg.secondary">
                Title
              </Text>
            </Box>
            {/* Box B: background as plain ColorToken, width/height/minWidth/minHeight */}
            <Box
              contentAlignment="center"
              background="bg.surface.main"
              width={40}
              height={40}
              minWidth={20}
              minHeight={20}
            >
              {/* Inner Box: Circle shape, fillMaxWidth + fillMaxHeight */}
              <Box
                background={{ color: 'bg.surface.nested', shape: { tag: 'Circle', value: undefined } }}
                fillMaxWidth
                fillMaxHeight
              />
            </Box>
            {/* Row: verticalAlignment, horizontalArrangement, margin; covers bodyM/bodyS/caption + success/warning/error */}
            <Row verticalAlignment="bottom" horizontalArrangement="spaceEvenly" margin={8}>
              <Text style="body.medium.regular" color="fg.success">
                Item A
              </Text>
              <Spacer width={8} height={4} />
              <Text style="body.small.regular" color="fg.warning">
                Item B
              </Text>
              <Text style="body.small.regular" color="fg.error">
                Item C
              </Text>
            </Row>
            <Text style="headline.large" color="fg.primary">
              Balance: 100 DOT
            </Text>
            {/* Spacer with fillMaxHeight */}
            <Spacer fillMaxHeight />
            <Button
              text="Submit"
              variant="primary"
              enabled={true}
              loading={false}
              onClick={() => {
                /* empty */
              }}
            />
            <Button
              text="Cancel"
              variant="secondary"
              onClick={() => {
                /* empty */
              }}
            />
            <Button
              text="Link"
              variant="text"
              onClick={() => {
                /* empty */
              }}
            />
            <TextField
              value="initial"
              placeholder="Type here"
              label="Amount"
              enabled={true}
              onValueChange={() => {
                /* empty */
              }}
            />
            test string
            {null}
            {false}
          </Column>
        ),
      ),
    );

    const messageId = nanoid();
    const callback = vi.fn();
    const sub = await subscribe(messageId, 'all-widgets', new Uint8Array(), callback);

    expect(callback).toHaveBeenCalled();
    const node = callback.mock.calls[0]![0];

    // Root: Column with padding + fillMaxWidth modifiers
    expect(node.tag).toBe('Column');
    expect(node.value.props.horizontalAlignment).toBe('center');
    expect(node.value.props.verticalArrangement).toBe('spaceBetween');
    const colMods = node.value.modifiers as RendererModifier[];
    expect(colMods).toContainEqual({ tag: 'padding', value: [16, 16, undefined, undefined] });
    expect(colMods).toContainEqual({ tag: 'fillWidth', value: true });

    // Children form a heterogeneous tagged-union tree; the cast here lets the
    // test navigate the deeply-nested shape without per-access narrowing.
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const children = node.value.children as any[];
    const [boxA, boxB, rowNode, headlineText, topSpacer, btnPrimary, btnSecondary, btnText, tfNode, textNode] =
      children;

    // Box A: contentAlignment, background with Rounded shape, border, fillMaxWidth
    expect(boxA.tag).toBe('Box');
    expect(boxA.value.props.contentAlignment).toBe('topStart');
    const boxAMods = boxA.value.modifiers as RendererModifier[];
    expect(boxAMods).toContainEqual({
      tag: 'background',
      value: { color: 'bg.surface.container', shape: { tag: 'Rounded', value: 8 } },
    });
    expect(boxAMods).toContainEqual({
      tag: 'border',
      value: { width: 1, color: 'fg.tertiary', shape: undefined },
    });
    expect(boxAMods).toContainEqual({ tag: 'fillWidth', value: true });

    // Box A > Text: title.medium.regular + fg.secondary
    const boxAText = boxA.value.children[0];
    expect(boxAText.tag).toBe('Text');
    expect(boxAText.value.props.style).toBe('title.medium.regular');
    expect(boxAText.value.props.color).toBe('fg.secondary');
    expect(boxAText.value.children[0]).toEqual({ tag: 'String', value: 'Title' });

    // Box B: contentAlignment, background as plain color token, width/height/minWidth/minHeight
    expect(boxB.tag).toBe('Box');
    expect(boxB.value.props.contentAlignment).toBe('center');
    const boxBMods = boxB.value.modifiers as RendererModifier[];
    expect(boxBMods).toContainEqual({ tag: 'background', value: { color: 'bg.surface.main', shape: undefined } });
    expect(boxBMods).toContainEqual({ tag: 'width', value: 40 });
    expect(boxBMods).toContainEqual({ tag: 'height', value: 40 });
    expect(boxBMods).toContainEqual({ tag: 'minWidth', value: 20 });
    expect(boxBMods).toContainEqual({ tag: 'minHeight', value: 20 });

    // Box B > inner Box: background with Circle shape, fillMaxWidth + fillMaxHeight
    const innerBox = boxB.value.children[0];
    expect(innerBox.tag).toBe('Box');
    const innerBoxMods = innerBox.value.modifiers as RendererModifier[];
    expect(innerBoxMods).toContainEqual({
      tag: 'background',
      value: { color: 'bg.surface.nested', shape: { tag: 'Circle', value: undefined } },
    });
    expect(innerBoxMods).toContainEqual({ tag: 'fillWidth', value: true });
    expect(innerBoxMods).toContainEqual({ tag: 'fillHeight', value: true });

    // Row: verticalAlignment, horizontalArrangement, margin
    expect(rowNode.tag).toBe('Row');
    expect(rowNode.value.props.verticalAlignment).toBe('bottom');
    expect(rowNode.value.props.horizontalArrangement).toBe('spaceEvenly');
    const rowMods = rowNode.value.modifiers as RendererModifier[];
    expect(rowMods).toContainEqual({ tag: 'margin', value: [8, 8, undefined, undefined] });

    // Row > Text: bodyM + success
    const rowTextA = rowNode.value.children[0];
    expect(rowTextA.tag).toBe('Text');
    expect(rowTextA.value.props.style).toBe('body.medium.regular');
    expect(rowTextA.value.props.color).toBe('fg.success');
    expect(rowTextA.value.children[0]).toEqual({ tag: 'String', value: 'Item A' });

    // Row > Spacer: width + height modifiers
    const rowSpacer = rowNode.value.children[1];
    expect(rowSpacer.tag).toBe('Spacer');
    const rowSpacerMods = rowSpacer.value.modifiers as RendererModifier[];
    expect(rowSpacerMods).toContainEqual({ tag: 'width', value: 8 });
    expect(rowSpacerMods).toContainEqual({ tag: 'height', value: 4 });

    // Row > Text: bodyS + warning
    const rowTextB = rowNode.value.children[2];
    expect(rowTextB.tag).toBe('Text');
    expect(rowTextB.value.props.style).toBe('body.small.regular');
    expect(rowTextB.value.props.color).toBe('fg.warning');
    expect(rowTextB.value.children[0]).toEqual({ tag: 'String', value: 'Item B' });

    // Row > Text: caption + error
    const rowTextC = rowNode.value.children[3];
    expect(rowTextC.tag).toBe('Text');
    expect(rowTextC.value.props.style).toBe('body.small.regular');
    expect(rowTextC.value.props.color).toBe('fg.error');
    expect(rowTextC.value.children[0]).toEqual({ tag: 'String', value: 'Item C' });

    // Text: headline.large + fg.primary
    expect(headlineText.tag).toBe('Text');
    expect(headlineText.value.props.style).toBe('headline.large');
    expect(headlineText.value.props.color).toBe('fg.primary');
    expect(headlineText.value.children[0]).toEqual({ tag: 'String', value: 'Balance: 100 DOT' });

    // Spacer: fillMaxHeight
    expect(topSpacer.tag).toBe('Spacer');
    const topSpacerMods = topSpacer.value.modifiers as RendererModifier[];
    expect(topSpacerMods).toContainEqual({ tag: 'fillHeight', value: true });

    // Button: primary variant, enabled, loading
    expect(btnPrimary.tag).toBe('Button');
    expect(btnPrimary.value.props.text).toBe('Submit');
    expect(btnPrimary.value.props.variant).toBe('primary');
    expect(btnPrimary.value.props.enabled).toBe(true);
    expect(btnPrimary.value.props.loading).toBe(false);
    expect(typeof btnPrimary.value.props.clickAction).toBe('string');

    // Button: secondary variant
    expect(btnSecondary.tag).toBe('Button');
    expect(btnSecondary.value.props.text).toBe('Cancel');
    expect(btnSecondary.value.props.variant).toBe('secondary');
    expect(typeof btnSecondary.value.props.clickAction).toBe('string');

    // Button: text variant
    expect(btnText.tag).toBe('Button');
    expect(btnText.value.props.text).toBe('Link');
    expect(btnText.value.props.variant).toBe('text');
    expect(typeof btnText.value.props.clickAction).toBe('string');

    // TextField: all props (value prop serializes as text)
    expect(tfNode.tag).toBe('TextField');
    expect(tfNode.value.props.text).toBe('initial');
    expect(tfNode.value.props.placeholder).toBe('Type here');
    expect(tfNode.value.props.label).toBe('Amount');
    expect(tfNode.value.props.enabled).toBe(true);
    expect(typeof tfNode.value.props.valueChangeAction).toBe('string');

    // Text
    expect(textNode.tag).toBe('String');
    expect(textNode.value).toBe('test string');

    await act(async () => {
      sub.unsubscribe();
    });
  });

  it('forwards messageId and messageType to the renderFn', async () => {
    const { chat, subscribe } = setup();

    const renderFn = vi.fn(() => <Text>ok</Text>);
    chat.onCustomMessageRenderingRequest(registerChatMessageRenderer(payload => payload, renderFn));

    const messageId = nanoid();
    const sub = await subscribe(messageId, 'my-type', new Uint8Array(), vi.fn());

    expect(renderFn).toHaveBeenCalledWith(expect.objectContaining({ messageId, messageType: 'my-type' }));

    await act(async () => {
      sub.unsubscribe();
    });
  });

  it('passes the raw payload through mapPayload before renderFn receives it', async () => {
    const { chat, subscribe } = setup();

    const data = { token: 'DOT', balance: '42.5' };
    const encoded = new TextEncoder().encode(JSON.stringify(data));

    const renderFn = vi.fn(() => <Text>ok</Text>);
    const mapPayload = vi.fn((raw: Uint8Array) => JSON.parse(new TextDecoder().decode(raw)) as typeof data);

    chat.onCustomMessageRenderingRequest(registerChatMessageRenderer(mapPayload, renderFn));

    const messageId = nanoid();
    const sub = await subscribe(messageId, 'balance-card', encoded, vi.fn());

    expect(mapPayload).toHaveBeenCalledWith(encoded);
    expect(renderFn).toHaveBeenCalledWith(expect.objectContaining({ payload: data }));

    await act(async () => {
      sub.unsubscribe();
    });
  });

  it('re-renders when a Button click ActionTriggered event arrives for the correct messageId', async () => {
    const { chat, triggerAction, subscribe } = setup();

    function Counter() {
      const [count, setCount] = useState(0);
      return (
        <Column>
          <Text>{String(count)}</Text>
          <Button text="+" onClick={() => setCount(c => c + 1)} />
        </Column>
      );
    }

    chat.onCustomMessageRenderingRequest(
      registerChatMessageRenderer(
        payload => payload,
        () => <Counter />,
      ),
    );

    const messageId = nanoid();
    const callback = vi.fn();
    const sub = await subscribe(messageId, 'counter', new Uint8Array(), callback);

    const firstNode = callback.mock.calls[callback.mock.calls.length - 1]![0];
    const btn = findChildOfTag(firstNode.value.children as RendererNode[], 'Button');
    const clickActionId = btn.value.props.clickAction!;

    await act(async () => {
      triggerAction(messageId, clickActionId, new Uint8Array());
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    });

    expect(callback.mock.calls.length).toBeGreaterThan(1);
    const updatedNode = callback.mock.calls[callback.mock.calls.length - 1]![0];
    const txt = findChildOfTag(updatedNode.value.children as RendererNode[], 'Text');
    expect(txt.value.children[0]).toEqual({ tag: 'String', value: '1' });

    await act(async () => {
      sub.unsubscribe();
    });
  });

  it('re-renders when a TextField ActionTriggered event arrives carrying a SCALE-encoded string', async () => {
    const { chat, triggerAction, subscribe } = setup();

    function InputForm() {
      const [value, setValue] = useState('');
      return (
        <Column>
          <Text>{value || 'empty'}</Text>
          <TextField value={value} placeholder="Type here" onValueChange={v => setValue(v as string)} />
        </Column>
      );
    }

    chat.onCustomMessageRenderingRequest(
      registerChatMessageRenderer(
        payload => payload,
        () => <InputForm />,
      ),
    );

    const messageId = nanoid();
    const callback = vi.fn();
    const sub = await subscribe(messageId, 'form', new Uint8Array(), callback);

    const firstNode = callback.mock.calls[callback.mock.calls.length - 1]![0];
    const tf = findChildOfTag(firstNode.value.children as RendererNode[], 'TextField');
    const valueChangeActionId = tf.value.props.valueChangeAction!;

    await act(async () => {
      triggerAction(messageId, valueChangeActionId, str.enc('hello world'));
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    });

    const updatedNode = callback.mock.calls[callback.mock.calls.length - 1]![0];
    const updatedTf = findChildOfTag(updatedNode.value.children as RendererNode[], 'TextField');
    expect(updatedTf.value.props.text).toBe('hello world');

    await act(async () => {
      sub.unsubscribe();
    });
  });

  it('does not route actions intended for a different messageId', async () => {
    const { chat, triggerAction, subscribe } = setup();

    const onClick = vi.fn();
    chat.onCustomMessageRenderingRequest(
      registerChatMessageRenderer(
        payload => payload,
        () => <Button text="Click" onClick={onClick} />,
      ),
    );

    const messageId = nanoid();
    const callback = vi.fn();
    const sub = await subscribe(messageId, 'btn', new Uint8Array(), callback);

    const node = callback.mock.calls[0]![0];
    const clickActionId: string = node.value.props.clickAction;

    // Fire the action for a *different* messageId — onClick must not be called.
    await act(async () => {
      triggerAction('other-message-id', clickActionId, new Uint8Array());
    });

    expect(onClick).not.toHaveBeenCalled();

    await act(async () => {
      sub.unsubscribe();
    });
  });

  it('two concurrent messages have isolated state and independent action routing', async () => {
    const { chat, triggerAction, subscribe } = setup();

    function Counter({ start }: { start: number }) {
      const [count, setCount] = useState(start);
      return (
        <Column>
          <Text>{String(count)}</Text>
          <Button text="+" onClick={() => setCount(c => c + 1)} />
        </Column>
      );
    }

    chat.onCustomMessageRenderingRequest(
      registerChatMessageRenderer(
        payload => payload,
        ({ messageType }) => <Counter start={messageType === 'a' ? 0 : 10} />,
      ),
    );

    const messageIdA = nanoid();
    const messageIdB = nanoid();
    const cbA = vi.fn();
    const cbB = vi.fn();
    const subA = await subscribe(messageIdA, 'a', new Uint8Array(), cbA);
    const subB = await subscribe(messageIdB, 'b', new Uint8Array(), cbB);

    const nodeA = cbA.mock.calls[cbA.mock.calls.length - 1]![0];
    const btnA = findChildOfTag(nodeA.value.children as RendererNode[], 'Button');

    // Click only message A's button
    await act(async () => {
      triggerAction(messageIdA, btnA.value.props.clickAction!, new Uint8Array());
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    });

    const updatedA = cbA.mock.calls[cbA.mock.calls.length - 1]![0];
    const updatedB = cbB.mock.calls[cbB.mock.calls.length - 1]![0];
    const txtA = findChildOfTag(updatedA.value.children as RendererNode[], 'Text');
    const txtB = findChildOfTag(updatedB.value.children as RendererNode[], 'Text');

    expect(txtA.value.children[0]).toEqual({ tag: 'String', value: '1' });
    expect(txtB.value.children[0]).toEqual({ tag: 'String', value: '10' });

    await act(async () => {
      subA.unsubscribe();
      subB.unsubscribe();
    });
  });

  it('unsubscribing from the container unmounts the React renderer', async () => {
    const { chat, subscribe } = setup();

    const cleanupSpy = vi.fn();
    const renderer = registerChatMessageRenderer(
      payload => payload,
      () => <Text>bye</Text>,
    );

    chat.onCustomMessageRenderingRequest((params, render) => {
      const cleanup = renderer(params, render);
      return () => {
        cleanup();
        cleanupSpy();
      };
    });

    const callback = vi.fn();
    const messageId = nanoid();
    const sub = await subscribe(messageId, 'test', new Uint8Array(), callback);
    expect(callback).toHaveBeenCalled();

    await act(async () => {
      sub.unsubscribe();
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    });

    expect(cleanupSpy).toHaveBeenCalledOnce();
  });
});
