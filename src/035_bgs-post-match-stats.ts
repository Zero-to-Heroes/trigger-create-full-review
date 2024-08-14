/* eslint-disable @typescript-eslint/no-use-before-define */
import { S3 } from '@firestone-hs/aws-lambda-utils';
import { AllCardsService } from '@firestone-hs/reference-data';
import { gzipSync } from 'zlib';
import { ReplayInfo } from './create-full-review';

export const buildBgsPostMatchStats = async (
	replayInfo: ReplayInfo,
	allCards: AllCardsService,
	s3: S3,
): Promise<void> => {
	const debug = replayInfo.userName === 'daedin';
	debug &&
		console.debug(
			'[debug] saving post-match stats',
			replayInfo.reviewMessage.reviewId,
			replayInfo.fullMetaData?.bgs?.postMatchStats,
		);

	if (!replayInfo.fullMetaData?.bgs?.postMatchStats) {
		debug && console.debug('[debug] empty post-match stats', replayInfo.reviewMessage.reviewId);
		return;
	}

	await s3.writeFile(
		gzipSync(JSON.stringify(replayInfo.fullMetaData.bgs.postMatchStats)),
		'bgs-post-match-stats.firestoneapp.com',
		`${replayInfo.reviewMessage.reviewId}.gz.json`,
		'application/json',
		'gzip',
	);
	debug && console.debug('[debug] saved post-match stats', replayInfo.reviewMessage.reviewId);

	// Intentionally leaving out the "best stats" table, as it's resource-intensive and not used
};

// const compressPostMatchStats = (postMatchStats: BgsPostMatchStats, maxLength: number): string => {
// 	const base64data = compressStats(postMatchStats);
// 	if (base64data.length < maxLength) {
// 		return base64data;
// 	}

// 	console.warn('stats too big, compressing', base64data.length);
// 	const boardWithOnlyLastTurn =
// 		postMatchStats.boardHistory && postMatchStats.boardHistory.length > 0
// 			? [postMatchStats.boardHistory[postMatchStats.boardHistory.length - 1]]
// 			: [];
// 	const truncatedStats: any = {
// 		...postMatchStats,
// 		boardHistory: boardWithOnlyLastTurn,
// 	};
// 	const compressedTruncatedStats = deflate(JSON.stringify(truncatedStats), { to: 'string' });
// 	const buffTruncated = Buffer.from(compressedTruncatedStats, 'utf8');
// 	const base64dataTruncated = buffTruncated.toString('base64');
// 	return base64dataTruncated;
// };

// const compressStats = (stats: any): string => {
// 	const compressedStats = deflate(JSON.stringify(stats), { to: 'string' });
// 	const buff = Buffer.from(compressedStats, 'utf8');
// 	const base64data = buff.toString('base64');
// 	return base64data;
// };
