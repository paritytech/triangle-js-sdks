import type { RendererNode } from '@novasamatech/host-api-wrapper';
import type { PropsWithChildren } from 'react';
import { createContext, useCallback, useContext, useEffect, useId, useRef } from 'react';

export type RendererNodeType = RendererNode;
export type RenderCallback = (node: RendererNodeType) => void;
/** `payload` is empty for a `Button` press and the UTF-8 bytes of the new value for a `TextField` change. */
export type ActionCallback = (actionId: string, payload: Uint8Array) => void;

export type SubscribeAction = (callback: ActionCallback) => VoidFunction;

type RenderContextValue = {
  registerAction(id: string, action: ActionCallback): VoidFunction;
};

type ProviderProps = PropsWithChildren<{
  subscribeActions: SubscribeAction;
}>;

const RenderContext = createContext<RenderContextValue | null>(null);

export const RendererProvider = ({ subscribeActions, children }: ProviderProps) => {
  const callbacks = useRef<Map<string, ActionCallback>>(new Map());

  const registerAction: RenderContextValue['registerAction'] = useCallback((id, action) => {
    callbacks.current.set(id, action);
    return () => {
      callbacks.current.delete(id);
    };
  }, []);

  useEffect(() => {
    return subscribeActions((actionId, payload) => {
      const handler = callbacks.current.get(actionId);
      if (handler) {
        handler(actionId, payload);
      }
    });
  }, [subscribeActions]);

  return <RenderContext.Provider value={{ registerAction }}>{children}</RenderContext.Provider>;
};

function useRenderer() {
  const context = useContext(RenderContext);
  if (!context) {
    throw new Error('useRenderer must be used within a RendererProvider');
  }
  return context;
}

export function useAction<T>(map: (payload: Uint8Array) => T, callback?: (value: T) => void) {
  const id = useId();
  const { registerAction } = useRenderer();
  const ref = useRef(callback);
  ref.current = callback;
  // Inline arrows passed by callers change identity every render; ref instead
  // of closing over to keep the registered action up to date.
  const mapRef = useRef(map);
  mapRef.current = map;

  const actionId = `custom_renderer_action_${id}`;

  useEffect(() => {
    return registerAction(actionId, (_, payload) => {
      if (ref.current) {
        ref.current(mapRef.current(payload));
      }
    });
  }, [actionId, registerAction]);

  return callback ? actionId : undefined;
}
