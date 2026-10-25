import type { Address } from "@perplog/core";
import { SomniaMarkets, type SomniaMarketsClient } from "@somnia-chain/markets-sdk";
import { HIDEKI, type Network } from "./networks";

let readClient: SomniaMarketsClient | undefined;

/** Read-only SDK client (no signer), shared per process. */
export function createReadClient(network: Network = HIDEKI): SomniaMarketsClient {
  readClient ??= new SomniaMarkets({
    chain: network.chain,
    wsRpcUrl: network.rpcWs,
    indexerUrl: network.indexer,
    addresses: network.sdkAddresses,
  }).client;
  return readClient;
}

export interface CollateralRead {
  collateralRaw: bigint;
  asOfBlock: bigint;
  activePools: Address[];
}

/** Collateral = unlocked + locked balance in the MarginBank (spec §6.3). */
export async function getCollateralRaw(
  client: Pick<SomniaMarketsClient, "getMarginAccount">,
  marginBank: Address,
  account: Address,
): Promise<CollateralRead> {
  const m = await client.getMarginAccount(marginBank, account);
  return {
    collateralRaw: m.unlockedCollateralBalance + m.lockedCollateral,
    asOfBlock: m.asOfBlock,
    activePools: m.activePerpPools.map((p) => p.toLowerCase() as Address),
  };
}
