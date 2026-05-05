import { ThemeProvider, Toaster, defaultTheme } from '@novasamatech/tr-ui';
import type { Preview } from '@storybook/react';

// @ts-expect-error css imports are not defined here
import '@novasamatech/tr-ui/styles.css';

const preview: Preview = {
  decorators: [
    Story => (
      <ThemeProvider defaultMode="light" theme={defaultTheme}>
        <Story />
        <Toaster />
      </ThemeProvider>
    ),
  ],
};

export default preview;
