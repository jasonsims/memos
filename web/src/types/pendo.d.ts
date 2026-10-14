/** A visitor metadata value. Undefined values are dropped when Pendo serializes the payload. */
type PendoMetadataValue = string | number | boolean | undefined;

interface PendoVisitor {
  /** The signed-in user's ID, or "" for an anonymous visitor. */
  id: string;
  [key: string]: PendoMetadataValue;
}

/** Location API transforms keep credentials out of recorded URLs. Only the attr/action pairs in use are typed. */
type PendoLocationTransform =
  | { attr: "search"; action: "ExcludeKeys"; data: (search: string, url?: URL) => string[] }
  | { attr: "pathname"; action: "Replace"; data: (pathname: string, url?: URL) => string };

interface PendoInitializeOptions {
  visitor: PendoVisitor;
  location?: { transforms: PendoLocationTransform[] };
}

/** The Pendo agent installed by the snippet in index.html. */
interface PendoAgent {
  initialize(options: PendoInitializeOptions): void;
  identify(options: { visitor: PendoVisitor }): void;
  /** Missing until the agent script loads: the snippet stubs only initialize, identify, updateOptions, pageLoad, track and trackAgent. */
  clearSession?(): void;
}

interface Window {
  pendo?: PendoAgent;
}
