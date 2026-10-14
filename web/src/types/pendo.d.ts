// Types for the parts of the Pendo web agent API this app calls (see web/src/lib/pendo.ts).

type PendoMetadataValue = string | number | boolean;

/** Values a track event property may hold; an undefined property is left out of the event. */
type PendoTrackValue = string | number | boolean | string[];

interface PendoVisitor {
  id: string;
  email?: string;
  full_name?: string;
  [key: string]: PendoMetadataValue | undefined;
}

/** Location API transforms this app registers. The agent throws inside initialize on an invalid attr/action pair. */
type PendoLocationTransform =
  | { attr: "search"; action: "ExcludeKeys"; data: (search: string, url: URL) => string[] }
  | { attr: "pathname"; action: "Replace"; data: (pathname: string, url: URL) => string };

interface PendoIdentity {
  visitor: PendoVisitor;
}

interface PendoInitializeOptions extends PendoIdentity {
  location?: { transforms: PendoLocationTransform[] };
}

interface PendoAgent {
  initialize: (options: PendoInitializeOptions) => void;
  identify: (identity: PendoIdentity) => void;
  /** Stubbed by the install snippet, so events tracked before the agent script loads are queued. */
  track: (trackType: string, properties?: Record<string, PendoTrackValue | undefined>) => void;
  /** Not stubbed by the install snippet, so it only exists once the agent script has loaded. */
  clearSession?: () => void;
}

interface Window {
  /** Defined by the install snippet in index.html; undefined when the snippet is absent (e.g. tests). */
  pendo?: PendoAgent;
}
