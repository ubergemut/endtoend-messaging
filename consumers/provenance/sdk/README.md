# Independent EndToEnd MIT SDK 0.2.1

This source and built-ESM package contains only the first-party MIT protocol and transport client. Wire protocol stays v1. No AGPL messaging engine, cryptography library, private application, user state or installed tool is included. Original MIT grants remain in both workspaces and LICENSE.

Install declared tools with Yarn 1.22.22: `yarn install --frozen-lockfile --ignore-scripts --non-interactive`; build with `yarn build`; test with `yarn test`. The lock selects byte-identical existing release tool resolutions; installation runs no lifecycle scripts. TypeScript and tsx are development tools downloaded normally and are not bundled. The shipped ESM and declarations need only the MIT protocol/client packages at runtime.

Plain JavaScript imports `@e2ee/client/standalone` and `@e2ee/protocol/standalone`; TypeScript source development retains the original package entries. See [contract](docs/architecture/SDK_CONTRACT_V1.md) and [browser consumer supplement](docs/architecture/BROWSER_CONSUMER_V1.md).

The full-repository interoperability test `packages/client/test/reference.test.ts` launches the separate AGPL agent/relay and is deliberately omitted here. Its omission does not remove SDK runtime source. Included tests cover transport lifecycle, HTTP security, public relay exchange, MIT CLI, contract validation, isolated built JavaScript and public declarations. Server deployment, encryption, device vaults and the frontend licensing assessment remain outside this SDK artifact.
