/* eslint-disable @typescript-eslint/no-use-before-define */
import { AllCardsService } from '@firestone-hs/reference-data';
import { saveReplayInReplaySummary } from './01_replay-summary';
import { S3 } from './services/s3';
import { Sns } from './services/sns';
// import serverlessMysql = require('serverless-mysql');
// import { buildMatchStats } from './02_match-stats';
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { buildMatchStats } from './02_match-stats';
import { ReviewMessage } from './review-message';
import { buildBgsRunStats } from './03_bgs-run-stats';
import { buildMercenariesMatchStats } from './04_mercenaries-match-stats';
import { updateDuelsLeaderboard } from './05_duels-leaderboard';
import { handleDuelsHighWins } from './06_duels-high-wins';
import { handleDuelsRunEnd } from './07_duels-run-end';

const s3 = new S3();
const sns = new Sns();
const cards = new AllCardsService();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	const messages = event.Records.map(record => record.body).map(msg => JSON.parse(msg));
	const s3infos = messages
		.map(msg => JSON.parse(msg.Message))
		.map(msg => msg.Records)
		.reduce((a, b) => a.concat(b), [])
		.map(record => record.s3);

	await cards.initializeCardsDb();
	await Promise.all(s3infos.map(s3 => handleReplay(s3)));
	return { statusCode: 200, body: '' };
};

const handleReplay = async (message): Promise<boolean> => {
	const replayInfo = await saveReplayInReplaySummary(message, s3, sns, cards);
	if (replayInfo) {
		if (replayInfo.userName === 'daedin') {
			console.log('new process');
			await buildMatchStats(replayInfo);
			if (['battlegrounds'].includes(replayInfo.reviewMessage.gameMode)) {
				await buildBgsRunStats(replayInfo, cards, s3);
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
		return true;
	}
	return false;
};

export interface ReplayInfo {
	readonly userName: string;
	readonly replay: Replay;
	readonly reviewMessage: ReviewMessage;
	readonly replayString: string;
}
