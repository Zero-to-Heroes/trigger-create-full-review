/* eslint-disable @typescript-eslint/no-use-before-define */
import { getConnection, logBeforeTimeout, S3, Sns } from '@firestone-hs/aws-lambda-utils';
import { BgsPostMatchStats, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService } from '@firestone-hs/reference-data';
import { ReplayUploadMetadata } from '@firestone-hs/replay-metadata';
import { S3Event, S3EventRecord, SQSEvent } from 'aws-lambda';
import { ServerlessMysql } from 'serverless-mysql';
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
export default async (event: SQSEvent, context): Promise<any> => {
	// TODO: use a single mysql connection, and don't create / end() it every time, and see
	// how it goes
	// TODO: ideally, also batch messages?
	const messages = event.Records.map((record) => ({
		id: record.messageId,
		body: JSON.parse(record.body),
	}));
	const s3infos = messages
		.map((msg) => ({ message: JSON.parse(msg.body.Message) as S3Event, id: msg.id }))
		.flatMap((msg) => msg.message.Records.map((record) => ({ s3: record.s3, id: msg.id })));
	console.debug('processing', s3infos.length, 'replays');
	// logger.debug('wait for cards db init');
	await cards.initializeCardsDb();
	// logger.debug('card db init done');
	const mysql = await getConnection();
	const processedInfo = await Promise.all(
		s3infos.map((message) => handleReplay(mysql, message.s3, message.id, context)),
	);
	await mysql.end();

	return {
		batchItemFailures: processedInfo
			.filter((info) => !info.processed)
			.map((info) => ({
				itemIdentifier: info.messageId,
			})),
	};
};

const handleReplay = async (
	mysql: ServerlessMysql,
	message: S3EventRecord['s3'],
	messageId: string,
	context,
): Promise<{ messageId: string; processed: boolean }> => {
	const cleanup = logBeforeTimeout(context);
	try {
		const start = Date.now();
		// logger.debug('start processing', message);
		const replayInfo = await saveReplayInReplaySummary(mysql, message, s3, sns, cards);
		if (replayInfo) {
			// logger.debug('replayInfo');
			await buildMatchStats(mysql, replayInfo);
			// logger.debug('after buildMatchStats');
			if (
				['battlegrounds', 'battlegrounds-friendly', 'battlegrounds-duo'].includes(
					replayInfo.reviewMessage.gameMode,
				)
			) {
				// logger.debug('before buildBgsRunStats');
				await buildBgsRunStats(mysql, replayInfo, cards, sns);
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
				const [wins, losses] = replayInfo.reviewMessage.additionalResult
					.split('-')
					.map((info) => parseInt(info));
				if (
					(wins === 11 && replayInfo.reviewMessage.result === 'won') ||
					(losses === 2 && replayInfo.reviewMessage.result === 'lost')
				) {
					await handleDuelsRunEnd(replayInfo, cards);
				}
			} else if (
				['arena', 'arena-underground'].includes(replayInfo.reviewMessage.gameMode) &&
				replayInfo.reviewMessage.additionalResult
			) {
				const [wins, losses] = replayInfo.reviewMessage.additionalResult
					.split('-')
					.map((info) => parseInt(info));
				if (
					(wins === 11 && replayInfo.reviewMessage.result === 'won') ||
					(losses === 2 && replayInfo.reviewMessage.result === 'lost')
				) {
					await handleArenaRunEnd(mysql, replayInfo, cards);
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
		return { messageId, processed: true };
	} catch (e) {
		console.error('Exception while processing replay', e);
		return { messageId, processed: false };
	} finally {
		cleanup();
	}
};

export interface ReplayInfo {
	readonly userName: string;
	readonly replay: Replay;
	readonly fullMetaData: ReplayUploadMetadata;
	readonly reviewMessage: ReviewMessage;
	readonly replayString: string;
	bgsPostMatchStats: BgsPostMatchStats;
}
