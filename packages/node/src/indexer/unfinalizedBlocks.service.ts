// Copyright 2020-2022 OnFinality Limited authors & contributors
// SPDX-License-Identifier: Apache-2.0

import assert from 'assert';
import { Block } from '@ethersproject/abstract-provider';
import { Injectable } from '@nestjs/common';
import {
  getLogger,
  getMetaDataInfo,
  MetadataRepo,
  NodeConfig,
} from '@subql/node-core';
import { EthereumBlock } from '@subql/types-ethereum';
import { last } from 'lodash';
import { Sequelize, Transaction } from 'sequelize';
import { EthereumApi } from '../ethereum';
import { EthereumApiService } from '../ethereum/api.service.ethereum';

const logger = getLogger('UnfinalizedBlocks');

export const METADATA_UNFINALIZED_BLOCKS_KEY = 'unfinalizedBlocks';
export const METADATA_LAST_FINALIZED_PROCESSED_KEY =
  'lastFinalizedVerifiedHeight';

type UnfinalizedBlocks = [blockHeight: number, blockHash: string][];

@Injectable()
export class UnfinalizedBlocksService {
  private unfinalizedBlocks: UnfinalizedBlocks;
  private finalizedHeader: Block;
  private metadataRepo: MetadataRepo;
  private lastCheckedBlockHeight: number;

  constructor(
    private readonly apiService: EthereumApiService,
    private readonly nodeConfig: NodeConfig,
    private readonly sequelize: Sequelize,
  ) {}

  async init(
    metadataRepo: MetadataRepo,
    reindex: (targetHeight: number) => Promise<void>,
  ): Promise<number | undefined> {
    this.metadataRepo = metadataRepo;
    this.unfinalizedBlocks = await this.getMetadataUnfinalizedBlocks();
    this.lastCheckedBlockHeight = await this.getLastFinalizedVerifiedHeight();
    this.finalizedHeader = await this.api.getBlockByHeightOrHash(
      await this.api.getFinalizedBlockHeight(),
    );

    if (!this.nodeConfig.unfinalizedBlocks && this.unfinalizedBlocks.length) {
      logger.info('processing unfinalized blocks');

      const tx = await this.sequelize.transaction();
      const rewindHeight = await this.processUnfinalizedBlocks(null, tx);

      if (rewindHeight !== null) {
        logger.info(
          `Found un-finalized blocks from previous indexing but unverified, rolling back to last finalized block ${rewindHeight} `,
        );
        await reindex(rewindHeight);
        logger.info(`Successful rewind to block ${rewindHeight}!`);
        return rewindHeight;
      } else {
        await this.resetUnfinalizedBlocks(tx);
        await this.resetLastFinalizedVerifiedHeight(tx);
      }
      await tx.commit();
    }
  }

  async processUnfinalizedBlocks(
    block: EthereumBlock | undefined,
    tx: Transaction,
  ): Promise<number | null> {
    if (block) {
      await this.registerUnfinalizedBlock(block.number, block.hash, tx);
    }

    if (!(await this.hasForked())) {
      // Remove blocks that are now confirmed finalized
      await this.deleteFinalizedBlock(tx);
    } else {
      // Get the last unfinalized block that is now finalized
      return this.getLastCorrectFinalizedBlock();
    }

    return null;
  }

  private get api(): EthereumApi {
    return this.apiService.api;
  }

  private get finalizedBlockNumber(): number {
    return this.finalizedHeader.number;
  }

  registerFinalizedBlock(header: Block): void {
    if (this.finalizedHeader && this.finalizedBlockNumber >= header.number) {
      return;
    }
    this.finalizedHeader = header;
  }

  private async registerUnfinalizedBlock(
    blockNumber: number,
    hash: string,
    tx: Transaction,
  ): Promise<void> {
    if (blockNumber <= this.finalizedBlockNumber) return;

    // Ensure order
    if (
      this.unfinalizedBlocks.length &&
      last(this.unfinalizedBlocks)[0] + 1 !== blockNumber
    ) {
      logger.error('Unfinalized block is not sequential');
      process.exit(1);
    }

    this.unfinalizedBlocks.push([blockNumber, hash]);
    await this.saveUnfinalizedBlocks(this.unfinalizedBlocks, tx);
  }

  private async deleteFinalizedBlock(tx: Transaction): Promise<void> {
    if (
      this.lastCheckedBlockHeight !== undefined &&
      this.lastCheckedBlockHeight < this.finalizedBlockNumber
    ) {
      this.removeFinalized(this.finalizedBlockNumber);
      await this.saveLastFinalizedVerifiedHeight(this.finalizedBlockNumber, tx);
      await this.saveUnfinalizedBlocks(this.unfinalizedBlocks, tx);
    }
    this.lastCheckedBlockHeight = this.finalizedBlockNumber;
  }

  // remove any records less and equal than input finalized blockHeight
  private removeFinalized(blockHeight: number): void {
    const index = this.unfinalizedBlocks.findIndex(
      ([height]) => height === blockHeight,
    );

    if (index !== -1) {
      this.unfinalizedBlocks = this.unfinalizedBlocks.slice(
        index + 1, // We don't want to include the blockHeight hence the + 1
        this.unfinalizedBlocks.length,
      );
    }
  }

  // find closest record from block heights
  private getClosestRecord(
    blockHeight: number,
  ): { blockHeight: number; hash: string } | undefined {
    // Have the block in the best block, can be verified
    const record = [...this.unfinalizedBlocks] // Copy so we can reverse
      .reverse() // Reverse the list to find the largest block
      .find(([bestBlockHeight]) => Number(bestBlockHeight) <= blockHeight);
    if (record) {
      const [bestBlockHeight, hash] = record;
      return { blockHeight: Number(bestBlockHeight), hash };
    }
    return undefined;
  }

  private async hasForked(): Promise<boolean> {
    const lastVerifiableBlock = this.getClosestRecord(
      this.finalizedBlockNumber,
    );

    if (!lastVerifiableBlock) {
      return false;
    }

    if (lastVerifiableBlock.blockHeight === this.finalizedBlockNumber) {
      return lastVerifiableBlock.hash !== this.finalizedHeader.hash;
    } else {
      let header = this.finalizedHeader;

      if (header.number - lastVerifiableBlock.blockHeight > 200) {
        header = await this.api.getBlockByHeightOrHash(
          lastVerifiableBlock.blockHeight,
        );
      } else {
        while (lastVerifiableBlock.blockHeight !== header.number) {
          header = await this.api.getBlockByHeightOrHash(header.parentHash);
        }
      }

      if (header.hash !== lastVerifiableBlock.hash) {
        logger.warn(
          `Block fork found, enqueued un-finalized block at ${lastVerifiableBlock.blockHeight} with hash ${lastVerifiableBlock.hash}, actual hash is ${header.hash}`,
        );
        return true;
      }
    }

    return false;
  }

  private async saveUnfinalizedBlocks(
    unfinalizedBlocks: UnfinalizedBlocks,
    tx: Transaction,
  ): Promise<void> {
    return this.setMetadata(
      METADATA_UNFINALIZED_BLOCKS_KEY,
      JSON.stringify(unfinalizedBlocks),
      tx,
    );
  }

  private async getLastCorrectFinalizedBlock(): Promise<number | undefined> {
    const bestVerifiableBlocks = this.unfinalizedBlocks.filter(
      ([bestBlockHeight, hash]) =>
        Number(bestBlockHeight) <= this.finalizedBlockNumber,
    );

    let checkingHeader = this.finalizedHeader;

    // Work backwards through the blocks until we find a matching hash
    for (const [block, hash] of bestVerifiableBlocks.reverse()) {
      if (hash === checkingHeader.hash || hash === checkingHeader.parentHash) {
        return Number(block);
      }

      // Get the new parent
      checkingHeader = await this.api.getBlockByHeightOrHash(
        this.finalizedHeader.parentHash,
      );
    }

    return this.lastCheckedBlockHeight;
  }

  async resetUnfinalizedBlocks(tx: Transaction): Promise<void> {
    await this.setMetadata(METADATA_UNFINALIZED_BLOCKS_KEY, '[]', tx);
    this.unfinalizedBlocks = [];
  }

  async resetLastFinalizedVerifiedHeight(tx: Transaction): Promise<void> {
    return this.setMetadata(METADATA_LAST_FINALIZED_PROCESSED_KEY, null, tx);
  }

  private async setMetadata(
    key: string,
    value: string | number | boolean,
    tx: Transaction,
  ): Promise<void> {
    assert(this.metadataRepo, `Model _metadata does not exist`);
    await this.metadataRepo.upsert({ key, value }, { transaction: tx });
  }

  private async saveLastFinalizedVerifiedHeight(
    height: number,
    tx: Transaction,
  ) {
    return this.setMetadata(METADATA_LAST_FINALIZED_PROCESSED_KEY, height, tx);
  }

  async getMetadataUnfinalizedBlocks(): Promise<UnfinalizedBlocks> {
    const val = await getMetaDataInfo<string>(
      this.metadataRepo,
      METADATA_UNFINALIZED_BLOCKS_KEY,
    );
    if (val) {
      return JSON.parse(val) as UnfinalizedBlocks;
    }
    return [];
  }

  async getLastFinalizedVerifiedHeight(): Promise<number | undefined> {
    return getMetaDataInfo(
      this.metadataRepo,
      METADATA_LAST_FINALIZED_PROCESSED_KEY,
    );
  }
}
