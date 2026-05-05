import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    'packages/*': {
      project: ['src/**/*.ts', 'src/**/*.tsx'],
    },
    'packages/host-papp': {
      entry: ['__tests__/**/*.ts'],
      project: ['src/**/*.ts', 'src/**/*.tsx', '__tests__/**/*.ts'],
    },
    'packages/host-papp-react-ui': {
      entry: ['src/**/*.stories.tsx'],
      project: ['src/**/*.ts', 'src/**/*.tsx'],
    },
    'packages/product-react-renderer': {
      project: ['src/**/*.ts', 'src/**/*.tsx'],
    },
  },
  ignore: ['__tests__/**'],
  ignoreDependencies: ['ts-node', 'tslib'],
  nx: true,
  typescript: true,
  vitest: true,
  vite: true,
};

export default config;
