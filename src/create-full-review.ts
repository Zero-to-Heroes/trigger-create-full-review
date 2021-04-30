/* eslint-disable @typescript-eslint/no-use-before-define */
import { parseHsReplayString, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Race } from '@firestone-hs/reference-data';
import { Metadata } from 'aws-sdk/clients/s3';
import SqlString from 'sqlstring';
import { v4 } from 'uuid';
import { AllCardsService } from './services/cards';
import { getConnection } from './services/rds';
import { S3 } from './services/s3';
import { Sqs } from './services/sqs';
import serverlessMysql = require('serverless-mysql');

const s3 = new S3();
const sqs = new Sqs();
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
	const mysql = await getConnection();
	await Promise.all(s3infos.map(s3 => handleReplay(s3, mysql)));
	await mysql.end();
	return { statusCode: 200, body: '' };
};

const handleReplay = async (message, mysql: serverlessMysql.ServerlessMysql): Promise<boolean> => {
	const bucketName = message.bucket.name;
	const key: string = message.object.key;

	const metadata: Metadata = await s3.getObjectMetaData(bucketName, key);
	if (!metadata) {
		console.error('No metadata for review', bucketName, key);
		return false;
	}

	const userId = metadata['user-key'];
	const userName = metadata['username'];
	const replayString = await s3.readZippedContent(bucketName, key);
	if (!replayString) {
		console.error('Could not read file, not processing review', bucketName, key);
		return false;
	}

	const uploaderToken = 'overwolf-' + userId;
	const deckstring = undefinedAsNull(metadata['deckstring']);
	const playerDeckName = undefinedAsNull(metadata['deck-name']);
	const scenarioId = undefinedAsNull(metadata['scenario-id']);
	const buildNumber = undefinedAsNull(metadata['build-number']);
	const playerRank = undefinedAsNull(metadata['player-rank']);
	const newPlayerRank = undefinedAsNull(metadata['new-player-rank']);
	const opponentRank = undefinedAsNull(metadata['opponent-rank']);
	const gameMode = undefinedAsNull(metadata['game-mode']);
	const gameFormat = undefinedAsNull(metadata['game-format']);
	const application = undefinedAsNull(metadata['application-key']);
	if (application !== 'firestone') {
		return false;
	}

	const reviewId = metadata['review-id'];
	const review: any = await mysql.query(`SELECT * FROM replay_summary WHERE reviewId = '${reviewId}'`);
	if (review.length > 0) {
		return true;
	}

	const inputReplayKey = undefinedAsNull(metadata['replay-key']);
	const today = new Date();
	const replayKey =
		inputReplayKey ??
		`hearthstone/replay/${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}/${v4()}.xml.zip`;
	const creationDate = toCreationDate(today);

	let replay: Replay;
	try {
		replay = parseHsReplayString(replayString);
	} catch (e) {
		console.error('Could not parse replay', e, message);
		return false;
	}
	const playerName = replay.mainPlayerName;
	const opponentName = replay.opponentPlayerName;
	const playerCardId = replay.mainPlayerCardId;
	const opponentCardId = replay.opponentPlayerCardId;
	const result = replay.result;
	const additionalResult =
		gameMode === 'battlegrounds' ? replay.additionalResult : undefinedAsNull(metadata['additional-result']);
	const playCoin = replay.playCoin;
	const playerClass = cards.getCard(playerCardId)?.playerClass?.toLowerCase();
	const opponentClass = cards.getCard(opponentCardId)?.playerClass?.toLowerCase();

	console.log('Writing file'), replayString;
	await s3.writeCompressedFile(replayString, 'xml.firestoneapp.com', replayKey);

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
				newPlayerRank,
				playerDeckName,
				playerDecklist,
				opponentName,
				opponentClass,
				opponentCardId,
				opponentRank,
				userId,
				userName,
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
				${nullIfEmpty(newPlayerRank)},
				${nullIfEmpty(playerDeckName)},
				${nullIfEmpty(deckstring)},
				${nullIfEmpty(opponentName)},
				${nullIfEmpty(opponentClass)},
				${nullIfEmpty(opponentCardId)},
				${nullIfEmpty(opponentRank)},
				${nullIfEmpty(userId)},
				${nullIfEmpty(userName)},
				${nullIfEmpty(uploaderToken)},
				${nullIfEmpty(replayKey)},
				${nullIfEmpty(application)}
			)
		`;
	await mysql.query(query);

	const bannedTribes = extractTribes(metadata['banned-races']);
	const availableTribes = extractTribes(metadata['available-races']);
	const currentDuelsRunId =
		gameMode === 'duels' || gameMode === 'paid-duels'
			? undefinedAsNull(metadata['duels-run-id']) ??
			  (await findCurrentDuelsRunId(mysql, gameMode, additionalResult, userId, userName))
			: null;

	const xpGained = undefinedAsNull(metadata['normalized-xp-gained']);
	const reviewToNotify = {
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
		newPlayerRank: newPlayerRank,
		playerDeckName: playerDeckName,
		playerDecklist: deckstring,
		opponentName: opponentName,
		opponentClass: opponentClass,
		opponentCardId: opponentCardId,
		opponentRank: opponentRank,
		userId: userId,
		userName: userName,
		uploaderToken: uploaderToken,
		replayKey: replayKey,
		application: application,
		availableTribes: availableTribes,
		bannedTribes: bannedTribes,
		currentDuelsRunId: currentDuelsRunId,
		appVersion: realNullIfEmpty(undefinedAsNull(metadata['app-version'])),
		normalizedXpGained: xpGained == null ? null : parseInt(xpGained),
	};

	sqs.sendMessageToQueue(reviewToNotify, process.env.SQS_RANKED_REVIEW_PUBLISHED);

	if (['duels', 'paid-duels'].includes(gameMode) && additionalResult) {
		const [wins, losses] = additionalResult.split('-').map(info => parseInt(info));
		if ((wins === 11 && result === 'won') || (losses === 2 && result === 'lost' && wins >= 10)) {
			sqs.sendMessageToQueue(reviewToNotify, process.env.SQS_DUELS_HIGH_WINS_REVIEW_PUBLISHED);
		}
	}

	// only for categorize deck, will be reactivated later
	// if (['ranked'].includes(gameMode)) {
	// 	// sns.notifyRankedReviewPublished(reviewToNotify);
	// }

	return true;
};

const findCurrentDuelsRunId = async (
	mysql,
	gameMode: 'duels' | 'paid-duels',
	additionalResult: string,
	userId: string,
	userName: string,
): Promise<string> => {
	const [wins, losses] = additionalResult ? additionalResult.split('-').map(parseInt) : [];
	// New run
	if (wins === 0 && losses === 0) {
		return null;
	}
	const userCondition =
		userName && userId
			? ` AND userName = '${userName}' OR userId = '${userId}'`
			: userName
			? ` AND userName = '${userName}'`
			: ` AND userId = '${userId}'`;
	const query = `
		SELECT reviewId, additionalResult FROM replay_summary
		WHERE gameMode = '${gameMode}'
		${userCondition}
		ORDER BY ID desc
		LIMIT 1
	`;
	const dbResult: any[] = await mysql.query(query);
	const reviewId = dbResult && dbResult.length > 0 ? dbResult[0].reviewId : null;
	if (!reviewId) {
		return null;
	}

	const [existingWins, existingLosses] = dbResult[0].additionalResult
		? dbResult[0].additionalResult.split('-').map(parseInt)
		: [];
	// If there is more wins or losses than what we have today, it's a new run as well
	if (existingWins > wins || existingLosses > losses) {
		return null;
	}

	const statQuery = `SELECT statValue FROM duels WHERE reviewId = '${reviewId}' AND statName = 'duels-run-id'`;
	const duelsResults = await mysql.query(query);
	const runId = duelsResults && duelsResults.length > 0 ? duelsResults[0].runId : null;
	return runId;
};

const extractTribes = (tribes: string): readonly Race[] => {
	if (!tribes || tribes.length === 0 || tribes === 'undefined' || tribes === 'null') {
		return null;
	}
	try {
		const parsed: readonly string[] = JSON.parse(tribes);
		return parsed.map(tribe => parseInt(tribe));
	} catch (e) {
		console.error('could not parse tribes', tribes, e);
		return null;
	}
};

const undefinedAsNull = (text: string): string => {
	return text === 'undefined' || text === 'null' || !text || text.length === 0 ? null : text;
};

const toCreationDate = (today: Date): string => {
	return `${today
		.toISOString()
		.slice(0, 19)
		.replace('T', ' ')}.${today.getMilliseconds()}`;
};

const nullIfEmpty = (value: string): string => {
	return value == null || value == 'null' ? 'NULL' : `${SqlString.escape(value)}`;
};

const realNullIfEmpty = (value: string): string => {
	return value == null || value == 'null' || value == 'NULL' ? null : `${SqlString.escape(value)}`;
};
