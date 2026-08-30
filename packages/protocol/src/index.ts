export * from "./jsonrpc.js";
export * from "./events.js";
export * from "./frames.js";
export * from "./session-types.js";

/** Protocol schema version; bumped only on breaking wire changes. */
export const PROTOCOL_VERSION = "0.0.1" as const;
