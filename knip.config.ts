import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    '.': {
      entry: ['__tests__/**/*.ts'],
      project: ['__tests__/**/*.ts'],
    },
    'packages/*': {
      entry: ['src/index.ts', 'src/**/*.spec.ts', '__tests__/**/*.ts'],
      project: ['src/**/*.ts', '__tests__/**/*.ts'],
    },
    'packages/host-papp-react-ui': {
      entry: ['src/index.ts', 'vite.config.ts', 'src/**/*.stories.tsx'],
      project: ['src/**/*.ts'],
    },
  },
  ignore: ['**/.papi/**'],
  nx: true,
  typescript: true,
  vitest: true,
  vite: true,
};

export default config;
