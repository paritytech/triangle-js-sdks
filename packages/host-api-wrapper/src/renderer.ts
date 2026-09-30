import type {
  CodecType,
  RenderContext as RenderContextCodec,
  RendererAction as RendererActionCodec,
  RendererNodeType,
  Subscription,
  Transport,
} from '@novasamatech/host-api';
import { GenericError, createHostApi, enumValue } from '@novasamatech/host-api';

import type { GenericInterrupt } from './helpers.js';
import { genericInterrupt, unwrapVersionedSubscription } from './helpers.js';
import { sandboxTransport } from './sandboxTransport.js';

/** A product-rendered tree, drawn by the host from its own design system. */
export type RendererNode = RendererNodeType;

/**
 * Where a product-rendered body lives, and the ids that name it there: a chat
 * message, an input widget candidate, or a Pocket card face. A render request
 * and the actions inside its tree carry the same context.
 */
export type RenderContext = CodecType<typeof RenderContextCodec>;

/** An action triggered inside one of this product's rendered bodies. */
export type RendererAction = CodecType<typeof RendererActionCodec>;

/**
 * Receives an action triggered inside a rendered body. `payload` is empty for
 * a `Button` press and the UTF-8 bytes of the new value (no length prefix) for
 * a `TextField` change.
 */
export type RenderActionCallback = (actionId: string, payload: Uint8Array) => void;

export type RenderRequest<Payload = Uint8Array> = {
  context: RenderContext;
  /** Product-defined payload, opaque to the host — for a chat message, the stored `Custom` payload. */
  payload: Payload;
  /** Subscribes to the actions triggered inside this body's tree. Returns an unsubscribe function. */
  subscribeActions(callback: RenderActionCallback): VoidFunction;
  /**
   * Ends the stream from the product side. Without a reason the host keeps the
   * last tree on screen; with one it shows the product's identity and no body.
   * The handler's cleanup runs either way.
   */
  end(reason?: string): void;
};

/**
 * Draws one product-rendered body. Call `render` with a tree whenever the body
 * changes; each tree replaces the previous one. The returned cleanup runs when
 * the body leaves the screen or the stream ends.
 */
export type RenderHandler = (request: RenderRequest, render: (node: RendererNode) => void) => VoidFunction;

type ChatMessageContext = Extract<RenderContext, { tag: 'ChatMessage' }>['value'];

export type ChatMessageRenderParams<Payload = Uint8Array> = ChatMessageContext &
  Pick<RenderRequest<Payload>, 'payload' | 'subscribeActions' | 'end'>;

/** Draws a `Custom` chat message: a {@link RenderHandler} narrowed to the `ChatMessage` context. */
export type ChatMessageRenderer = (
  params: ChatMessageRenderParams,
  render: (node: RendererNode) => void,
) => VoidFunction;

const noop = () => {
  /* empty */
};

/** True when two contexts name the same body. Contexts are compared by value. */
export function isSameRenderContext(a: RenderContext, b: RenderContext): boolean {
  if (a.tag !== b.tag) return false;

  const left: Record<string, unknown> = a.value;
  const right: Record<string, unknown> = b.value;
  const keys = Object.keys(left);

  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}

/**
 * Builds a {@link RenderHandler} that draws `Custom` chat messages, picking the
 * renderer by `messageType`. A request for another surface, or for a message
 * type missing from `map`, is ended with an error.
 */
export function matchChatMessageRenderers(map: Record<string, ChatMessageRenderer>): RenderHandler {
  return (request, render) => {
    const { context, payload, subscribeActions, end } = request;

    if (context.tag !== 'ChatMessage') {
      end(`Render context ${context.tag} is not supported`);
      return noop;
    }

    const renderer = map[context.value.messageType];
    if (!renderer) {
      end(`Renderer for message type ${context.value.messageType} is not defined`);
      return noop;
    }

    return renderer({ ...context.value, payload, subscribeActions, end }, render);
  };
}

export const createProductRenderer = (transport: Transport = sandboxTransport) => {
  const version = 'v1' as const;
  const hostApi = createHostApi(transport);

  let handler: RenderHandler | undefined;
  let uninstall: VoidFunction | undefined;
  const openBodies = new Set<VoidFunction>();

  function subscribeActions(callback: (action: RendererAction) => void): Subscription<GenericInterrupt | undefined> {
    return unwrapVersionedSubscription(
      hostApi.renderer.actionSubscribe(enumValue(version, undefined), payload => {
        if (payload.tag === version) callback(payload.value);
      }),
      genericInterrupt,
    );
  }

  function install() {
    return hostApi.renderer.render((params, send, interrupt) => {
      const { context, payload } = params.value;
      let ended = false;
      let cleanup: VoidFunction = noop;

      const end = (reason?: string) => {
        if (ended) return;
        ended = true;
        openBodies.delete(end);
        // The transport runs the returned cleanup once the interrupt is out.
        interrupt(enumValue(version, reason === undefined ? undefined : new GenericError({ reason })));
      };

      const current = handler;
      if (!current) {
        end('No renderer registered');
        return noop;
      }

      openBodies.add(end);

      try {
        cleanup = current(
          {
            context,
            payload,
            subscribeActions(callback) {
              return subscribeActions(action => {
                if (isSameRenderContext(action.context, context)) {
                  callback(action.actionId, action.payload);
                }
              }).unsubscribe;
            },
            end,
          },
          node => {
            if (!ended) send(enumValue(version, node));
          },
        );
      } catch (e) {
        end(e instanceof Error ? e.message : String(e));
      }

      let cleanedUp = false;
      return () => {
        if (cleanedUp) return;
        cleanedUp = true;
        ended = true;
        openBodies.delete(end);
        cleanup();
      };
    });
  }

  return {
    /**
     * Registers the handler the host calls for every body this product draws,
     * on every surface its manifest includes; match on `request.context` to
     * tell them apart (or use {@link matchChatMessageRenderers}).
     *
     * A product has one render handler: registering another replaces it for
     * the requests that arrive afterwards. The returned function unregisters
     * it and ends the bodies still open, leaving their last tree on screen.
     */
    onRender(renderHandler: RenderHandler): VoidFunction {
      handler = renderHandler;
      uninstall ??= install();

      return () => {
        if (handler !== renderHandler) return;
        handler = undefined;
        for (const end of [...openBodies]) end();
        uninstall?.();
        uninstall = undefined;
      };
    },

    /**
     * Subscribes to every action triggered inside this product's rendered
     * bodies, on every surface. Each action carries the context of the body it
     * came from; {@link RenderRequest.subscribeActions} is the per-body form.
     */
    subscribeActions,
  };
};

export const productRenderer = createProductRenderer();
