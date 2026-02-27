import type { SigningPayloadRequest, UserSession } from '@novasamatech/host-papp';
import { createPappAdapter } from '@novasamatech/host-papp';
import { Button } from '@novasamatech/tr-ui';
import { AccountId } from '@polkadot-api/substrate-bindings';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { PairingModal } from './flow/PairingModal.js';
import { PairingPopover } from './flow/PairingPopover.js';
import { PappProvider } from './flow/PappProvider.js';
import { useSessionIdentity } from './hooks/identity.js';
import { useAuthentication } from './providers/AuthProvider.js';
import { useSession } from './providers/SessionsProvider.js';

const SignPayloadExample = ({ session }: { session: UserSession | null }) => {
  if (!session) {
    return null;
  }

  const payload: SigningPayloadRequest = {
    address: AccountId().dec(session.remoteAccount.accountId),
    blockHash:
      '0x307834313431326534363632336332303064373838616237656631633530376334333439306664613263613762343863313966383665613961343663663963616138',
    blockNumber: '0x30783030333538626132',
    era: '0x307832343030',
    genesisHash:
      '0x307836376661313737613039376266613138663737656139356162353665396263646665623065356238613430653436323938626239336531366236666335303038',
    method: '0x0a03006a785be5767a80b718bd64412b2b72153119cd453ad65c2b1d8624efbc64c5360700e40b5402',
    nonce: '0x30783030303030303030',
    specVersion: '0x30783030316538343830',
    tip: '0x30783030303030303030303030303030303030303030303030303030303030303030',
    transactionVersion: '0x30783030303030303030',
    signedExtensions: [
      'CheckNonZeroSender',
      'CheckSpecVersion',
      'CheckTxVersion',
      'CheckGenesis',
      'CheckMortality',
      'CheckNonce',
      'CheckWeight',
      'ChargeTransactionPayment',
      'CheckMetadataHash',
    ],
    version: 4,
    assetId: undefined,
    mode: undefined,
    metadataHash: undefined,
    withSignedTransaction: false,
  };

  return (
    <Button onClick={() => session.signPayload(payload).match(console.log, console.error)}>Example sign request</Button>
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
        <SignPayloadExample session={session} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PairingPopover>
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
      metadata: 'https://shorturl.at/zGkir',
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
