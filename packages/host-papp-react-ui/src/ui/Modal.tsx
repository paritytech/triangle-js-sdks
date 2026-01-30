import { Content, Overlay, Portal, Root, Title } from '@radix-ui/react-dialog';
import type { PropsWithChildren } from 'react';

import styles from './Modal.module.css';

type Props = PropsWithChildren<{
  open: boolean;
  onOpenChange(isOpen: boolean): void;
  width: number | string;
  container?: HTMLElement;
}>;

export const Modal = ({ open, onOpenChange, width, container, children }: Props) => {
  if (!open) {
    return null;
  }

  return (
    <Root modal open={open} onOpenChange={onOpenChange}>
      <Portal container={container}>
        <Overlay className={styles.backdrop}>
          <Content className={styles.modal} style={{ width }} aria-describedby={undefined}>
            <Title style={{ display: 'none' }}>Modal</Title>
            {children}
          </Content>
        </Overlay>
      </Portal>
    </Root>
  );
};
