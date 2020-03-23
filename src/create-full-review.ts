/* eslint-disable @typescript-eslint/no-use-before-define */
import { parseHsReplayString, Replay } from '@firestone-hs/hs-replay-xml-parser';
import { Metadata } from 'aws-sdk/clients/s3';
import SqlString from 'sqlstring';
import { v4 } from 'uuid';
import { AllCardsService } from './services/cards';
import { getConnection } from './services/rds';
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
	// console.log('event', JSON.stringify(event, null, 4));
	const messages = event.Records.map(record => record.body).map(msg => JSON.parse(msg));
	// console.log('messages', messages);
	const s3infos = messages
		.map(msg => JSON.parse(msg.Message))
		.map(msg => msg.Records)
		.reduce((a, b) => a.concat(b), [])
		.map(record => record.s3);

	// console.log('s3infos', s3infos);
	const previousConsole = console.log;
	console.log = () => {};
	await cards.initializeCardsDb();
	console.log = previousConsole;
	// console.log('cards initialized');
	const mysql = await getConnection();
	await Promise.all(s3infos.map(s3 => handleReplay(s3, mysql)));
	return { statusCode: 200, body: '' };
};

const handleReplay = async (message, mysql: serverlessMysql.ServerlessMysql): Promise<boolean> => {
	const bucketName = message.bucket.name;
	const key = message.object.key;

	const metadata: Metadata = await s3.getObjectMetaData(bucketName, key);

	// Only process reviews for me for now
	const userId = metadata['user-key'];
	// console.log('will process review?', userId, message);
	// if (userId !== 'OW_2c40f5f0-4b1c-476a-98c0-d6ac63508d4b') {
	// 	return false;
	// }
	// console.log('processing review', userId, message);
	const replayString = await s3.readZippedContent(bucketName, key);
	// console.log('replayString', replayString);

	const reviewId = metadata['review-id'];
	// console.log('reviewId', reviewId, metadata);
	const review: any = await mysql.query(`SELECT * FROM replay_summary WHERE reviewId = '${reviewId}'`);
	// console.log('review?', review, review == null, review != null && review.length);
	if (review.length > 0) {
		console.log('review already handled', reviewId, review);
		return true;
	}

	const uploaderToken = 'overwolf-' + userId;
	const deckstring = undefinedAsNull(metadata['deckstring']);
	const playerDeckName = undefinedAsNull(metadata['deck-name']);
	const scenarioId = undefinedAsNull(metadata['scenario-id']);
	const buildNumber = undefinedAsNull(metadata['build-number']);
	const playerRank = undefinedAsNull(metadata['player-rank']);
	const opponentRank = undefinedAsNull(metadata['opponent-rank']);
	const gameMode = undefinedAsNull(metadata['game-mode']);
	const gameFormat = undefinedAsNull(metadata['game-format']);
	const application = undefinedAsNull(metadata['application-key']);

	const today = new Date();
	const reviewKey = `hearthstone/replay/${today.getFullYear()}/${today.getMonth() + 1}/${today.getDay()}/${v4()}`;

	// console.log('preparing to parse replay');
	try {
		const replay: Replay = parseHsReplayString(replayString);
		// console.log('replay parsed');
		const playerName = replay.mainPlayerName;
		const opponentName = replay.opponentPlayerName;
		const playerCardId = replay.mainPlayerCardId;
		const opponentCardId = replay.opponentPlayerCardId;
		const result = replay.result;
		const additionalResult = replay.additionalResult;
		const playCoin = replay.playCoin;
		const playerClass = cards.getCard(playerCardId)?.playerClass?.toLowerCase();
		const opponentClass = cards.getCard(opponentCardId)?.playerClass?.toLowerCase();
		const creationDate = toCreationDate(today);

		const query = `
			INSERT INTO replay_summary
			(
				reviewId,
				creationDate,
				gameMode,
				gameFormat,
				buildNumber,
				scenarioId,
				result,
				additionalResult,
				coinPlay,
				playerName,
				playerClass,
				playerCardId,
				playerRank,
				playerDeckName,
				playerDecklist,
				opponentName,
				opponentClass,
				opponentCardId,
				opponentRank,
				userId,
				uploaderToken,
				replayKey,
				application
			)
			VALUES
			(
				${nullIfEmpty(reviewId)},
				${nullIfEmpty(creationDate)},
				${nullIfEmpty(gameMode)},
				${nullIfEmpty(gameFormat)},
				${nullIfEmpty(buildNumber)},
				${nullIfEmpty(scenarioId)},
				${nullIfEmpty(result)},
				${nullIfEmpty(additionalResult)},
				${nullIfEmpty(playCoin)},
				${nullIfEmpty(playerName)},
				${nullIfEmpty(playerClass)},
				${nullIfEmpty(playerCardId)},
				${nullIfEmpty(playerRank)},
				${nullIfEmpty(playerDeckName)},
				${nullIfEmpty(deckstring)},
				${nullIfEmpty(opponentName)},
				${nullIfEmpty(opponentClass)},
				${nullIfEmpty(opponentCardId)},
				${nullIfEmpty(opponentRank)},
				${nullIfEmpty(userId)},
				${nullIfEmpty(uploaderToken)},
				${nullIfEmpty(reviewKey)},
				${nullIfEmpty(application)}
			)
		`;
		console.log('will execute query', query);
		await mysql.query(query);

		// console.log('Writing file'), replayString;
		await s3.writeFile(replayString, 'com.zerotoheroes.output', reviewKey, 'text/xml');
		// console.log('file written', reviewKey);
		// const read = await s3.readContentAsString('com.zerotoheroes.output', reviewKey);

		sns.notifyReviewPublished({
			reviewId: reviewId,
			creationDate: creationDate,
			gameMode: gameMode,
			gameFormat: gameFormat,
			buildNumber: buildNumber,
			scenarioId: scenarioId,
			result: result,
			additionalResult: additionalResult,
			coinPlay: playCoin,
			playerName: playerName,
			playerClass: playerClass,
			playerCardId: playerCardId,
			playerRank: playerRank,
			playerDeckName: playerDeckName,
			playerDecklist: deckstring,
			opponentName: opponentName,
			opponentClass: opponentClass,
			opponentCardId: opponentCardId,
			opponentRank: opponentRank,
			userId: userId,
			uploaderToken: uploaderToken,
			replayKey: reviewKey,
			application: application,
		});
		if (application === 'firestone') {
			sns.notifyFirestoneReviewPublished({
				reviewId: reviewId,
				creationDate: toCreationDate,
				gameMode: gameMode,
				gameFormat: gameFormat,
				buildNumber: buildNumber,
				scenarioId: scenarioId,
				result: result,
				additionalResult: additionalResult,
				coinPlay: playCoin,
				playerName: playerName,
				playerClass: playerClass,
				playerCardId: playerCardId,
				playerRank: playerRank,
				playerDeckName: playerDeckName,
				playerDecklist: deckstring,
				opponentName: opponentName,
				opponentClass: opponentClass,
				opponentCardId: opponentCardId,
				opponentRank: opponentRank,
				userId: userId,
				uploaderToken: uploaderToken,
				replayKey: reviewKey,
				application: application,
			});
		}
	} catch (e) {
		console.error('could not parse replay', replayString);
		// throw e;
	}

	return true;
};

const undefinedAsNull = (text: string): string => {
	return text === 'undefined' || !text || text.length === 0 ? null : text;
};

const toCreationDate = (today: Date): string => {
	return `${today
		.toISOString()
		.slice(0, 19)
		.replace('T', ' ')}.${today.getMilliseconds()}`;
};

const nullIfEmpty = (value: string): string => {
	return value == null ? 'NULL' : `${SqlString.escape(value)}`;
};
