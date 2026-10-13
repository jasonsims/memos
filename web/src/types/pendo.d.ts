// Fork-only: the Pendo agent installed on `window` by the snippet in index.html.

type PendoMetadataValue = string | number | boolean | undefined;

interface PendoVisitor {
  /** An empty id starts (or restores) an anonymous visitor. */
  id: string;
  [field: string]: PendoMetadataValue;
}

/**
 * Location API transforms applied to every URL the agent records. Only valid attr/action pairs are
 * listed: an invalid pair makes `initialize` throw, and Pendo never starts.
 */
type PendoLocationTransform =
  | { attr: "search"; action: "ExcludeKeys"; data: (search: string, url: URL) => string[] }
  | { attr: "pathname"; action: "Replace"; data: (pathname: string, url: URL) => string };

interface Pendo {
  initialize(options: { visitor: PendoVisitor; location?: { transforms: PendoLocationTransform[] } }): void;
  identify(options: { visitor: PendoVisitor }): void;
  /** Not stubbed by the snippet, so it is undefined until the agent script has loaded. */
  clearSession?: () => void;
}

interface Window {
  /** Undefined when the snippet is absent, e.g. under Vitest. */
  pendo?: Pendo;
}
