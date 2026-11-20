# @novasamatech/host-papp-react-ui

React bindings and pairing UI for [`@novasamatech/host-papp`](../host-papp/README.md).

## Overview

The package wraps a `PappAdapter` in React context and ships the pairing UI on top of it:

- `PappProvider` — provides the adapter, the authentication state and the paired sessions to the tree;
- `PairingModal`, `PairingPopover`, `QrCode` — the pairing flow UI;
- `useAuthentication`, `useAuthStatus`, `useSession` — authentication and session state;
- `useIdentity`, `useSessionIdentity` — on-chain identity lookups.

## Installation

```shell
npm install @novasamatech/host-papp-react-ui --save -E
```
