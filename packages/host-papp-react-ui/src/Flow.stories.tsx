import type { CreateTransactionRequest, HostMetadata, UserSession } from '@novasamatech/host-papp';
import { createPappAdapter } from '@novasamatech/host-papp';
import { fromHex, toHex } from '@novasamatech/scale';
import { createLazyClient } from '@novasamatech/statement-store';
import { Button, ScrollArea } from '@novasamatech/tr-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { getWsProvider } from 'polkadot-api/ws';
import { useState } from 'react';

import { PairingModal } from './flow/PairingModal.js';
import { PairingPopover } from './flow/PairingPopover.js';
import { PappProvider } from './flow/PappProvider.js';
import { useSessionIdentity } from './hooks/identity.js';
import { useAuthentication } from './providers/AuthProvider.js';
import { useSession } from './providers/SessionsProvider.js';

const SignTransactionExample = ({ session }: { session: UserSession | null }) => {
  const [pending, setPending] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  if (!session) {
    return null;
  }

  const request: CreateTransactionRequest = {
    payload: {
      tag: 'v1',
      value: {
        signer: ['test-product.dot', 0],
        genesisHash: fromHex('0xc5af1826b31493f08b7e2a823842f98575b806a784126f28da9608c68665afa5'),
        // SCALE-encoded Call (module + function + params); arbitrary bytes for the example.
        callData: new Uint8Array([0x0a, 0x03, 0x00, 0x6a, 0x78, 0x5b, 0xe5]),
        // Let the implementer infer the extensions for this example.
        extensions: [],
        // Extrinsic V4 → must be 0.
        txExtVersion: 0,
      },
    },
  };

  const sign = () => {
    setPending(true);
    session.createTransaction(request).match(
      response => {
        setPending(false);
        setLog(logs => logs.concat(`Response: ${toHex(response)}`));
      },
      error => {
        setPending(false);
        setLog(logs => logs.concat(`Error: ${error}`));
      },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={sign} disabled={pending}>
        Example create transaction
      </Button>
      <ScrollArea>
        <pre>{log.join('\n')}</pre>
      </ScrollArea>
    </div>
  );
};

const ConnectButton = () => {
  const auth = useAuthentication();
  const { session } = useSession();
  const [identity, pending] = useSessionIdentity(session);

  if (session) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>{identity?.fullUsername ?? identity?.liteUsername ?? (pending ? 'Loading...' : 'Unknown user')}</span>
          <Button onClick={() => auth.disconnect(session)}>Disconnect</Button>
        </div>
        <SignTransactionExample session={session} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PairingPopover theme="light" size={210}>
        <Button onClick={() => auth.authenticate('popover')}>Open auth Popover</Button>
      </PairingPopover>
      <Button onClick={() => auth.authenticate('modal')}>Open auth Modal</Button>
    </div>
  );
};

const meta: Meta<typeof PappProvider> = {
  component: PappProvider,
  title: 'flow/PappProvider',
  args: {
    adapter: createPappAdapter({
      appId: 'https://test.com',
      adapters: {
        lazyClient: createLazyClient(getWsProvider('wss://paseo-people-next-system-rpc.polkadot.io')),
      },
      hostMetadata: {
        hostName: 'Storybook',
        hostVersion: '1.2.3',
        platformType: 'macOS',
        platformVersion: '14.4.1',
      } satisfies HostMetadata,
    }),
  },
  render({ adapter }) {
    return (
      <>
        <PappProvider adapter={adapter}>
          <ConnectButton />
          <PairingModal />
        </PappProvider>
      </>
    );
  },
};

export default meta;

type Story = StoryObj<typeof PappProvider>;

export const Default: Story = {};
