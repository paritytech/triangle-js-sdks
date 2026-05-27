# @novasamatech/host-api

A protocol designed to connect Products and Host applications by providing a set of methods for communication.

## Installation

```shell
npm install @novasamatech/host-api --save -E
```

## Usage

The Host API package is composed of four main parts:
* **Protocol** — SCALE codecs;
* **Provider** — IPC interface, depends on environment;
* **Transport** — wrapper around protocol for making actual calls;
* **Host API** — wrapper around transport for direct usage of business methods.

### Provider

Provider is an interface for IPC communication.
You can find the definition [here](./src/provider.ts).
The main goal is to abstract actual message send/receive logic from API.
Products should not implement their own providers, it should be done inside SDKs.

### Transport

Transport is a low-level wrapper around protocol and provider.
It encapsulates serialization/deserialization and request/subscription logic.

```typescript
import { createTransport, resultOk } from '@novasamatech/host-api';
import { provider } from './custom-provider.js';

const transport = createTransport(provider);

// requesting by consumer

const response = await transport.request('storage_read', payload);

// handling request on provider side

const stop = transport.handleRequest('storage_read', async (payload) => {
  try {
    const result = await readFromStorage(payload);
    return resultOk(result);
  } catch (e) {
    return resultErr(e);
  }
});

// subscribing by consumer

const subscription = await transport.subscribe('chat_action_subscribe', params, (payload) => {
  console.log('action received:', payload);
});

subscription.onInterrupt(() => {
  console.log('subscription interrupted');
});

subscription.unsubscribe();

// handling subscription on provider side

transport.handleSubscription('chat_action_subscribe', (params, send, interrupt) => {
  const unsubscribe = subscribeToChatActions(params, (err, action) => {
    if (err) {
      interrupt(err);
    } else {
      send(action);
    }
  });
  
  return unsubscribe;
});
```

### Host API

Host API is a wrapper around transport that provides convenient methods for calling methods and subscribing to events.
It can be used by products directly or indirectly via SDK. All requests return a `ResultAsync` struct from the [neverthrow](https://github.com/Microsoft/neverthrow) library.

```typescript
import { createHostApi, createTransport } from '@novasamatech/host-api';
import { provider } from './custom-provider.js';

const transport = createTransport(provider);
const hostApi = createHostApi(transport);

// requesting data

const storageValue = hostApi.localStorageRead(payload);

storageValue.match(
  (data) => console.log('success:', data),
  (err) => console.log('error:', err)
);

// subscribing to events

const subscription = hostApi.chatActionSubscribe(params, (action) => {
  console.log('action received:', action);
});

subscription.onInterrupt(() => {
  console.log('subscription interrupted');
});

subscription.unsubscribe();
```

### Custom Renderer

The protocol includes a custom renderer system for building UI component trees that can be serialized and sent across the transport. This is used for rendering custom chat messages.

Available components: `Box`, `Column`, `Row`, `Spacer`, `Text`, `Button`, `TextField`. Each component supports optional `Modifiers` (margin, padding, background, border, dimensions) and can contain children.

```typescript
import { CustomRendererNode } from '@novasamatech/host-api';
```

### Account Connection Status

Products can subscribe to account connection status changes:

```typescript
const subscription = hostApi.accountConnectionStatusSubscribe(undefined, (status) => {
  // status: 'connected' | 'disconnected'
  console.log('connection status:', status);
});
```

### Custom Chat Messages

Chat messages now support a `Custom` content type that carries an arbitrary payload identified by `messageType`. Products can handle rendering of custom messages via the `productChatCustomMessageRenderSubscribe` subscription, which receives the message type and payload and expects a `CustomRendererNode` tree in response.
