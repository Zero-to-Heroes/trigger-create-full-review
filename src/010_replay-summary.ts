/* eslint-disable @typescript-eslint/no-use-before-define */
import { getConnection, logger, S3 } from '@firestone-hs/aws-lambda-utils';
import { BgsHeroQuest, parseHsReplayString, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService, GameFormatString, Race } from '@firestone-hs/reference-data';
import { Metadata } from 'aws-sdk/clients/s3';
import { decode } from 'deckstrings';
import SqlString from 'sqlstring';
import { v4 } from 'uuid';
import { ReplayInfo } from './create-full-review';
import { getDefaultHeroDbfIdForClass } from './hs-utils';
import { ReviewMessage } from './review-message';
import { Sns } from './services/sns';

export const saveReplayInReplaySummary = async (
	message,
	s3: S3,
	sns: Sns,
	cards: AllCardsService,
): Promise<ReplayInfo> => {
	const bucketName = message.bucket.name;
	const key: string = message.object.key;
	logger.debug('will get metadata');
	const metadata: Metadata = await s3.getObjectMetaData(bucketName, key);
	logger.debug('got metadata', metadata);
	if (!metadata) {
		logger.error('No metadata for review', bucketName, key);
		return null;
	}

	const userId = metadata['user-key'];
	const userName = metadata['username'];
	const replayString = await s3.readZippedContent(bucketName, key);
	logger.debug('got replayString', bucketName, key);
	if (!replayString) {
		logger.error('Could not read file, not processing review', bucketName, key);
		return null;
	}

	// if (replayString.includes(CardIds.Collectible.Rogue.MaestraOfTheMasquerade)) {
	// 	logger.error('Maestra games not supported yet', metadata, message, replayString);
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
	const gameFormat: GameFormatString = undefinedAsNull(metadata['game-format']) as GameFormatString;
	const application = undefinedAsNull(metadata['application-key']);
	const allowGameShare = getMetadataBool(metadata, 'allow-game-share');
	if (application !== 'firestone') {
		return null;
	}

	const reviewId = metadata['review-id'];
	const mysql = await getConnection();
	const existingReviewResult: any[] = await mysql.query(
		`SELECT * FROM replay_summary WHERE reviewId = '${reviewId}'`,
	);
	logger.debug('got existingReviewResult');

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
		logger.error('Could not parse replay', e, message);
		return null;
	}

	logger.debug('got parseHsReplayString');
	const playerName = replay.mainPlayerName;
	const opponentName =
		undefinedAsNull(decodeURIComponent(metadata['force-opponent-name'])) ?? replay.opponentPlayerName;
	const opponentCardId = replay.opponentPlayerCardId;
	const result = replay.result;
	const additionalResult =
		gameMode === 'battlegrounds' || gameMode === 'battlegrounds-friendly'
			? replay.additionalResult
			: undefinedAsNull(metadata['additional-result']);
	const playCoin = replay.playCoin;

	let playerClass = cards.getCard(replay.mainPlayerCardId)?.playerClass?.toLowerCase();
	let playerCardId = replay.mainPlayerCardId;
	if (gameMode === 'ranked') {
		try {
			// Because we might be playing a Maestra deck and ended the game before revealing ourselves
			const deckDefinition = !!deckstring?.length ? decode(deckstring) : null;
			const playerClassFromDeckstring = cards
				.getCardFromDbfId(deckDefinition?.heroes[0])
				?.playerClass?.toLowerCase();
			playerClass =
				!!playerClassFromDeckstring && playerClassFromDeckstring !== 'neutral'
					? playerClassFromDeckstring
					: cards.getCard(replay.mainPlayerCardId)?.playerClass?.toLowerCase();

			if (playerClass !== cards.getCard(replay.mainPlayerCardId)?.playerClass?.toLowerCase()) {
				playerCardId = cards.getCardFromDbfId(getDefaultHeroDbfIdForClass(playerClass)).id;
			}
		} catch (e) {
			console.error('could not properly parse deckstring', deckstring, e);
		}
	}

	const opponentClass = cards.getCard(opponentCardId)?.playerClass?.toLowerCase();
	const bgsHasPrizes = metadata['bgs-has-prizes'] === 'true';
	const runId = undefinedAsNull(metadata['run-id']) ?? undefinedAsNull(metadata['duels-run-id']);
	const bannedTribes = extractTribes(metadata['banned-races']);
	const availableTribes = extractTribes(metadata['available-races']);
	const xpGained = undefinedAsNull(metadata['normalized-xp-gained']);

	const quests: readonly BgsHeroQuest[] = gameMode === 'battlegrounds' ? replay.bgsHeroQuests ?? [] : [];
	const reviewToNotify: ReviewMessage = {
		reviewId: reviewId,
		creationDate: creationDate,
		gameMode: gameMode,
		gameFormat: gameFormat,
		buildNumber: +buildNumber,
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
		appChannel: undefinedAsNull(metadata['app-channel']),
		normalizedXpGained: xpGained == null ? null : parseInt(xpGained),
		bgsHasPrizes: bgsHasPrizes,
		mercBountyId: undefinedAsNull(metadata['mercs-bounty-id'])
			? +undefinedAsNull(metadata['mercs-bounty-id'])
			: null,
		region: replay.region,
		allowGameShare: allowGameShare,
		bgsHasQuests: replay.hasBgsQuests,
		bgsHeroQuests: quests.map(q => q.questCardId) as readonly string[],
		bgsQuestsCompletedTimings: quests.map(q => q.turnCompleted) as readonly number[],
		bgsHeroQuestRewards: quests.map(q => q.rewardCardId) as readonly string[],
	};

	const debug = reviewToNotify.appChannel === 'beta';
	logger.debug('built review message', message);

	if (existingReviewResult.length > 0) {
		return {
			userName: userName,
			replay: replay,
			reviewMessage: reviewToNotify,
			replayString: replayString,
			bgsPostMatchStats: null,
		};
	}

	logger.debug('Writing file', reviewId);
	await s3.writeCompressedFile(replayString, 'xml.firestoneapp.com', replayKey);
	logger.debug('file written');

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
				region,
				allowGameShare,
				bgsHasQuests,
				bgsHeroQuests,
				bgsQuestsCompletedTimings,
				bgsHeroQuestRewards
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
				${replay.region},
				${allowGameShare ? 1 : 0},
				${reviewToNotify.bgsHasQuests ? 1 : 0},
				${nullIfEmpty(quests?.map(q => q.questCardId).join(','))},
				${nullIfEmpty(quests?.map(q => q.turnCompleted).join(','))},
				${nullIfEmpty(quests?.map(q => q.rewardCardId).join(','))}
			)
		`;
	logger.debug('running query', query);
	await mysql.query(query);
	logger.debug('ran query');
	await mysql.end();
	logger.debug('closed connection');

	if (['duels', 'paid-duels'].includes(gameMode) && additionalResult) {
		// duels-leaderboard
		// sns.notifyDuelsReviewPublished(reviewToNotify);

		const [wins, losses] = additionalResult.split('-').map(info => parseInt(info));
		if ((wins === 11 && result === 'won') || (losses === 2 && result === 'lost' && wins >= 10)) {
			// trigger-build-duels-12-wins
			// sns.notifyDuels12winsReviewPublished(reviewToNotify);
		}

		if ((wins === 11 && result === 'won') || (losses === 2 && result === 'lost')) {
			// trigger-build-duels-run-stats
			// sns.notifyDuelsRunEndPublished(reviewToNotify);
		}
	} else if (['ranked'].includes(gameMode)) {
		sns.notifyReviewPublished(reviewToNotify);
		// For deck categorization only
		// sns.notifyRankedReviewPublished(reviewToNotify);
	} else if (['battlegrounds', 'battlegrounds-friendly'].includes(gameMode)) {
		// trigger-build-bgs-run-stats
		// sns.notifyBattlegroundsReviewPublished(reviewToNotify);
	} else if (
		[
			// 'mercenaries-pve',
			'mercenaries-pvp',
			// 'mercenaries-pve-coop',
			// 'mercenaries-ai-vs-ai',
			// 'mercenaries-friendly',
		].includes(gameMode)
	) {
		// trigger-build-mercenaries-match-stats
		// sns.notifyMercenariesReviewPublished(reviewToNotify);
	}
	logger.debug('notifs sent');

	return {
		userName: userName,
		replay: replay,
		reviewMessage: reviewToNotify,
		replayString: replayString,
		bgsPostMatchStats: null,
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
		logger.error('could not parse tribes', tribes, e);
		return null;
	}
};

const undefinedAsNull = (text: string): string => {
	return text === 'undefined' || text === 'null' || !text || text.length === 0 ? null : text;
};

const getMetadataBool = (metadata: any, key: string): boolean => {
	return metadata[key] === 'true';
};

const toCreationDate = (today: Date): string => {
	return `${today
		.toISOString()
		.slice(0, 19)
		.replace('T', ' ')}.${today.getMilliseconds()}`;
};

export const nullIfEmpty = (value: string): string => {
	return value == null || value == 'null' ? 'NULL' : `${SqlString.escape(value)}`;
};

const realNullIfEmpty = (value: string): string => {
	return value == null || value == 'null' || value == 'NULL' ? null : `${SqlString.escape(value)}`;
};
