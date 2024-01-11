// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {DictionaryQueryEntry as DictionaryV1QueryEntry} from '@subql/types-core/dist/project/types';
import {MetaData as DictionaryV1Metadata} from '@subql/utils';
import {BlockHeightMap} from '../../utils/blockHeightMap';
import {DictionaryV2Metadata, DictionaryV2QueryEntry} from './';

export type DictionaryResponse<B> = {
  batchBlocks: number[] | B[];
  lastBufferedHeight: number;
};

export enum DictionaryVersion {
  v1 = 'v1',
  v2Basic = 'v2Basic',
  v2Complete = 'v2Complete',
}

export interface IDictionary<DS, FB> {
  getData(
    startBlock: number,
    queryEndBlock: number,
    limit: number
  ): Promise<DictionaryResponse<FB | number> | undefined>;
  initMetadata(): Promise<void>;
  metadata: DictionaryV1Metadata | DictionaryV2Metadata;
  dictionaryValidation(metaData?: DictionaryV1Metadata | DictionaryV2Metadata, startBlockHeight?: number): boolean;
  buildDictionaryQueryEntries(dataSources: DS[]): DictionaryV1QueryEntry[] | DictionaryV2QueryEntry;
  queryMapValidByHeight(height: number): boolean;
  getQueryEndBlock(startHeight: number, apiFinalizedHeight: number): number;

  setApiGenesisHash(genesisHash: string): void;
  setDictionaryStartHeight(start: number | undefined): void;
  version: DictionaryVersion;
  startHeight: number;
  useDictionary: boolean;
  heightValidation(height: number): boolean;
  updateQueriesMap(dataSources: BlockHeightMap<DS[]>): void;
}

export interface IDictionaryCtrl<DS, FB, D extends IDictionary<DS, FB>> {
  initDictionariesV1(): Promise<D[]>;
  initDictionariesV2(): Promise<D[]> | D[];
  initDictionaries(apiGenesisHash: string): Promise<void>;
  dictionary: D;
  useDictionary: boolean;
  findDictionary(height: number): Promise<void>;
  buildDictionaryEntryMap(dataSources: BlockHeightMap<DS[]>): void;
  scopedDictionaryEntries(
    startBlockHeight: number,
    queryEndBlock: number,
    scaledBatchSize: number
  ): Promise<(DictionaryResponse<number | FB> & {queryEndBlock: number}) | undefined>;
}
