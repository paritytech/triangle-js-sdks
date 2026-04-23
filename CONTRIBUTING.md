# Contributing

## Reporting Issues

If you have found what you think is a bug,
please [file an issue](https://github.com/paritytech/triangle-js-sdks/issues/new).

## Host API Requests

Host API change requests should be raised in [truapi-explorer](https://github.com/paritytech/truapi-explorer).

## Design Documents

Canonical design documentation lives in `docs/design/`. To propose updates or add new design docs:

1. Edit or add a file in `docs/design/`
2. Include YAML frontmatter (`title`, `type: design`, `status`, `author`, `created`, `pr`)
3. Open a PR with the `design-doc` label

## Development

If you have been assigned to fix an issue or develop a new feature, please follow these steps to get started:

- Fork this repository.
- Install dependencies

  ```shell
  npm install
  ```

  - We use [nvm](https://github.com/nvm-sh/nvm) to manage node versions - please make sure to use the version mentioned
    in `.nvmrc`

    ```shell
    nvm use
    ```

- Build all packages.

  ```shell
  npm run build
  ```

- Run development server.

  ```shell
  npm run build:watch
  ```

- Implement your changes and tests in files in the `packages/` and `__tests__` directories.
- Document your changes in the appropriate doc page.
- Git stage your required changes and commit (see below commit guidelines).
- Submit PR for review.

## Pull requests

Maintainers merge pull requests by squashing all commits and editing the commit message if necessary using the GitHub
user interface.

Use an appropriate commit type. Be especially careful with breaking changes.
