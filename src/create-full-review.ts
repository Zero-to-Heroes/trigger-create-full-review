/* eslint-disable @typescript-eslint/no-use-before-define */
import { AllCardsService } from '@firestone-hs/reference-data';
import { saveReplayInReplaySummary } from 'src/01_replay_summary';
import { S3 } from './services/s3';
import { Sns } from './services/sns';
import serverlessMysql = require('serverless-mysql');

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
		}
		return true;
	}
	return false;
};
