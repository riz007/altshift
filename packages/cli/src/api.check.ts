// Compile-time only: fails `pnpm typecheck` when the public types drift from the internal ones.
import type * as internal from "@ariamend/core";
import type * as api from "./api.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type ConfigMatches = Assert<Equal<api.AriamendConfig, internal.AriamendConfig>>;
export type JourneyMatches = Assert<Equal<api.Journey, internal.Journey>>;
export type JourneyContextMatches = Assert<Equal<api.JourneyContext, internal.JourneyContext>>;
export type CheckOptionsMatches = Assert<Equal<api.CheckOptions, internal.CheckOptions>>;
