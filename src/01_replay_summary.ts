/* eslint-disable @typescript-eslint/no-use-before-define */
import { parseHsReplayString, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService, Race } from '@firestone-hs/reference-data';
import { Metadata } from 'aws-sdk/clients/s3';
import SqlString from 'sqlstring';
import { v4 } from 'uuid';
// import { AllCardsService } from './services/cards';
import { getConnection } from './services/rds';
import { S3 } from './services/s3';
import { Sns } from './services/sns';
import serverlessMysql = require('serverless-mysql');

export const saveReplayInReplaySummary = async (
	message,
	s3: S3,
	sns: Sns,
	cards: AllCardsService,
): Promise<ReplayInfo> => {
	const bucketName = message.bucket.name;
	const key: string = message.object.key;

	const metadata: Metadata = await s3.getObjectMetaData(bucketName, key);
	if (!metadata) {
		console.error('No metadata for review', bucketName, key);
		return null;
	}

	const userId = metadata['user-key'];
	const userName = metadata['username'];
	const debug = userName === 'daedin';
	if (debug) {
		console.log('porocessing', message);
	}
	const replayString = await s3.readZippedContent(bucketName, key);
	if (!replayString) {
		console.error('Could not read file, not processing review', bucketName, key);
		return null;
	}

	// if (replayString.includes(CardIds.Collectible.Rogue.MaestraOfTheMasquerade)) {
	// 	console.error('Maestra games not supported yet', metadata, message, replayString);
	// 	throw new Error('Maestra games not supported yet');
	// }

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
		return null;
	}

	const reviewId = metadata['review-id'];
	const mysql = await getConnection();
	const review: any = await mysql.query(`SELECT * FROM replay_summary WHERE reviewId = '${reviewId}'`);
	if (review.length > 0) {
		return {
			userName: userName,
		};
	}

	const inputReplayKey = undefinedAsNull(metadata['replay-key']);
	const today = new Date();
	const replayKey =
		inputReplayKey ??
		`hearthstone/replay/${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}/${v4()}.xml.zip`;
	const creationDate = toCreationDate(today);

	let replay: Replay;
	try {
		replay = parseHsReplayString(replayString, cards as any);
	} catch (e) {
		console.error('Could not parse replay', e, message);
		return null;
	}
	const playerName = replay.mainPlayerName;
	const opponentName = undefinedAsNull(metadata['force-opponent-name']) ?? replay.opponentPlayerName;
	const playerCardId = replay.mainPlayerCardId;
	const opponentCardId = replay.opponentPlayerCardId;
	const result = replay.result;
	const additionalResult =
		gameMode === 'battlegrounds' ? replay.additionalResult : undefinedAsNull(metadata['additional-result']);
	const playCoin = replay.playCoin;
	const playerClass = cards.getCard(playerCardId)?.playerClass?.toLowerCase();
	const opponentClass = cards.getCard(opponentCardId)?.playerClass?.toLowerCase();
	const bgsHasPrizes = metadata['bgs-has-prizes'] === 'true';
	const runId = undefinedAsNull(metadata['run-id']) ?? undefinedAsNull(metadata['duels-run-id']);

	console.log('Writing file', reviewId);
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
				application,
				realXpGain,
				levelAfterMatch,
				bgsHasPrizes,
				mercsBountyId,
				runId,
				region
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
				${nullIfEmpty(application)},
				${nullIfEmpty(metadata['real-xp-gamed'])},
				${nullIfEmpty(metadata['level-after-match'])},
				${bgsHasPrizes ? 1 : 0},
				${nullIfEmpty(metadata['mercs-bounty-id'])},
				${nullIfEmpty(runId)},
				${replay.region}
			)
		`;
	await mysql.query(query);
	await mysql.end();

	const bannedTribes = extractTribes(metadata['banned-races']);
	const availableTribes = extractTribes(metadata['available-races']);

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
		currentDuelsRunId: runId,
		runId: runId,
		appVersion: undefinedAsNull(metadata['app-version']),
		normalizedXpGained: xpGained == null ? null : parseInt(xpGained),
		bgsHasPrizes: bgsHasPrizes,
		mercBountyId: undefinedAsNull(metadata['mercs-bounty-id'])
			? +undefinedAsNull(metadata['mercs-bounty-id'])
			: null,
		region: replay.region,
	};
	sns.notifyReviewPublished(reviewToNotify);

	if (['duels', 'paid-duels'].includes(gameMode) && additionalResult) {
		const [wins, losses] = additionalResult.split('-').map(info => parseInt(info));
		if ((wins === 11 && result === 'won') || (losses === 2 && result === 'lost' && wins >= 10)) {
			sns.notifyDuels12winsReviewPublished(reviewToNotify);
		}

		sns.notifyDuelsReviewPublished(reviewToNotify);
		if ((wins === 11 && result === 'won') || (losses === 2 && result === 'lost')) {
			sns.notifyDuelsRunEndPublished(reviewToNotify);
		}
	} else if (['ranked'].includes(gameMode)) {
		sns.notifyRankedReviewPublished(reviewToNotify);
	} else if (['battlegrounds'].includes(gameMode)) {
		sns.notifyBattlegroundsReviewPublished(reviewToNotify);
	} else if (
		[
			// 'mercenaries-pve',
			'mercenaries-pvp',
			// 'mercenaries-pve-coop',
			// 'mercenaries-ai-vs-ai',
			// 'mercenaries-friendly',
		].includes(gameMode)
	) {
		sns.notifyMercenariesReviewPublished(reviewToNotify);
	}

	return {
		userName: userName,
	};
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

export interface ReplayInfo {
	readonly userName: string;
}