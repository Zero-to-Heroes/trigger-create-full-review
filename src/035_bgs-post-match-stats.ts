/* eslint-disable @typescript-eslint/no-use-before-define */
import { S3, getConnection } from '@firestone-hs/aws-lambda-utils';
import { BgsPostMatchStats } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService } from '@firestone-hs/reference-data';
import { deflate } from 'pako';
import SqlString from 'sqlstring';
import { ReplayInfo } from './create-full-review';

export const buildBgsPostMatchStats = async (
	replayInfo: ReplayInfo,
	allCards: AllCardsService,
	s3: S3,
): Promise<void> => {
	if (!replayInfo.fullMetaData?.bgs?.postMatchStats) {
		return;
	}

	const compressedStats: string = compressPostMatchStats(replayInfo.fullMetaData.bgs.postMatchStats, 51000);
	const userName = replayInfo.userName ? `'${replayInfo.userName}'` : 'NULL';
	const heroCardId = replayInfo.fullMetaData.game.mainPlayerCardId
		? `'${replayInfo.fullMetaData.game.mainPlayerCardId}'`
		: 'NULL';
	const query = `
		INSERT IGNORE INTO bgs_single_run_stats
		(
			reviewId,
			jsonStats,
			userId,
			userName,
			heroCardId
		)
		VALUES
		(
			${SqlString.escape(replayInfo.reviewMessage.reviewId)},
			'${compressedStats}',
			${SqlString.escape(replayInfo.reviewMessage.userId)},
			${userName},
			${heroCardId}
		)
	`;
	const mysql = await getConnection();
	const dbResults: any[] = await mysql.query(query);
	mysql.end();

	// Intentionally leaving out the "best stats" table, as it's resource-intensive and not used
};

const compressPostMatchStats = (postMatchStats: BgsPostMatchStats, maxLength: number): string => {
	const base64data = compressStats(postMatchStats);
	if (base64data.length < maxLength) {
		return base64data;
	}

	console.warn('stats too big, compressing', base64data.length);
	const boardWithOnlyLastTurn =
		postMatchStats.boardHistory && postMatchStats.boardHistory.length > 0
			? [postMatchStats.boardHistory[postMatchStats.boardHistory.length - 1]]
			: [];
	const truncatedStats: any = {
		...postMatchStats,
		boardHistory: boardWithOnlyLastTurn,
	};
	const compressedTruncatedStats = deflate(JSON.stringify(truncatedStats), { to: 'string' });
	const buffTruncated = Buffer.from(compressedTruncatedStats, 'utf8');
	const base64dataTruncated = buffTruncated.toString('base64');
	return base64dataTruncated;
};

const compressStats = (stats: any): string => {
	const compressedStats = deflate(JSON.stringify(stats), { to: 'string' });
	const buff = Buffer.from(compressedStats, 'utf8');
	const base64data = buff.toString('base64');
	return base64data;
};
