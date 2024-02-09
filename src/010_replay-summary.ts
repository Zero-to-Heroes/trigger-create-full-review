/* eslint-disable @typescript-eslint/no-use-before-define */
import { getConnection, logger, S3, Sns } from '@firestone-hs/aws-lambda-utils';
import { decode } from '@firestone-hs/deckstrings';
import { BgsHeroQuest, parseHsReplayString, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService, GameFormatString, Race } from '@firestone-hs/reference-data';
import { ReplayUploadMetadata } from '@firestone-hs/replay-metadata';
import { Metadata } from 'aws-sdk/clients/s3';
import { deflate } from 'pako';
import SqlString from 'sqlstring';
import { v4 } from 'uuid';
import { ReplayInfo } from './create-full-review';
import { getDefaultHeroDbfIdForClass } from './hs-utils';
import { ReviewMessage } from './review-message';

export const saveReplayInReplaySummary = async (
	message,
	s3: S3,
	sns: Sns,
	cards: AllCardsService,
): Promise<ReplayInfo> => {
	const bucketName = message.bucket.name;
	const key: string = message.object.key;

	let start = Date.now();
	let replayString = await s3.readZippedContent(bucketName, key);
	// logger.debug('got replayString after', Date.now() - start, 'ms', bucketName, key);
	if (!replayString) {
		logger.error('Could not read file, not processing review', bucketName, key);
		return null;
	}

	// New metadata format
	let fullMetaData: ReplayUploadMetadata | null = null;
	if (replayString?.startsWith('{')) {
		const metadataStr = replayString;
		if (!!metadataStr?.length) {
			fullMetaData = JSON.parse(metadataStr);
		}
		replayString = null; //replayString.substring(index + 1);
	}

	// logger.debug('will get metadata');
	const metadata: Metadata = await s3.getObjectMetaData(bucketName, key);
	// logger.debug('got metadata', metadata);
	if (!fullMetaData && !metadata) {
		logger.error('No metadata for review', bucketName, key);
		return null;
	}

	const userId = fullMetaData?.user.userId ?? metadata['user-key'];
	const userName = fullMetaData?.user.userName ?? metadata['username'];
	// logger.debug('will get replay string', metadata);

	const debug = userName === 'daedin';

	// if (replayString.includes(CardIds.Collectible.Rogue.MaestraOfTheMasquerade)) {
	// 	logger.error('Maestra games not supported yet', metadata, message, replayString);
	// 	throw new Error('Maestra games not supported yet');
	// }

	const uploaderToken = 'overwolf-' + userId;
	const deckstring = fullMetaData?.game ? fullMetaData.game.deckstring : undefinedAsNull(metadata['deckstring']);
	const playerDeckName = fullMetaData?.game ? fullMetaData.game.deckName : undefinedAsNull(metadata['deck-name']);
	const scenarioId = fullMetaData?.game ? fullMetaData.game.scenarioId : undefinedAsNull(metadata['scenario-id']);
	const buildNumber = fullMetaData?.game ? fullMetaData.game.buildNumber : undefinedAsNull(metadata['build-number']);
	const playerRank = fullMetaData?.game ? fullMetaData.game.playerRank : undefinedAsNull(metadata['player-rank']);
	const newPlayerRank = fullMetaData?.game
		? fullMetaData.game.newPlayerRank
		: undefinedAsNull(metadata['new-player-rank']);
	const opponentRank = fullMetaData?.game
		? fullMetaData.game.opponentRank
		: undefinedAsNull(metadata['opponent-rank']);
	const gameMode = fullMetaData?.game ? fullMetaData.game.gameMode : undefinedAsNull(metadata['game-mode']);
	const gameFormat: GameFormatString = fullMetaData?.game
		? (fullMetaData.game.gameFormat as GameFormatString)
		: (undefinedAsNull(metadata['game-format']) as GameFormatString);
	const application = fullMetaData?.meta.application ?? undefinedAsNull(metadata['application-key']);
	const allowGameShare = fullMetaData?.meta.allowGameShare ?? getMetadataBool(metadata, 'allow-game-share');

	const reviewId = fullMetaData?.game ? fullMetaData.game.reviewId : metadata['review-id'];
	start = Date.now();
	const mysql = await getConnection();
	const existingReviewResult: any[] = await mysql.query(
		`SELECT * FROM replay_summary WHERE reviewId = '${reviewId}'`,
	);
	// logger.debug('got existingReviewResult after', Date.now() - start, 'ms', reviewId);

	const inputReplayKey = fullMetaData?.game ? fullMetaData.game.replayKey : undefinedAsNull(metadata['replay-key']);
	const today = new Date();
	const replayKey =
		inputReplayKey ??
		`hearthstone/replay/${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}/${v4()}.xml.zip`;
	const creationDate = toCreationDate(today);

	let replay: Replay;
	if (!fullMetaData) {
		try {
			// logger.debug('will parse replay string');
			start = Date.now();
			replay = parseHsReplayString(replayString, cards as any);
		} catch (e) {
			logger.error('Could not parse replay', e, message);
			return null;
		}
	}

	// logger.debug(
	// 	'got parseHsReplayString after',
	// 	Date.now() - start,
	// 	'ms',
	// 	reviewId,
	// 	fullMetaData != null,
	// 	fullMetaData?.game.replayKey,
	// );
	const playerName = fullMetaData?.game ? fullMetaData.game.mainPlayerName : replay.mainPlayerName;
	const opponentName = fullMetaData?.game
		? fullMetaData.game.forceOpponentName ?? fullMetaData.game.opponentPlayerName
		: undefinedAsNull(decodeURIComponent(metadata['force-opponent-name'])) ?? replay.opponentPlayerName;
	const opponentCardId = fullMetaData?.game ? fullMetaData.game.opponentPlayerCardId : replay.opponentPlayerCardId;
	const result = fullMetaData?.game ? fullMetaData.game.result : replay.result;
	const additionalResult = fullMetaData?.game
		? fullMetaData.game.additionalResult
		: gameMode === 'battlegrounds' || gameMode === 'battlegrounds-friendly'
		? replay.additionalResult
		: undefinedAsNull(metadata['additional-result']);
	const playCoin = fullMetaData?.game ? fullMetaData.game.playCoin : replay.playCoin;

	let playerCardId = fullMetaData?.game ? fullMetaData.game.mainPlayerCardId : replay.mainPlayerCardId;
	let playerClass = cards.getCard(playerCardId)?.playerClass?.toLowerCase();
	if (!!deckstring?.length) {
		try {
			// Because we might be playing a Maestra deck and ended the game before revealing ourselves,
			// or because in some tavern brawls (like the chess one) the hero we play with does not
			// reflect the class of the deck we built
			const deckDefinition = deckstring?.length ? decode(deckstring) : null;
			const playerClassFromDeckstring = cards
				.getCardFromDbfId(deckDefinition?.heroes[0])
				?.playerClass?.toLowerCase();
			playerClass =
				!!playerClassFromDeckstring && playerClassFromDeckstring !== 'neutral'
					? playerClassFromDeckstring
					: cards.getCard(playerCardId)?.playerClass?.toLowerCase();

			if (playerClass !== cards.getCard(playerCardId)?.playerClass?.toLowerCase()) {
				playerCardId = cards.getCardFromDbfId(getDefaultHeroDbfIdForClass(playerClass)).id;
			}
		} catch (e) {
			logger.error('could not properly parse deckstring', deckstring, e);
		}
	}

	// logger.debug('checkpoint 1');
	const opponentClass = cards.getCard(opponentCardId)?.playerClass?.toLowerCase();
	const bgsHasPrizes = fullMetaData?.bgs?.hasPrizes ?? metadata['bgs-has-prizes'] === 'true';
	const bgsHasSpells = fullMetaData?.bgs?.hasSpells ?? metadata['bgs-has-spells'] === 'true';
	const runId = fullMetaData?.game
		? fullMetaData.game.runId
		: undefinedAsNull(metadata['run-id']) ?? undefinedAsNull(metadata['duels-run-id']);
	const bannedTribes = fullMetaData?.bgs?.bannedTribes ?? extractTribes(metadata['banned-races']);
	const availableTribes = fullMetaData?.bgs?.availableTribes ?? extractTribes(metadata['available-races']);
	const xpGained = fullMetaData?.meta.normalizedXpGained ?? undefinedAsNull(metadata['normalized-xp-gained']);

	const quests: readonly BgsHeroQuest[] =
		fullMetaData?.bgs?.heroQuests ?? (gameMode === 'battlegrounds' ? replay?.bgsHeroQuests ?? [] : []);
	const bgsAnomalies: readonly string[] =
		fullMetaData?.bgs?.anomalies ?? (gameMode === 'battlegrounds' ? replay?.bgsAnomalies ?? [] : []);
	const bgBattleOdds: readonly { turn: number; wonPercent: number }[] =
		fullMetaData?.bgs?.battleOdds ??
		(!!metadata['bg-battle-odds']?.length ? JSON.parse(metadata['bg-battle-odds']) : []);

	const reviewToNotify: ReviewMessage = {
		reviewId: reviewId,
		creationDate: creationDate,
		gameMode: gameMode,
		gameFormat: gameFormat,
		buildNumber: +buildNumber,
		scenarioId: '' + scenarioId,
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
		metadataKey: key,
		application: application,
		availableTribes: availableTribes,
		bannedTribes: bannedTribes,
		currentDuelsRunId: runId,
		runId: runId,
		appVersion: fullMetaData?.meta?.appVersion ?? undefinedAsNull(metadata['app-version']),
		appChannel: fullMetaData?.meta?.appChannel ?? undefinedAsNull(metadata['app-channel']),
		normalizedXpGained:
			fullMetaData?.meta.normalizedXpGained ?? (xpGained == null ? null : parseInt('' + xpGained)),
		bgsHasPrizes: bgsHasPrizes,
		bgsHasSpells: bgsHasSpells,
		mercBountyId:
			fullMetaData?.mercs?.bountyId ??
			(undefinedAsNull(metadata['mercs-bounty-id']) ? +undefinedAsNull(metadata['mercs-bounty-id']) : null),
		region: fullMetaData?.meta?.region ?? replay.region,
		allowGameShare: allowGameShare,
		bgsHasQuests: fullMetaData?.bgs?.hasQuests ?? replay?.hasBgsQuests,
		bgsHeroQuests: quests.map((q) => q.questCardId) as readonly string[],
		bgsQuestsCompletedTimings: quests.map((q) => q.turnCompleted) as readonly number[],
		bgsQuestsDifficulties: quests.map((q) => q.questDifficulty) as readonly number[],
		bgsHeroQuestRewards: quests.map((q) => q.rewardCardId) as readonly string[],
		bgBattleOdds: bgBattleOdds,
		bgsHasAnomalies: fullMetaData?.bgs?.hasAnomalies ?? replay?.hasBgsAnomalies,
		bgsAnomalies: bgsAnomalies,
	};

	// const debug = reviewToNotify.appChannel === 'beta';
	// logger.debug('built review message');

	if (existingReviewResult.length > 0) {
		const returnMessage = {
			userName: userName,
			replay: replay,
			fullMetaData: fullMetaData,
			reviewMessage: reviewToNotify,
			replayString: replayString,
			bgsPostMatchStats: null,
		};
		// logger.debug('returning early', returnMessage);
		return returnMessage;
	}

	// logger.debug('Writing file', reviewId);
	if (!!replayString?.length) {
		start = Date.now();
		await s3.writeCompressedFile(replayString, 'xml.firestoneapp.com', replayKey);
		// logger.debug('file written after', Date.now() - start, 'ms', reviewId);
	}

	const existQuery = `
		SELECT * from replay_summary
		WHERE reviewId = ${SqlString.escape(reviewId)}
	`;
	const existResult: any[] = await mysql.query(existQuery);
	if (!existResult.length) {
		const query = `
			INSERT IGNORE INTO replay_summary
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
				bgsHasSpells,
				bgsHeroQuests,
				bgsQuestsCompletedTimings,
				bgsQuestsDifficulties,
				bgsHeroQuestRewards,
				bgsAnomalies,
				bgsAvailableTribes,
				bgsBannedTribes,
				bgsPerfectGame,
				finalComp,
				normalizedXpGain,
				totalDurationSeconds,
				totalDurationTurns
			)
			VALUES
			(
				${nullIfEmpty(reviewId)},
				${nullIfEmpty(creationDate)},
				${nullIfEmpty(gameMode)},
				${nullIfEmpty(gameFormat)},
				${nullIfEmpty('' + buildNumber)},
				${nullIfEmpty('' + scenarioId)},
				${nullIfEmpty(result)},
				${nullIfEmpty(additionalResult)},
				${nullIfEmpty(playCoin)},
				${nullIfEmpty(playerName)},
				${nullIfEmpty(playerClass)},
				${nullIfEmpty(playerCardId)},
				${nullIfEmpty(gameMode === 'mercenaries-pve' ? null : playerRank)},
				${nullIfEmpty(gameMode === 'mercenaries-pve' ? null : newPlayerRank)},
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
				${nullIfEmpty(fullMetaData?.meta.realXpGained ?? metadata['real-xp-gamed'])},
				${nullIfEmpty(fullMetaData?.meta?.levelAfterMatch ?? metadata['level-after-match'])},
				${bgsHasPrizes ? 1 : 0},
				${nullIfEmpty(fullMetaData?.mercs?.bountyId ?? metadata['mercs-bounty-id'])},
				${nullIfEmpty(runId)},
				${fullMetaData?.meta.region ?? replay.region},
				${allowGameShare ? 1 : 0},
				${reviewToNotify.bgsHasQuests ? 1 : 0},
				${reviewToNotify.bgsHasSpells ? 1 : 0},
				${nullIfEmpty(quests?.map((q) => q.questCardId).join(','))},
				${nullIfEmpty(quests?.map((q) => q.turnCompleted).join(','))},
				${nullIfEmpty(quests?.map((q) => q.questDifficulty).join(','))},
				${nullIfEmpty(quests?.map((q) => q.rewardCardId).join(','))},
				${nullIfEmpty(bgsAnomalies.join(','))},
				${nullIfEmpty(fullMetaData?.bgs?.availableTribes?.join(','))},
				${nullIfEmpty(fullMetaData?.bgs?.bannedTribes?.join(','))},
				${fullMetaData?.bgs?.isPerfectGame ? 1 : 0},
				${nullIfEmpty(fullMetaData?.bgs?.finalComp ? compressStats(fullMetaData.bgs.finalComp) : null)},
				${nullIfEmpty(fullMetaData?.meta?.normalizedXpGained)},
				${nullIfEmpty(fullMetaData?.game.totalDurationSeconds)},
				${nullIfEmpty(fullMetaData?.game.totalDurationTurns)}
			)
		`;
		// logger.debug('running query', query);
		await mysql.query(query);
		// logger.debug('ran query');
	}
	await mysql.end();
	// logger.debug('closed connection');

	debug && console.debug(reviewToNotify.userName, 'will send SNS', gameMode, reviewToNotify);
	if (['duels', 'paid-duels'].includes(gameMode) && additionalResult) {
		// // duels-leaderboard
		// // sns.notifyDuelsReviewPublished(reviewToNotify);
		// const [wins, losses] = additionalResult.split('-').map((info) => parseInt(info));
		// if ((wins === 11 && result === 'won') || (losses === 2 && result === 'lost' && wins >= 10)) {
		// 	// trigger-build-duels-12-wins
		// 	// sns.notifyDuels12winsReviewPublished(reviewToNotify);
		// }
		// if ((wins === 11 && result === 'won') || (losses === 2 && result === 'lost')) {
		// 	// trigger-build-duels-run-stats
		// 	// sns.notifyDuelsRunEndPublished(reviewToNotify);
		// }
	} else if (['ranked'].includes(gameMode)) {
		sns.notify(process.env.REVIEW_PUBLISHED_SNS_TOPIC, JSON.stringify(reviewToNotify));
		// For deck categorization only
		// sns.notifyRankedReviewPublished(reviewToNotify);
	} else if (['arena'].includes(gameMode)) {
		sns.notify(process.env.ARENA_REVIEW_PUBLISHED_SNS_TOPIC, JSON.stringify(reviewToNotify));
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
	// logger.debug('notifs sent');

	return {
		userName: userName,
		replay: replay,
		fullMetaData: fullMetaData,
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
		return parsed.map((tribe) => parseInt(tribe));
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
	return `${today.toISOString().slice(0, 19).replace('T', ' ')}.${today.getMilliseconds()}`;
};

export const nullIfEmpty = (value: string | number): string => {
	return value == null || value == 'null' || value == 'undefined' ? 'NULL' : `${SqlString.escape(value)}`;
};

const realNullIfEmpty = (value: string): string => {
	return value == null || value == 'null' || value == 'NULL' ? null : `${SqlString.escape(value)}`;
};

const compressStats = (stats: any): string => {
	const compressedStats = deflate(JSON.stringify(stats), { to: 'string' });
	const buff = Buffer.from(compressedStats, 'utf8');
	const base64data = buff.toString('base64');
	return base64data;
};
