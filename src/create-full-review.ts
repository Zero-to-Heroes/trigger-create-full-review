/* eslint-disable @typescript-eslint/no-use-before-define */
import { logBeforeTimeout, logger, S3 } from '@firestone-hs/aws-lambda-utils';
import { BgsPostMatchStats, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService } from '@firestone-hs/reference-data';
import { saveReplayInReplaySummary } from './010_replay-summary';
import { buildMatchStats } from './020_match-stats';
import { buildBgsRunStats } from './030_bgs-run-stats';
import { buildBgsPostMatchStats } from './035_bgs-post-match-stats';
import { buildMercenariesMatchStats } from './040_mercenaries-match-stats';
import { updateDuelsLeaderboard } from './050_duels-leaderboard';
import { handleDuelsHighWins } from './060_duels-high-wins';
import { handleDuelsRunEnd } from './070_duels-run-end';
import { ReviewMessage } from './review-message';
import { Sns } from './services/sns';

const s3 = new S3();
const sns = new Sns();
const cards = new AllCardsService();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event, context): Promise<any> => {
	const cleanup = logBeforeTimeout(context);
	logger.debug('received message', event);
	const messages = event.Records.map(record => record.body).map(msg => JSON.parse(msg));
	const s3infos = messages
		.map(msg => JSON.parse(msg.Message))
		.map(msg => msg.Records)
		.reduce((a, b) => a.concat(b), [])
		.map(record => record.s3);
	logger.debug('wait for cards db init');
	await cards.initializeCardsDb();
	logger.debug('card db init done');
	await Promise.all(s3infos.map(s3 => handleReplay(s3)));
	cleanup();
	return { statusCode: 200, body: '' };
};

const handleReplay = async (message): Promise<void> => {
	logger.log('start processing', message);
	const replayInfo = await saveReplayInReplaySummary(message, s3, sns, cards);
	if (replayInfo) {
		const useNewProcess = true;
		if (useNewProcess) {
			logger.debug('new process', replayInfo.reviewMessage);
			await buildMatchStats(replayInfo);
			if (['battlegrounds', 'battlegrounds-friendly'].includes(replayInfo.reviewMessage.gameMode)) {
				await buildBgsRunStats(replayInfo, cards, s3);
				await buildBgsPostMatchStats(replayInfo, cards, s3);
			} else if (['mercenaries-pvp'].includes(replayInfo.reviewMessage.gameMode)) {
				await buildMercenariesMatchStats(replayInfo, cards);
			} else if (
				['duels', 'paid-duels'].includes(replayInfo.reviewMessage.gameMode) &&
				replayInfo.reviewMessage.additionalResult
			) {
				await updateDuelsLeaderboard(replayInfo);
				const [wins, losses] = replayInfo.reviewMessage.additionalResult.split('-').map(info => parseInt(info));
				if (
					(wins === 11 && replayInfo.reviewMessage.result === 'won') ||
					(losses === 2 && replayInfo.reviewMessage.result === 'lost' && wins >= 10)
				) {
					await handleDuelsHighWins(replayInfo, cards);
				}
				if (
					(wins === 11 && replayInfo.reviewMessage.result === 'won') ||
					(losses === 2 && replayInfo.reviewMessage.result === 'lost')
				) {
					await handleDuelsRunEnd(replayInfo, cards);
				}
			}
		}

		if (
			replayInfo.reviewMessage.userName === 'setter90' ||
			replayInfo.reviewMessage.userId === 'OW_0a4096f8-8785-4a3b-9491-3744c4150c0c'
		) {
			logger.error('dumping debug logs');
		}
	}
};

export interface ReplayInfo {
	readonly userName: string;
	readonly replay: Replay;
	readonly reviewMessage: ReviewMessage;
	readonly replayString: string;
	bgsPostMatchStats: BgsPostMatchStats;
}
