// Fork-only: types for the Pendo (Novus) agent loaded by the install snippet in index.html.
// Only the surface this app uses is typed. The snippet stubs `initialize` and `identify` until the
// agent script loads, and the global is absent entirely in tests, so callers go through `window.pendo?`.

type PendoMetadataValue = string | number | boolean | string[] | undefined;

interface PendoVisitor {
  id: string;
  [key: string]: PendoMetadataValue;
}

interface PendoIdentity {
  visitor: PendoVisitor;
}

/**
 * Only valid attr/action pairs type-check: an invalid pair throws inside `pendo.initialize` and the
 * agent never starts. `AddTo` is valid for search and pathname but is unused here, so it is omitted.
 */
type PendoLocationTransform =
  | { attr: "search"; action: "AllowOnlyKeys" | "ExcludeKeys"; data: string[] | ((search: string, url: URL) => string[]) }
  | { attr: "search" | "hash" | "pathname" | "hostname" | "href"; action: "Replace"; data: string | ((value: string, url: URL) => string) }
  | { attr: "search" | "hash" | "pathname"; action: "Clear" }
  | { attr: "href" | "protocol"; action: "ForceSecure" };

interface PendoInitializeOptions extends PendoIdentity {
  location?: { transforms: PendoLocationTransform[] };
}

interface PendoAgent {
  initialize(options: PendoInitializeOptions): void;
  identify(identity: PendoIdentity): void;
  /** Not stubbed by the install snippet: present only once the agent script has loaded. */
  clearSession?: () => void;
}

declare var pendo: PendoAgent | undefined;
