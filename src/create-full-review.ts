/* eslint-disable @typescript-eslint/no-use-before-define */
import { logBeforeTimeout, S3, Sns } from '@firestone-hs/aws-lambda-utils';
import { BgsPostMatchStats, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService } from '@firestone-hs/reference-data';
import { ReplayUploadMetadata } from '@firestone-hs/replay-metadata';
import { saveReplayInReplaySummary } from './010_replay-summary';
import { buildMatchStats } from './020_match-stats';
import { buildBgsRunStats } from './030_bgs-run-stats';
import { buildBgsPostMatchStats } from './035_bgs-post-match-stats';
import { buildMercenariesMatchStats } from './040_mercenaries-match-stats';
import { updateDuelsLeaderboard } from './050_duels-leaderboard';
import { handleDuelsRunEnd } from './070_duels-run-end';
import { handleArenaRunEnd } from './080_arena-run-end';
import { ReviewMessage } from './review-message';

const s3 = new S3();
const sns = new Sns();
const cards = new AllCardsService();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event, context): Promise<any> => {
	// const cleanup = logBeforeTimeout(context);
	// logger.debug(`Invocation requestId: ${context.awsRequestId}, SQS message ID: ${event.Records[0].messageId}`);
	// logger.debug('received message', event);
	const messages = event.Records.map((record) => record.body).map((msg) => JSON.parse(msg));
	const s3infos = messages
		.map((msg) => JSON.parse(msg.Message))
		.map((msg) => msg.Records)
		.reduce((a, b) => a.concat(b), [])
		.map((record) => record.s3);
	// logger.debug('wait for cards db init');
	await cards.initializeCardsDb();
	// logger.debug('card db init done');
	await Promise.all(s3infos.map((message) => handleReplay(message, context)));
	return { statusCode: 200, body: '' };
};

const handleReplay = async (message, context): Promise<void> => {
	const cleanup = logBeforeTimeout(context);
	const start = Date.now();
	// logger.debug('start processing', message);
	const replayInfo = await saveReplayInReplaySummary(message, s3, sns, cards);
	if (replayInfo) {
		// logger.debug('replayInfo');
		await buildMatchStats(replayInfo);
		// logger.debug('after buildMatchStats');
		if (
			['battlegrounds', 'battlegrounds-friendly', 'battlegrounds-duo'].includes(replayInfo.reviewMessage.gameMode)
		) {
			// logger.debug('before buildBgsRunStats');
			await buildBgsRunStats(replayInfo, cards, sns);
			// logger.debug('after buildBgsRunStats');
			await buildBgsPostMatchStats(replayInfo, cards, s3);
			// logger.debug('after buildBgsPostMatchStats');
		} else if (['mercenaries-pvp'].includes(replayInfo.reviewMessage.gameMode)) {
			// logger.debug('before buildMercenariesMatchStats');
			await buildMercenariesMatchStats(replayInfo, cards);
			// logger.debug('after buildMercenariesMatchStats');
		} else if (
			['duels', 'paid-duels'].includes(replayInfo.reviewMessage.gameMode) &&
			replayInfo.reviewMessage.additionalResult
		) {
			await updateDuelsLeaderboard(replayInfo);
			const [wins, losses] = replayInfo.reviewMessage.additionalResult.split('-').map((info) => parseInt(info));
			if (
				(wins === 11 && replayInfo.reviewMessage.result === 'won') ||
				(losses === 2 && replayInfo.reviewMessage.result === 'lost')
			) {
				await handleDuelsRunEnd(replayInfo, cards);
			}
		} else if (['arena'].includes(replayInfo.reviewMessage.gameMode) && replayInfo.reviewMessage.additionalResult) {
			const [wins, losses] = replayInfo.reviewMessage.additionalResult.split('-').map((info) => parseInt(info));
			if (
				(wins === 11 && replayInfo.reviewMessage.result === 'won') ||
				(losses === 2 && replayInfo.reviewMessage.result === 'lost')
			) {
				await handleArenaRunEnd(replayInfo, cards);
			}
		}
	}
	if (replayInfo?.userName === 'daedin' || replayInfo?.reviewMessage.appChannel === 'beta') {
		console.debug(
			'request processing took',
			Date.now() - start,
			'ms',
			'with new process?',
			!!replayInfo.fullMetaData,
			replayInfo?.userName,
			replayInfo?.reviewMessage?.gameMode,
			replayInfo?.fullMetaData?.game?.reviewId,
		);
	}
	cleanup();
};

export interface ReplayInfo {
	readonly userName: string;
	readonly replay: Replay;
	readonly fullMetaData: ReplayUploadMetadata;
	readonly reviewMessage: ReviewMessage;
	readonly replayString: string;
	bgsPostMatchStats: BgsPostMatchStats;
}
