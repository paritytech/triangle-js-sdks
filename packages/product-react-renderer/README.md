# @novasamatech/product-react-renderer

A custom React reconciler for rendering native UI widgets inside Polkadot host applications. Use it together with [`@novasamatech/product-sdk`](../product-sdk) to render interactive widget trees in response to custom chat messages.

## How it works

When the host app displays a custom chat message, it calls your script to produce a **widget tree** — a structured description of the UI to render natively (buttons, text, columns, etc.). This package implements a custom React reconciler that maps React components to that widget tree format, so you can use React features like `useState`, `useEffect`, and component composition to build your UI.

```
React component tree
      ↓  (React reconciler)
Widget tree (CustomRendererNode)
      ↓  (SCALE encoding)
Native Desktop/Mobile UI
```

## Installation

```shell
npm install @novasamatech/product-react-renderer react --save -E
```

## Setup

Configure your `tsconfig.json` to use React JSX:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx"
  }
}
```

---

## `registerChatMessageRenderer`

The primary entry point for rendering custom chat messages. Pass a `mapPayload` function that decodes the raw bytes sent by the host, and a `renderFn` that returns the React element tree. The return value is a callback you pass directly to `chat.onCustomMessageRenderingRequest()`.

### Static message

```tsx
import { registerChatMessageRenderer, Text } from '@novasamatech/product-react-renderer';

chat.onCustomMessageRenderingRequest(
  registerChatMessageRenderer(
    () => undefined,
    () => <Text style="headline">Hello from the product!</Text>,
  ),
);
```

### Decoding a payload

`mapPayload` converts the raw `Uint8Array` the host sends before your `renderFn` sees it. A common pattern is JSON:

```tsx
import { registerChatMessageRenderer, Column, Text } from '@novasamatech/product-react-renderer';

type BalancePayload = { token: string; amount: string };

chat.onCustomMessageRenderingRequest(
  registerChatMessageRenderer(
    raw => JSON.parse(new TextDecoder().decode(raw)) as BalancePayload,
    ({ payload }) => (
      <Column>
        <Text style="headline">{payload.amount}</Text>
        <Text color="textSecondary">{payload.token}</Text>
      </Column>
    ),
  ),
);
```

### Interactive messages

Use standard React hooks for local state. Library automatically wires up callbacks to user interactions on Host side.

```tsx
import { useState } from 'react';
import { registerChatMessageRenderer, Column, Text, Button } from '@novasamatech/product-react-renderer';

function VoteWidget() {
  const [votes, setVotes] = useState(0);
  return (
    <Column horizontalAlignment="center" padding={16}>
      <Text style="headline">Votes: {votes}</Text>
      <Button text="Vote" variant="primary" onClick={() => setVotes(v => v + 1)} />
    </Column>
  );
}

chat.onCustomMessageRenderingRequest(
  registerChatMessageRenderer(
    () => undefined,
    () => <VoteWidget />,
  ),
);
```

### TextField input

`onValueChange` receives the decoded string value each time the user edits the field.

```tsx
import { useState } from 'react';
import {
  registerChatMessageRenderer,
  Column,
  Text,
  TextField,
  Button,
} from '@novasamatech/product-react-renderer';

function SearchForm() {
  const [query, setQuery] = useState('');

  function handleSubmit() {
    // send the query somewhere
  }

  return (
    <Column padding={16}>
      <TextField value={query} placeholder="Search…" onValueChange={setQuery} />
      <Button text="Search" variant="primary" onClick={handleSubmit} />
    </Column>
  );
}

chat.onCustomMessageRenderingRequest(
  registerChatMessageRenderer(
    () => undefined,
    () => <SearchForm />,
  ),
);
```

### Using messageId and messageType

Both are forwarded to `renderFn` so you can adapt the UI per message:

```tsx
import { registerChatMessageRenderer, Text } from '@novasamatech/product-react-renderer';

chat.onCustomMessageRenderingRequest(
  registerChatMessageRenderer(
    () => undefined,
    ({ messageId, messageType }) => (
      <Text color="textSecondary">
        [{messageType}] {messageId}
      </Text>
    ),
  ),
);
```

---

## `createRenderer`

The low-level primitive that `registerChatMessageRenderer` is built on. Use it directly when you need to manage the renderer lifecycle yourself or integrate it into a custom pipeline outside of the chat system.

`createRenderer` returns an object with two methods:

| Method | Description |
|--------|-------------|
| `mount(node)` | Render (or re-render) the given React node |
| `unmount()` | Tear down the React tree and release all resources |

### Basic usage

```tsx
import { createRenderer, Column, Text, Button } from '@novasamatech/product-react-renderer';

const renderer = createRenderer({
  // Called after every commit with the serialized widget tree.
  onRender(node) {
    send(node);
  },

  // Subscribe to events from the host.
  // Return an unsubscribe function.
  subscribeActions: (callback) => {
    return actionsSubscription.subscribe((actionId, payload) => {
      callback(actionId, payload);
    });
  },
});

// Mount the initial tree.
renderer.mount(
  <Column>
    <Text style="headline">Hello</Text>
    <Button text="OK" onClick={() => console.log('clicked')} />
  </Column>,
);

// Unmount when done — cleans up the React tree and unsubscribes from actions.
renderer.unmount();
```

### Re-mounting with new content

`mount` can be called multiple times to update the tree. React reconciles the difference, preserving component state where the component type is the same.

```tsx
// First render
renderer.mount(<Text style="headline">Loading…</Text>);

// Later — update in place
renderer.mount(<Text style="headline">Done!</Text>);
```

### Manual integration with `onCustomMessageRenderingRequest`

This is what `registerChatMessageRenderer` does internally. Writing it manually gives you full control over the teardown sequence:

```tsx
import { createRenderer, Text } from '@novasamatech/product-react-renderer';

chat.onCustomMessageRenderingRequest(({ messageId, messageType, payload, subscribeActions }, render) => {
  const renderer = createRenderer({ onRender: render, subscribeActions });

  renderer.mount(<Text style="headline">{messageType}</Text>);

  // Return the cleanup callback.
  return () => {
    renderer.unmount();
  };
});
```
