// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { IBlock } from '@subql/node-core';
import { DictionaryQueryCondition } from '@subql/types-core';
import {
  EthereumBlock,
  EthereumLog,
  EthereumTransaction,
} from '@subql/types-ethereum';
import { BigNumber } from 'ethers';
import { formatLog, formatTransaction } from '../../../ethereum/utils.ethereum';
import {
  EthFatDictionaryLogConditions,
  EthFatDictionaryTxConditions,
  RawEthFatBlock,
} from './types';

export function entryToTxConditions(
  conditions: DictionaryQueryCondition[],
): EthFatDictionaryTxConditions {
  const filter: EthFatDictionaryTxConditions = {};
  const toArray = [];
  const fromArray = [];
  const funcArray = [];
  for (const condition of conditions) {
    if (condition.field === 'to' && condition.matcher === 'equalTo') {
      toArray.push(condition.value);
    }
    if (condition.field === 'from' && condition.matcher === 'equalTo') {
      fromArray.push(condition.value);
    }
    if (condition.field === 'func' && condition.matcher === 'equalTo') {
      funcArray.push(condition.value);
    }
  }
  if (toArray.length !== 0) {
    // @ts-ignore
    filter.to = toArray;
  }
  if (fromArray.length !== 0) {
    // @ts-ignore
    filter.from = fromArray;
  }
  if (funcArray.length !== 0) {
    // @ts-ignore
    filter.function = funcArray;
  }
  if (
    toArray.length !== 0 ||
    fromArray.length !== 0 ||
    funcArray.length !== 0
  ) {
    return filter;
  }
}

export function entryToLogConditions(
  conditions: DictionaryQueryCondition[],
): EthFatDictionaryLogConditions {
  const filter: EthFatDictionaryLogConditions = {};
  const addressArray = [];
  const topicsArray = [];
  for (const condition of conditions) {
    if (condition.field === 'address' && condition.matcher === 'equalTo') {
      addressArray.push(condition.value);
    }
    if (condition.field === 'topics0' && condition.matcher === 'equalTo') {
      topicsArray.push(condition.value);
    }
    if (condition.field === 'topics1' && condition.matcher === 'equalTo') {
      topicsArray.push(condition.value);
    }
    if (condition.field === 'topics2' && condition.matcher === 'equalTo') {
      topicsArray.push(condition.value);
    }
  }
  if (addressArray.length !== 0) {
    // @ts-ignore
    filter.address = addressArray;
  }
  if (topicsArray.length !== 0) {
    // @ts-ignore
    filter.topics0 = topicsArray;
  }
  if (addressArray.length !== 0 || topicsArray.length !== 0) {
    return filter;
  }
}

export function rawFatBlockToEthBlock(
  block: RawEthFatBlock,
): IBlock<EthereumBlock> {
  const logs: EthereumLog[] = [];
  const transactions: EthereumTransaction[] = [];
  try {
    const ethBlock: EthereumBlock = {
      // Default available fields
      number: Number(block.header.number),
      parentHash: block.header.parentHash,
      sha3Uncles: block.header.sha3Uncles,

      // Missing, unless we force enable from query
      hash: block.header.hash,
      blockExtraData: block.header.extraData,
      difficulty: block.header.difficulty,
      extDataGasUsed: block.header.excessBlobGas?.toString(),
      extDataHash: block.header.extraData,
      gasLimit: block.header.gasLimit,
      gasUsed: block.header.gasUsed,
      logs: [],
      logsBloom: block.header.logsBloom,
      miner: block.header.miner,
      mixHash: block.header.mixHash,
      nonce: block.header.nonce,
      receiptsRoot: block.header.receiptsRoot,
      size: undefined,
      stateRoot: block.header.stateRoot,
      timestamp: block.header.timestamp,
      totalDifficulty: block.header.difficulty,
      transactions: [],
      uncles: [],
      transactionsRoot: block.header.transactionRoot,
      baseFeePerGas: block.header.baseFeePerGas,
      blockGasCost: undefined,
    };

    if (block.Transactions !== null && block.Transactions.length) {
      for (const tx of block.Transactions) {
        const _ethTransaction: EthereumTransaction = {
          blockHash: ethBlock.hash,
          blockNumber: ethBlock.number,
          blockTimestamp: ethBlock.timestamp,
          from: tx.from,
          gas: tx.gas,
          gasPrice: tx.gasPrice,
          hash: tx.hash,
          input: tx.input,
          nonce: tx.nonce,
          to: tx.to,
          transactionIndex: undefined,
          value: tx.value,
          type: tx.type,
          v: tx.v,
          r: tx.r,
          s: tx.s,
          receipt: undefined, //TODO, this might missing
          logs: [],
          accessList: [],
          chainId: '',
          maxFeePerGas: tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
          args: undefined,
        };
        transactions.push(_ethTransaction);
      }
    }
    ethBlock.transactions = transactions;

    if (block.Logs !== null && block.Logs.length) {
      for (const log of block.Logs) {
        const _ethLog: EthereumLog = {
          address: log.address,
          topics: log.topics,
          data: log.data,
          blockHash: log.blockHash,
          blockNumber: Number(log.blockNumber),
          transactionHash: log.transactionHash,
          transactionIndex: Number(log.transactionIndex),
          logIndex: Number(log.logIndex),
          removed: log.removed,
          args: undefined, //TODO, unknown
          block: ethBlock,
          transaction: undefined,
        };
        logs.push(_ethLog);
      }
    }
    ethBlock.logs = logs.map((l) => formatLog(l, ethBlock));
    ethBlock.transactions = transactions.map((tx) =>
      formatTransaction(tx, ethBlock),
    );

    return {
      block: ethBlock,
      getHeader: () => {
        return {
          hash: block.header.hash,
          height: BigNumber.from(block.header.number).toNumber(),
          parentHash: block.header.parentHash,
        };
      },
    };
  } catch (e) {
    throw new Error(
      `Convert fat block to Eth block failed at ${block.header.number},${e.message}`,
    );
  }
}