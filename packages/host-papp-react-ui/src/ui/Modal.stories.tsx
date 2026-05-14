import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Modal } from './Modal.js';
import { QrCode } from './QrCode.js';
import * as QrCodeStories from './QrCode.stories.js';

const meta: Meta<typeof Modal> = {
  component: Modal,
  title: 'Modal',
  render({ width, children }) {
    const [open, setOpen] = useState(false);

    return (
      <>
        <button onClick={() => setOpen(true)}>Open Modal</button>
        <Modal open={open} onOpenChange={setOpen} width={width}>
          {children}
        </Modal>
      </>
    );
  },
};

export default meta;

type Story = StoryObj<typeof Modal>;

export const Default: Story = {
  args: {
    width: 'fit-content',
    children: (
      <div style={{ padding: 16 }}>
        {/* @ts-expect-error nullable args */}
        <QrCode {...QrCodeStories.Default.args} theme="dark" />
      </div>
    ),
  },
};
