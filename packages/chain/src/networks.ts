import type { Address } from "@perplog/core";
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";

export const HIDEKI = {
  key: "hideki",
  chain: hidekiTestnet,
  rpcHttp: "https://api.hideki2.infra.testnet.somnia.network",
  rpcWs: "wss://api.hideki2.infra.testnet.somnia.network/ws",
  indexer: "https://hideki-dev.smk.somnia.host/v1/graphql",
  marginBank: "0x478769e1177c0773c43a593dccc4ad15f15f1394" as Address,
  explorerTx: (hash: string) => `https://explorer.testnet.somnia.network/tokyo/tx/${hash}`,
  explorerAddress: (address: string) => `https://explorer.testnet.somnia.network/tokyo/address/${address}`,
  sdkAddresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
} as const;

export type Network = typeof HIDEKI;
