/* eslint-disable @typescript-eslint/no-use-before-define */
import { BgsPostMatchStats, parseBattlegroundsGame } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService } from '@firestone-hs/reference-data';
import { inflate } from 'pako';
import { ServerlessMysql } from 'serverless-mysql';
import SqlString from 'sqlstring';
import { ReplayInfo } from './create-full-review';
import { ReviewMessage } from './review-message';
import { getConnection } from './services/rds';
import { getConnection as getConnectionBgs } from './services/rds-bgs';
import { S3 } from './services/s3';

export const buildBgsPostMatchStats = async (
	replayInfo: ReplayInfo,
	allCards: AllCardsService,
	s3: S3,
): Promise<void> => {
	// This for now requires some specific input from the client, and is sent to another endpoint. Not sure
	// how easily we can migrate that for now
	return;
};
