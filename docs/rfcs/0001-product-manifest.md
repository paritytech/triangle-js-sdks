# RFC: Product Manifest Format

## Summary

This RFC defines a two-level product manifest used by Polkadot Hosts to discover, validate, and launch product executables.

- The **root manifest** carries product-wide metadata (displayName, icon, description) and lives at the product's dotNS base name. Authorship is read from dotNS itself (the on-chain owner of the name) rather than declared in the manifest.
- One or more **executable manifests** describe individual executables (App, Widget, Worker). Each pins a product-defined version and a Bulletin-chain CID for the executable artifact, and lives at a well-known subname of the base name (`app.<product_id>.dot`, `widget.<product_id>.dot`, `worker.<product_id>.dot`).

Manifests are JSON, stored inline in dotNS text records; referenced binary content (executable bytes, icons) lives on the Bulletin chain and is addressed by CID.

## Motivation

### Background

The Polkadot ecosystem renders third-party applications inside first-party user-agents — **Hosts** (Polkadot Desktop, Polkadot Mobile, the Polkadot Website).
A third-party application is called a **Product**, owned by its developer rather than any single Host.

A product can expose one or more **modalities**, each a distinct user-facing surface:

- **App** — full-screen web application.
- **Widget** — small web application mounted on a dashboard.
- **Pocket** — passive surfaces such as cards, tickets, or certificates, served by a background JS worker.
- **Chat** — chat bots and chat-room integrations, also served by a background JS worker.

A modality is delivered by an **executable**. v1 defines three executable types:

- **App** — the web application backing the App modality.
- **Widget** — the web application backing the Widget modality.
- **Worker** — a single background process backing Pocket and/or Chat (see [Why one Worker, not per modality](#executable-manifest-v1)).

Throughout this RFC, *modality* means a user-facing surface; *executable* means a deployable artifact.

Two on-chain systems sit under this RFC:

- **Bulletin chain** — stores binary blobs. Each blob is content-addressed by an identifier ("CID") that doubles as its integrity check. Executable artifacts and product icons live there.
- **dotNS** — Polkadot's on-chain naming system, implemented as contracts on Asset Hub. A name owns text records that hold small structured metadata. Manifests live there.

### Requirements

For a Host to discover, verify, and launch a product, it needs a static, on-chain, authenticated description binding a dotNS name to a specific executable revision. Without a standardized manifest, every Host invents its own discovery convention. The manifest format must therefore:

1. Provide static product-wide metadata: displayName, icon, and description.
2. Provide, for each executable, a version and content identifier sufficient to fetch and verify the artifact.
3. Be discoverable through a storage call or JSON-RPC call to a node.
4. Be encoded in a format any client environment can parse with off-the-shelf tooling.
5. Fit inside dotNS text records as a single inline payload.
6. Be versionable.

## Explanation

### Overview

A product is rooted at a **dotNS base name** (e.g. `hackm3.dot`). The base name's text records carry the **root manifest**. Each executable is rooted at a well-known **subname** of the base name (e.g. `widget.hackm3.dot`), whose text records carry the corresponding **executable manifest**.

**Terminology.** `<product_id>` is the label portion of the base name (`hackm3` for `hackm3.dot`).

```
hackm3.dot                  → root manifest (displayName, icon, description)
app.hackm3.dot              → executable manifest (App)
widget.hackm3.dot           → executable manifest (Widget)
worker.hackm3.dot           → executable manifest (Worker; serves Pocket and/or Chat)
```

A Host discovers a product's executables by querying these subnames. Absence of a subname means the product does not provide that executable.

### Encoding and storage

Manifests are encoded as **UTF-8 JSON** and stored **inline** in a single, well-known text record key on the (sub)name: the value of that text record is the manifest JSON itself. All binary references in the manifest are short CID strings; no binary payloads are inlined.

The text-record key is fixed by this RFC:

| Subject                            | Text-record key |
|------------------------------------|-----------------|
| Root manifest (on the base name)   | `manifest`      |
| Executable manifest (on a subname) | `executable`    |

Hosts MUST query exactly these keys; publishers MUST write under exactly these keys. Keeping them distinct means a wrong-layer query (e.g. `manifest` on `app.<product_id>.dot`) returns an empty value instead of partially parsing a payload of the wrong shape.

A v1 root manifest is well under 1 KB; an executable manifest is ~200 B. Manifests fit within typical text-record budgets; the exact figure will be confirmed by the dotNS team's Proof-of-Concept (see [Unresolved Questions](#unresolved-questions)). v1 defines no preimage fallback: a manifest that cannot fit MUST be shrunk by the publisher.

### Versioning

Every manifest carries `$v` as its first field — a numeric schema-version discriminator. This RFC defines `$v: 1`. Hosts MUST treat any manifest whose `$v` they do not recognise as an undiscoverable product: skip it, surface a diagnostic, and keep working.

### Root manifest (v1)

The root manifest describes the product as a whole and is the resolution entry point: a Host parses it first, then probes for executable subnames.

```typescript
type RootManifest = {
  $v: 1;
  displayName: string;    // Human-readable product name. UTF-8.
  description: string;    // Short description shown in launchers/lists.
  icon: Icon;             // Product icon used by every Host surface.
};

type Icon = {
  cid: string;            // Raw Bulletin-chain CID; used verbatim to fetch icon bytes.
  format: 'jpeg' | 'png';
};
```

The icon is always deployed on the Bulletin chain — there is no inline-icon variant in v1. Hosts MUST verify fetched icon bytes against `cid` per the chain's content-addressing rules. An unknown `format` MUST be treated as a malformed manifest.

### Executable manifest (v1)

An executable manifest describes one deployable artifact and lives on a well-known subname keyed by its executable type.

```typescript
type ExecutableManifest =
  | AppManifest
  | WidgetManifest
  | WorkerManifest;

type CommonExecutableFields = {
  $v: 1;
  appVersion: SemVer;     // Product-defined SemVer of this executable.
};

type AppManifest = CommonExecutableFields & {
  kind: 'app';
};

type WidgetManifest = CommonExecutableFields & {
  kind: 'widget';
  description?: string;          // Optional tagline shown on the widget card.
  dimensions: {
    height: number[];            // Supported grid-step heights the widget can render at.
    width?: number;              // Grid-step width. Optional; defaults to 1 column.
  };
};

type WorkerManifest = CommonExecutableFields & {
  kind: 'worker';
  entrypoint: string;                              // Path to the worker entry module inside the executable directory.
  includes: Record<'chat' | 'pocket', boolean>;    // Which user-facing surfaces this worker serves.
};

type SemVer = [major: number, minor: number, patch: number, build?: string];
// e.g. [1, 0, 0] or [1, 0, 0, '<build identifier, e.g. commit hash>']
```

- `app` — full-screen App. No extra fields beyond the common ones.
- `widget` — `dimensions.height` is the list of grid-step heights the widget can render at; the Host picks one per layout. `width` defaults to `1` column. The grid unit and bounds belong to the Host's dashboard spec (see [Future Directions](#future-directions)). By convention `8` in `height` signals a full-screen widget; this RFC does not normalise that convention.
- `worker` — background JS worker. `entrypoint` is the module the Host loads inside the worker. `includes` declares which user-facing surfaces this worker serves: `{ chat: true }` means a Host MAY expose "open chat" affordances for the product; `{ pocket: true }` means a Host MAY expose Pocket-artifact navigation; both `true` means the worker serves both. At least one of `includes.chat` / `includes.pocket` MUST be `true` — a worker that serves neither is not a valid v1 executable.

Publishers MUST set `kind` to match the subname label the manifest is written under: `app` under `app.<product_id>.dot`, `widget` under `widget.<product_id>.dot`, `worker` under `worker.<product_id>.dot`. Hosts MUST reject a manifest whose `kind` does not match the subname it was read from.

**Why one Worker, not per modality.** A Worker is the product's single background process, carrying its full Host-API surface (signing, notifications, chain access, long-lived caches). Those capabilities do not split cleanly along the Pocket-vs-Chat boundary, and two bundles would duplicate the surface and make the product's on-chain signing identity ambiguous. `includes` only advertises which user-facing affordances the same process serves; the executable remains a single artifact.

### Executable structure (v1)

The executable manifest's `cid` points at the bytes; this section defines what those bytes contain. Runtime APIs a Host exposes to a running executable (chain access, message passing, lifecycle hooks, etc.) are out of scope here — those belong in per-modality runtime contracts. No such contract is drafted as of v1; the App, Widget, and Worker runtime contracts will land in follow-up RFCs (**TBD**).

**App and Widget.** Single-page web applications, packaged as a directory whose root contains an `index.html` file. The Host treats `index.html` as the entry point and loads it to launch the modality. Relative paths inside `index.html` (scripts, styles, images) resolve against the same Bulletin IPFS gateway root from which the executable was fetched.

**Worker.** A directory of JavaScript files. The executable manifest's `entrypoint` field names the entry-point module as a path relative to the directory root (e.g. `index.js`, `src/worker.js`). The Host loads that module into a JS worker runtime to launch the modality. Other files referenced from the entry module (static imports, dynamic-import paths, asset URLs) resolve against the same Bulletin IPFS gateway root.

### Subname convention

| Subname                   | Carries                    |
|---------------------------|----------------------------|
| `app.<product_id>.dot`    | App executable manifest    |
| `widget.<product_id>.dot` | Widget executable manifest |
| `worker.<product_id>.dot` | Worker executable manifest |

A product MAY publish any combination of these subnames; absence of a subname means the product does not provide that executable.

For each executable type the Host can render, it MUST query the corresponding subname to discover whether the product provides that executable. A Host with no surface for an executable type (e.g. a CLI Host has no dashboard for widgets) MAY skip the corresponding subname.

### Corner cases

- **Icon unreachable or its bytes do not match the declared `format`.** Treat the icon as malformed and render a placeholder; do not sniff or auto-correct. The product remains launchable.
- **Missing root manifest but present executable subnames.** Product is not discoverable; executables MUST NOT be launched.
- **Unknown `kind` in an executable manifest.** Skip that executable rather than fail the whole product.
- **`kind` does not match the subname label** (e.g. `kind: 'app'` read from `worker.<product_id>.dot`). Treat the executable as malformed and skip it; do not coerce to the subname's label.
- **Manifest payload exceeds the dotNS text-record budget.** dotNS rejects the write at wire level (see [Security § Size cap at publishing](#security)); Hosts never observe oversized records in practice.

## Implementation basics

The parameters, constants, and transport mechanics in this section are shared by both Publisher and Host implementations. Each role uses a subset of them; the role sections that follow call out which.

### Parameters

Everything in this list is a **parameter** the implementation accepts as input; chains and contract deployments may change between environments.

- **dotNS smart contract.** A smart contract called through Revive pallet (Asset Hub on current testnets). Publishers need the chain's RPC endpoint for both reads and writes; Hosts need it for dry-run reads only.
- **Contract addresses on the dotNS chain.** Publishers need the registry (`IDotnsRegistry`) and the content resolver (`IDotnsContentResolver`). Hosts need only the registry; the resolver address for any given node is discovered through `IDotnsRegistry.resolver(node)`, not configured.
- **Bulletin chain.** A separate Polkadot chain hosting the `TransactionStorage` pallet. Publishers submit upload extrinsics here; Hosts never contact Bulletin RPC directly.
- **Bulletin IPFS gateway.** HTTP base URL used to read bytes back from Bulletin by CID — e.g. `https://paseo-ipfs.polkadot.io` on testnets. Hosts use it to fetch executable and icon bytes; publishers use it for the Step 8 verify probe.
- **Signing key.** A Polkadot account key, used for dotNS and Bulletin transactions via the standard Polkadot transaction flow. Publishers only — Hosts only read and need no signing key.

### Constants

Fixed by the Bulletin chain protocol; identical across every publisher and Host.

| Constant       | Value              | Meaning                                       |
|----------------|--------------------|-----------------------------------------------|
| CID version    | `1`                | CIDv1                                         |
| Multicodec     | `0x55` (`raw`)     | Stored bytes addressed as raw payload         |
| Multihash code | `0x12` (`sha-256`) | Hash algorithm used to derive the CID         |
| Digest length  | `32` bytes         | Output size of the SHA-256 digest             |

A Bulletin CID is therefore `CIDv1(raw, sha256(data))`. Its encoded length is fixed, which makes the publisher's Step 2 size preflight deterministic.

### dotNS transport

**Names and nodes.** Prose in this RFC speaks in **subnames** — dotted labels like `widget.hackm3.dot`. The dotNS contract API does not: every read and write addresses a node by its **subnode**, the ENS-style namehash of the dotted label as a `bytes32`. Implementations compute `namehash(subname)` once at each call site and pass the resulting `bytes32` into the contract call. Calls that accept a parent node plus a child label (`setSubnodeOwner`, `setSubnodeResolver`) take the parent's `bytes32` namehash directly and the child label as a string; the contract derives the child subnode internally.

Every dotNS contract call is composed as ABI-encoded calldata and dispatched through the dotNS chain's `pallet-revive`:

- **Reads** (`owner`, `resolver`, `text`): wrap the calldata in a `ReviveApi.call(...)` dry-run RPC; ABI-decode the result. Used by both publishers and Hosts.
- **Writes** (`setResolver`, `setSubnodeOwner`, `setSubnodeResolver`, `setText`): the same calldata is sent as a signed Substrate extrinsic that invokes `pallet-revive::call(...)`. Fees and nonce are handled by the normal transaction flow. Publishers only.

## Publisher implementation

The **publisher** is the entity that publishes a product — a CLI, build script, GitHub Action, web UI, IDE plugin, or any other form running autonomously or in tandem with a developer who supplies the signing key. Any form is valid provided it executes Steps 1–8 below against the parameters and transport defined in [Implementation basics](#implementation-basics).

### Step 1 — Read the local product config

The publisher reads a local config file authored and source-controlled by the developer. The on-disk encoding (e.g. JSON, YAML, TOML) is a tooling decision and not normative. As an illustration of the shape the publisher needs in hand before Step 2, a hypothetical TypeScript form:

```typescript
type LocalProductConfig = {
  productName: string; // dotNS base name (e.g. "hackm3.dot").
  displayName: string; // Human-readable product name (e.g. "HackM3"). Becomes RootManifest.displayName verbatim.
  description: string; // Short description of the product.
  icon: string; // Path to the icon file on disk. Uploaded to Bulletin, which stores raw bytes with no metadata — so the publisher MUST also surface the icon's format (`"jpeg"` | `"png"`) for the manifest's `Icon.format` field, either as a separate config field or by deriving it from the file extension. This RFC does not specify which approach is taken.
  app?: AppConfig;
  widget?: WidgetConfig;
  worker?: WorkerConfig;
};

type AppConfig = {
  root: string; // Path to the executable directory on disk.
  appVersion: SemVer; // Same SemVer tuple as the matching ExecutableManifest.
};

type WidgetConfig = {
  root: string; // Path to the executable directory on disk.
  appVersion: SemVer; // Same SemVer tuple as the matching ExecutableManifest.
  description?: string; // Optional tagline shown on the widget card.
  dimensions: {
    height: number[]; // Supported grid-step heights the widget can render at.
    width?: number; // Grid-step width. Optional; defaults to 1 column.
  };
};

type WorkerConfig = {
  root: string; // Path to the executable directory on disk.
  appVersion: SemVer; // Same SemVer tuple as the matching ExecutableManifest.
  entrypoint: string; // Path to the worker entry module inside the executable directory.
  includes: Record<'chat' | 'pocket', boolean>; // Same shape as WorkerManifest.includes; at least one MUST be true.
};
```

Each executable field (`app`, `widget`, `worker`) is optional — omitting it means that executable is not part of this publish operation.

### Step 2 — Validate the local config

The publisher validates the local config before any network I/O:

- All referenced files (icon, executables) exist and are readable.
- Icon `format` is one of the values allowed by `Icon.format`.
- `appVersion` is a 3- or 4-element tuple of the right shape.
- Each executable's kind-specific fields are present, well-typed, and satisfy schema-level constraints.
- Pessimistic size preflight: compose each manifest with a placeholder CID of the fixed encoded length (per the [Constants](#constants) table). Abort if any composed manifest exceeds the dotNS text-record budget.

Local validation failures abort the publish with a human-readable error. No partial state is written on-chain.

### Step 3 — Preflight on-chain state

Before submitting any Bulletin transactions, the publisher confirms both chains are ready: the dotNS records that will be written can be written, and the signing key is authorized to submit Bulletin uploads.

#### 3.1 Ownership of the base name

Read `IDotnsRegistry.owner(namehash("<product_id>.dot"))`. If it is not the publisher's signing-key address, abort — this covers both `address(0)` (unregistered; acquisition is out of scope) and any other owner (belongs to someone else).

#### 3.2 Resolver on the base name

The dotNS registrar installs the **reverse-resolver** contract as every fresh node's default resolver. The reverse resolver only implements `nameOf` / `setReverseName` — it cannot store text records — so the publisher MUST redirect the slot to the content resolver.

Read `IDotnsRegistry.resolver(namehash("<product_id>.dot"))`; if it isn't the content-resolver address from [Implementation basics](#implementation-basics), call `IDotnsRegistry.setResolver(namehash("<product_id>.dot"), <content-resolver address>)`. On re-publish this is a no-op read.

#### 3.3 Subnames for each executable

For each executable being published, ensure the corresponding subname (`app.<product_id>.dot`, `widget.<product_id>.dot`, or `worker.<product_id>.dot`) exists with the publisher as owner. If not, call `IDotnsRegistry.setSubnodeOwner({ parentNode, subLabel, parentLabel, owner })` with the publisher's address as owner.

`setSubnodeOwner` installs the reverse resolver on fresh subnodes (same default as base names), so each subnode also needs its resolver redirected: call `IDotnsRegistry.setSubnodeResolver({ parentNode, subLabel, parentLabel, resolver: <content-resolver address> })` (or `setResolver(subnode, …)` once the subnode is owned by the publisher).

**Idempotency.** If a subnode already exists with the publisher as owner, skip the creation call. If it is owned by another account, abort — the publisher MUST NOT modify subnames it does not own.

#### 3.4 Bulletin storage authorization

Confirm the signing key is authorized to submit `TransactionStorage.store_with_cid_config(...)` extrinsics on the Bulletin chain. Read storage map `TransactionStorage.Authorizations` keyed by the enum variant `Account(<signer-address>)`:

```typescript
const auth = await api.query.TransactionStorage.Authorizations.getValue(Enum("Account", signerAddress));
```

The returned record has shape `{ extent: { transactions_allowance, transactions, bytes_allowance, bytes }, expiration }`, or `undefined` if the account has never been authorized. The signing key is usable iff:

- the record exists,
- `expiration > currentBlock`, and
- the remaining capacity (`transactions_allowance − transactions`, `bytes_allowance − bytes`) covers the planned upload (chunks-needed and total-bytes for the icon + every executable in this publish operation).

Granting is out-of-band via `TransactionStorage.authorize_account({ who, transactions, bytes })`. On testnet, the well-known `//Alice` keypair holds the authorization authority and a testnet publisher MAY self-grant. On mainnet `//Alice` has no such authority; authorization MUST come from a production-role account, and the request mechanism (portal, governance proposal, operator extrinsic, …) is **TBD** alongside the mainnet Bulletin deployment.

### Step 4 — Upload assets to the Bulletin chain

The Bulletin chain's transaction-storage pallet stores one chunk per signed extrinsic, returning a content identifier derived from the bytes under the given `codec` / `hashing`:

```
TransactionStorage.store_with_cid_config({ cid: { codec, hashing }, data })
```

Larger artifacts are merkleized first: bytes are chunked and arranged into a Merkle DAG with a single root CID (serialised as a CAR — Content-Addressed aRchive). Two kinds of artifacts go through the same flow:

1. **The product icon.** Read the icon file from disk, merkleize (typically a single chunk for small images), and upload each chunk via `store_with_cid_config`. The resulting root CID becomes the root manifest's `icon.cid`.
2. **Each executable.** For each executable type (App, Widget, Worker) being published, read the executable directory, merkleize into a CAR, and upload each chunk via `store_with_cid_config`. The chain does not deduplicate server-side, so the publisher MUST probe each chunk's CID against the chain or its IPFS gateway and skip any that are already present. The resulting root CID becomes the executable manifest's `cid`.

Assets that fail to upload abort the publish. Re-running the publish is safe: chunks already on-chain are re-addressable by their CID and skipped on retry.

### Step 5 — Compose manifests

With every CID in hand, the publisher constructs:

- One **root manifest** JSON conforming to `RootManifest`, with the icon's `cid` and `format` substituted in.
- One **executable manifest** JSON per executable conforming to the matching `AppManifest` / `WidgetManifest` / `WorkerManifest` shape, with the executable's `cid` substituted in.

All payloads start with `$v: 1`.

### Step 6 — Validate the manifests

Before any dotNS write, the publisher:

1. Parses each composed JSON back through the v1 JSON Schema to confirm conformance.
2. Computes the UTF-8 byte length of each manifest and rejects any that exceed the dotNS text-record budget (the exact figure is still TBD — see [Unresolved Questions](#unresolved-questions)).

Either check failing aborts the publish before on-chain writes begin (see [Security § Size cap at publishing](#security)).

### Step 7 — Write the manifests

`IDotnsContentResolver.setText(node, key, value)` is a **hard override**: it overwrites the previous value in full, no merge or history. Re-publishing replaces the previous manifests; the Bulletin bytes they referenced remain on-chain, unreferenced.

To enable rollback, the publisher first **snapshots** every text record it will touch by reading the current value via `IDotnsContentResolver.text(node, key)`:

| Node                                  | Key          | Snapshot of                         |
|---------------------------------------|--------------|-------------------------------------|
| `namehash("<product_id>.dot")`        | `manifest`   | Existing root manifest (if any)     |
| `namehash("app.<product_id>.dot")`    | `executable` | Existing App executable manifest    |
| `namehash("widget.<product_id>.dot")` | `executable` | Existing Widget executable manifest |
| `namehash("worker.<product_id>.dot")` | `executable` | Existing Worker executable manifest |

Empty strings indicate first-time publish for that record.

The publisher then submits one `setText(...)` per row, writing the newly composed JSON. The writes are independent and SHOULD be batched into a single signed extrinsic via `Utility.batchAll`, so all manifests are written in a single block or the entire batch fails atomically.

**Rollback on partial failure.** If any `setText` fails after a previous one succeeded, the publisher MUST issue `setText(node, key, snapshot)` for every record already overwritten this run, then abort with a diagnostic naming the final state of every record. The product ends up either fully restored to the pre-publish state, or in a documented intermediate state the developer can recover from manually.

### Step 8 — Verify

After all writes confirm, the publisher re-runs the resolution flow described in [Host implementation](#host-implementation) against the base name and asserts:

- Every manifest is readable via `text(node, key)` and matches the JSON the publisher just wrote.
- Every manifest round-trips through schema validation.
- Every `cid` referenced from the manifests is reachable on the Bulletin chain. Two equivalent probes: an HTTP `HEAD <gateway>/ipfs/<cid>` returning 2xx, or an on-chain read of `TransactionStorage.TransactionByContentHash(Blake2_128_Concat(content_hash))` returning a non-empty entry. The HTTP probe is faster; the on-chain probe is authoritative.

If any assertion fails, treat as a write failure: trigger the snapshot-restore path from Step 7's *Rollback on partial failure*, then abort with a diagnostic.

## Host implementation

How a Host resolves a product, from a dotNS name to validated manifests and launchable executable bytes. The parameters and transport used here are defined in [Implementation basics](#implementation-basics); a Host needs the dotNS smart-contract RPC endpoint, the registry address, and the Bulletin IPFS gateway, but no signing key (every dotNS call below is a dry-run, and Bulletin fetches go through HTTP).

### Resolving a product

For a base name `B`:

1. **Compute the node hash.** `node = namehash(B)` using the ENS-style namehash algorithm. `bytes32`.
2. **Find the resolver.** Read `IDotnsRegistry.resolver(node)`. Returns the address of the resolver holding records for the node. `address(0)` → product does not exist; surface a diagnostic.
3. **Read the root manifest.** Read `IDotnsContentResolver.text(node, "manifest")` on the resolver from step 2. Returns the inline manifest JSON string. An empty string indicates the product does not exist; this also covers the case where the resolver is still the dotNS-issued default (the reverse-resolver does not implement `text`).
4. **Parse and validate the root manifest.**
  - Parse the string as JSON. Failure → malformed; surface a diagnostic.
  - Validate `$v`. Unknown version → undiscoverable; surface a diagnostic and keep working for other products.
  - Validate against the v1 `RootManifest` schema. Validation failure → malformed; do not partially trust the result.
5. **(Optional) Read the author.** Hosts that surface authorship in UI call `IDotnsRegistry.owner(node)` — a single call that returns the canonical owner. The registry transparently handles the ERC-721 fallback for second-level names, so callers do not need to distinguish that case from subnodes.
6. **Probe executable subnames.** For each of `app.<product_id>.dot`, `widget.<product_id>.dot`, `worker.<product_id>.dot` whose executable type the Host can render (per [Subname convention](#subname-convention)): compute the subnode's namehash and repeat steps 2–4 against it, using `text(subnode, "executable")` instead of `text(node, "manifest")` and parsing against the matching `ExecutableManifest` variant. A subnode that does not exist (resolver `address(0)`) or has an empty text record means the product does not provide that executable — this is not an error.
7. **(Optional) Verify subname provenance.** By convention executable subnames are owned by the same account as the base name; the registry does not enforce that. A Host that needs strict provenance MUST call `owner(subnode)` for each present subname and verify equality with the base-name owner from step 5.
8. **Fetch executable bytes before launching.** For each executable manifest the Host intends to launch:
  - `GET <gateway>/ipfs/<cid>` from the Bulletin IPFS gateway, where `cid` is the manifest's `cid` field.
  - Verify the fetched bytes resolve to `cid` per the chain's content-addressing rules.
  - Mismatch → refuse to launch; surface a clear error (see [Security § Trust anchor](#security)).

For the optional icon-byte fetch, the same step 8 mechanics apply against the root manifest's `icon.cid`. A missing or unverifiable icon is a UX degradation, not a launch blocker (see [Corner cases](#corner-cases)).

**Cache invalidation.** dotNS provides no push notifications. A Host that has cached a manifest detects a re-publish either by re-reading the relevant text record and observing a different value, or by seeing a higher `appVersion` in the executable manifest. Icon and executable bytes are cacheable indefinitely by `cid` (content-addressed).

### Conformance fixtures

A conforming Host implementation should produce well-defined behaviour for each of:

- Base name with no resolver (`resolver(node) == address(0)`) → product does not exist.
- Base name whose resolver is still the dotNS-default reverse resolver → product does not exist.
- Empty `text(node, "manifest")` → product does not exist.
- Malformed JSON in `manifest` → diagnostic; do not launch.
- Unknown `$v` in `manifest` → diagnostic; treat as undiscoverable.
- Root manifest fails `RootManifest` schema → diagnostic; do not launch.
- Unknown `icon.format` → render placeholder; product remains launchable.
- Icon CID unreachable, or fetched bytes do not match `icon.cid` → render placeholder; product remains launchable.
- Executable subname absent or empty `executable` text record → product does not provide that executable.
- Executable manifest fails its `ExecutableManifest` variant schema → skip that executable.
- Unknown `kind`, or `kind` does not match the subname label → skip that executable.
- Executable CID unreachable, or fetched bytes do not match `cid` → refuse to launch that executable.
- Executable subname owned by a different account than the base name (when strict provenance is enabled) → skip that executable.

## Drawbacks

- **JSON over a binary codec.** Costs text-record budget that a binary format would not — accepted for parseability with off-the-shelf tooling.
- **No oversized-manifest fallback.** A publisher who exceeds the dotNS text-record budget MUST shrink the payload.
- **Multiple lookups per resolution.** A full resolution for a product with all three executable types costs ~8 dotNS reads (resolver + text on the base name and on each of the three executable subnames) plus up to 4 Bulletin fetches (icon + three executable artifacts). Mitigate with parallelisation and caching by base name + revision (block of the last `setText`).
- **Schema evolution locks out older Hosts.** A new `$v` is invisible to Hosts that do not yet recognise it. v1 reserves a single text-record slot per record type with no co-versioning mechanism; a publisher who bumps `$v` therefore loses the installed base until those Hosts upgrade. A co-versioning scheme is left to a follow-up RFC.

## Security

- **Trust anchor.** The dotNS name is the identity; the manifest's `cid` fields bind that identity to specific bytes on Bulletin. Given an authenticated dotNS record, a Host that fetches by `cid` and verifies bytes is protected from tampering.
- **Icon supply chain.** The `format` allowlist (jpeg, png) constrains the rendering pipeline to raster decoders. Hosts MUST render icon bytes through a sandboxed image surface (e.g. `<img src="data:…">`) and never through paths that interpret the bytes as markup or script.
- **Size cap at publishing.** The publisher MUST validate every manifest against the v1 schema and reject payloads exceeding the dotNS text-record budget before submitting. dotNS enforces a wire-level cap on writes, so Hosts can safely assume incoming payloads are within it.
- **Subname squatting is structurally prevented.** `setSubnodeOwner` is gated by parent-ownership: only the owner of `<product_id>.dot` can create the modality subnames.
- **No user data.** The manifest carries no user data; privacy exposure is limited to whatever dotNS RPC traffic reveals about which products a client is resolving.

## Unresolved Questions

- **Text-record byte budget on dotNS.** The hard ceiling on a manifest's size. Owner: dotNS team Proof-of-Concept.

## Future Directions

A manifest-aggregation RPC could eliminate the N+1 lookup pattern (one round-trip per subname) without changing the schema. A companion spec will pin down the dashboard grid (cell size, bounds, responsive behaviour) referenced by `WidgetManifest.dimensions`. Multi-widget products are deferred: a later revision will define a subname convention (e.g. `widget.<id>.<product_id>.dot`) and a discovery mechanism.
