/**
 * @aifirst/content — canonical AI First book content and the single
 * implementation of how a prompt resolves to a response.
 *
 * Consumed by both the aifirst CLI and the AI First VS Code extension. Keeping
 * one loader and one matcher here is what guarantees a learner sees identical
 * code in the terminal, in VS Code, and on the printed page.
 */

export * from "./types";
export * from "./ids";
export * from "./loader";
export * from "./matcher";

export { default as PACK_VERSION } from "./version";
