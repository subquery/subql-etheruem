// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

export interface RawEthFatBlock {
  Header: {
    parentHash: string;
    sha3Uncles: string;
    miner: string;
    stateRoot: string;
    transactionRoot: string;
    receiptsRoot: string;
    logsBloom: string;
    difficulty: bigint;
    number: bigint;
    gasLimit: bigint;
    gasUsed: bigint;
    timestamp: bigint;
    extraData: string;
    mixHash: string;
    nonce: string;
    baseFeePerGas: bigint;
    withdrawalsRoot: string;
    blobGasUsed: bigint;
    excessBlobGas: bigint;
    parentBeaconBlockRoot: string;
    hash: string;
  };
  Transactions: RawEthFatTransaction[];
  Logs: RawEthFatLog[];
}

export interface RawEthFatTransaction {
  type: string;
  nonce: bigint;
  to: string;
  gas: bigint;
  gasPrice: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  value: bigint;
  v: bigint;
  r: string;
  s: string;
  input: string;
  hash: string;
  from: string;
  func: string;
}

export interface RawEthFatLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: bigint;
  transactionHash: string;
  transactionIndex: bigint;
  blockHash: string;
  logIndex: bigint;
  removed: boolean;
}

/**
 * Eth Fat dictionary RPC request filter conditions
 */
export interface EthFatDictionaryConditions {
  logs: EthFatDictionaryLogConditions[];
  transactions: EthFatDictionaryTxConditions[];
}

export interface EthFatDictionaryLogConditions {
  address?: string[];
  topics0?: string[];
}

export interface EthFatDictionaryTxConditions {
  to?: string[];
  from?: string[];
  function?: string[];
}
