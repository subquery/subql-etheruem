// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import assert from 'assert';
import {EventEmitter2} from '@nestjs/event-emitter';
import {DictionaryQueryEntry as DictionaryV1QueryEntry} from '@subql/types-core/dist/project/types';
import {MetaData as DictionaryV1Metadata} from '@subql/utils';
import {
  IDictionary,
  DictionaryV2Metadata,
  DictionaryV2QueryEntry,
  DictionaryResponse,
  DictionaryVersion,
  IBlock,
} from '../';
import {NodeConfig} from '../../configure';
import {BlockHeightMap} from '../../utils/blockHeightMap';

export abstract class CoreDictionary<DS, FB> implements IDictionary<DS, FB> {
  queriesMap?: BlockHeightMap<DictionaryV1QueryEntry[] | DictionaryV2QueryEntry>;
  protected _startHeight?: number;
  protected _metadata: DictionaryV1Metadata | DictionaryV2Metadata | undefined;
  metadataValid: boolean | undefined;
  protected _dictionaryVersion: DictionaryVersion | undefined;

  constructor(
    readonly dictionaryEndpoint: string | undefined,
    protected chainId: string,
    protected readonly nodeConfig: NodeConfig,
    protected readonly eventEmitter: EventEmitter2
  ) {}

  abstract getData(
    startBlock: number,
    queryEndBlock: number,
    limit: number
  ): Promise<DictionaryResponse<IBlock<FB> | number> | undefined>;
  abstract init(): Promise<void>;
  protected abstract dictionaryValidation(
    metaData?: DictionaryV1Metadata | DictionaryV2Metadata,
    startBlockHeight?: number
  ): boolean;
  protected abstract buildDictionaryQueryEntries(dataSources: DS[]): DictionaryV1QueryEntry[] | DictionaryV2QueryEntry;
  abstract queryMapValidByHeight(height: number): boolean;
  abstract getQueryEndBlock(startHeight: number, apiFinalizedHeight: number): number;

  get version(): DictionaryVersion {
    if (!this._dictionaryVersion) {
      throw new Error(`Dictionary version not been inspected`);
    }
    return this._dictionaryVersion;
  }

  get startHeight(): number {
    if (this._startHeight === undefined) {
      throw new Error('Dictionary start height is not set');
    }
    return this._startHeight;
  }

  protected get useDictionary(): boolean {
    return (!!this.dictionaryEndpoint || !!this.nodeConfig.dictionaryResolver) && !!this.metadataValid;
  }

  protected setDictionaryStartHeight(start: number | undefined): void {
    // Since not all dictionary has adopted start height, if it is not set, we just consider it is 1.
    if (this._startHeight !== undefined) {
      return;
    }
    this._startHeight = start ?? 1;
  }

  // filter dictionary with start height
  heightValidation(height: number): boolean {
    return this.dictionaryValidation(this._metadata, height);
  }

  updateQueriesMap(dataSources: BlockHeightMap<DS[]>): void {
    this.queriesMap = dataSources.map(this.buildDictionaryQueryEntries);
  }

  // Base validation is required, and specific validation for each network should be implemented accordingly
  protected validateChainMeta(metaData: DictionaryV1Metadata | DictionaryV2Metadata): boolean {
    return metaData.chain === this.chainId || metaData.genesisHash === this.chainId;
  }
}