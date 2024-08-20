/* eslint-disable @typescript-eslint/no-use-before-define */
import { getConnection, logger, Sns } from '@firestone-hs/aws-lambda-utils';
import { BgsPostMatchStats, parseBattlegroundsGame } from '@firestone-hs/hs-replay-xml-parser';
import { AllCardsService } from '@firestone-hs/reference-data';
import { ServerlessMysql } from 'serverless-mysql';
import SqlString from 'sqlstring';
import { nullIfEmpty } from './010_replay-summary';
import { ReplayInfo } from './create-full-review';

export const buildBgsRunStats = async (replayInfo: ReplayInfo, allCards: AllCardsService, sns: Sns): Promise<void> => {
	const message = replayInfo.reviewMessage;
	if (
		message.gameMode !== 'battlegrounds' &&
		message.gameMode !== 'battlegrounds-friendly' &&
		message.gameMode !== 'battlegrounds-duo'
	) {
		// logger.debug('not battlegrounds', message);
		return;
	}
	if (!message.additionalResult || isNaN(parseInt(message.additionalResult))) {
		// logger.debug('no end position', message);
		return;
	}

	// Handling skins

	const replayString = replayInfo.replayString;
	const bgParsedInfo = replayInfo?.fullMetaData?.bgs?.warbandStats
		? null
		: parseBattlegroundsGame(replayString, null, null, null, allCards);

	const mysql = await getConnection();
	if (message.gameMode === 'battlegrounds-duo') {
		await handleDuoGame(replayInfo, bgParsedInfo, allCards, mysql, sns);
	} else {
		handleSoloGame(replayInfo, bgParsedInfo, allCards, mysql, sns);
	}
	await mysql.end();
};

const handleDuoGame = async (
	replayInfo: ReplayInfo,
	bgParsedInfo: BgsPostMatchStats,
	allCards: AllCardsService,
	mysql: ServerlessMysql,
	sns: Sns,
) => {
	const message = replayInfo.reviewMessage;
	const heroCardId = normalizeHeroCardId(message.playerCardId, allCards);
	const warbandStats =
		replayInfo?.fullMetaData?.bgs?.warbandStats ?? (await buildWarbandStats(bgParsedInfo, replayInfo));
	// Because there is a race, the combat winrate might have been populated first
	const combatWinrate = replayInfo?.fullMetaData?.bgs?.battleOdds;
	// logger.debug('retrieved combat winrate?', combatWinrate);
	const playerRank = message.playerRank ?? message.newPlayerRank;

	const row: InternalBgsRow = {
		creationDate: new Date(message.creationDate),
		buildNumber: message.buildNumber,
		reviewId: message.reviewId,
		rank: parseInt(message.additionalResult),
		heroCardId: heroCardId,
		rating: playerRank == null || isNaN(parseInt(playerRank)) ? null : parseInt(playerRank),
		tribes: message.availableTribes
			?.map((tribe) => tribe.toString())
			.sort()
			.join(','),
		darkmoonPrizes: false,
		warbandStats: warbandStats,
		combatWinrate: combatWinrate,
		quests: message.bgsHasQuests,
		bgsHeroQuests: message.bgsHeroQuests,
		bgsQuestsCompletedTimings: message.bgsQuestsCompletedTimings,
		bgsQuestsDifficulties: message.bgsQuestsDifficulties,
		bgsHeroQuestRewards: message.bgsHeroQuestRewards,
		bgsAnomalies: message.bgsAnomalies,
		bgsTrinkets: message.bgsTrinkets,
		bgsTrinketOptions: message.bgsTrinketOptions,
	};

	const insertQuery = `
		INSERT IGNORE INTO bgs_run_stats_duo
		(
			creationDate,
			buildNumber,
			playerRank,
			heroCardId,
			rating,
			reviewId,
			darkmoonPrizes,
			tribes,
			combatWinrate,
			warbandStats,
			quests,
			bgsHeroQuests,
			bgsQuestsCompletedTimings,
			bgsQuestsDifficulties,
			bgsHeroQuestRewards,
			bgsAnomalies,
			bgsTrinkets,
			bgsTrinketsOptions
		)
		VALUES 
		(
			${SqlString.escape(row.creationDate)},
			${SqlString.escape(row.buildNumber)}, 
			${SqlString.escape(row.rank)}, 
			${SqlString.escape(row.heroCardId)},
			${SqlString.escape(row.rating)},
			${SqlString.escape(row.reviewId)},
			${SqlString.escape(row.darkmoonPrizes)},
			${SqlString.escape(row.tribes)},
			${SqlString.escape(JSON.stringify(row.combatWinrate))},
			${SqlString.escape(JSON.stringify(row.warbandStats))},
			${SqlString.escape(row.quests)},
			${nullIfEmpty(row.bgsHeroQuests?.join(','))},
			${nullIfEmpty(row.bgsQuestsCompletedTimings?.join(','))},
			${nullIfEmpty(row.bgsQuestsDifficulties?.join(','))},
			${nullIfEmpty(row.bgsHeroQuestRewards?.join(','))},
			${nullIfEmpty(row.bgsAnomalies?.join(','))},
			${nullIfEmpty(row.bgsTrinkets?.join(','))},
			${nullIfEmpty(row.bgsTrinketOptions?.join(','))}
		)
	`;
	// logger.debug('running query', insertQuery);
	await mysql.query(insertQuery);
};

const handleSoloGame = async (
	replayInfo: ReplayInfo,
	bgParsedInfo: BgsPostMatchStats,
	allCards: AllCardsService,
	mysql: ServerlessMysql,
	sns: Sns,
) => {
	const message = replayInfo.reviewMessage;
	const heroCardId = normalizeHeroCardId(message.playerCardId, allCards);
	const warbandStats =
		replayInfo?.fullMetaData?.bgs?.warbandStats ?? (await buildWarbandStats(bgParsedInfo, replayInfo));
	// Because there is a race, the combat winrate might have been populated first
	const combatWinrate = replayInfo?.fullMetaData?.bgs?.battleOdds;
	// logger.debug('retrieved combat winrate?', combatWinrate);
	const playerRank = message.playerRank ?? message.newPlayerRank;

	const row: InternalBgsRow = {
		creationDate: new Date(message.creationDate),
		buildNumber: message.buildNumber,
		reviewId: message.reviewId,
		rank: parseInt(message.additionalResult),
		heroCardId: heroCardId,
		rating: playerRank == null || isNaN(parseInt(playerRank)) ? null : parseInt(playerRank),
		tribes: message.availableTribes
			?.map((tribe) => tribe.toString())
			.sort()
			.join(','),
		darkmoonPrizes: false,
		warbandStats: warbandStats,
		combatWinrate: combatWinrate,
		quests: message.bgsHasQuests,
		bgsHeroQuests: message.bgsHeroQuests,
		bgsQuestsCompletedTimings: message.bgsQuestsCompletedTimings,
		bgsQuestsDifficulties: message.bgsQuestsDifficulties,
		bgsHeroQuestRewards: message.bgsHeroQuestRewards,
		bgsAnomalies: message.bgsAnomalies,
		bgsTrinkets: message.bgsTrinkets,
		bgsTrinketOptions: message.bgsTrinketOptions,
	};

	const insertQuery = `
		INSERT IGNORE INTO bgs_run_stats 
		(
			creationDate,
			buildNumber,
			playerRank,
			heroCardId,
			rating,
			reviewId,
			darkmoonPrizes,
			tribes,
			combatWinrate,
			warbandStats,
			quests,
			bgsHeroQuests,
			bgsQuestsCompletedTimings,
			bgsQuestsDifficulties,
			bgsHeroQuestRewards,
			bgsAnomalies,
			bgsTrinkets,
			bgsTrinketsOptions
		)
		VALUES 
		(
			${SqlString.escape(row.creationDate)},
			${SqlString.escape(row.buildNumber)}, 
			${SqlString.escape(row.rank)}, 
			${SqlString.escape(row.heroCardId)},
			${SqlString.escape(row.rating)},
			${SqlString.escape(row.reviewId)},
			${SqlString.escape(row.darkmoonPrizes)},
			${SqlString.escape(row.tribes)},
			${SqlString.escape(JSON.stringify(row.combatWinrate))},
			${SqlString.escape(JSON.stringify(row.warbandStats))},
			${SqlString.escape(row.quests)},
			${nullIfEmpty(row.bgsHeroQuests?.join(','))},
			${nullIfEmpty(row.bgsQuestsCompletedTimings?.join(','))},
			${nullIfEmpty(row.bgsQuestsDifficulties?.join(','))},
			${nullIfEmpty(row.bgsHeroQuestRewards?.join(','))},
			${nullIfEmpty(row.bgsAnomalies?.join(','))},
			${nullIfEmpty(row.bgsTrinkets?.join(','))},
			${nullIfEmpty(row.bgsTrinketOptions?.join(','))}
		)
	`;
	// logger.debug('running query', insertQuery);
	await mysql.query(insertQuery);

	const bgPerfectGame = replayInfo?.fullMetaData?.bgs?.isPerfectGame ?? isBgPerfectGame(bgParsedInfo, replayInfo);
	if (bgPerfectGame) {
		// logger.debug('sending SNS notification for perfect game', replayInfo.reviewMessage.reviewId);
		sns.notify(process.env.BG_PERFECT_GAME_SNS_TOPIC, JSON.stringify(replayInfo.reviewMessage));
		if (!replayInfo.fullMetaData?.bgs) {
			const query = `
				UPDATE replay_summary
				SET bgsPerfectGame = 1
				WHERE reviewId = ${SqlString.escape(replayInfo.reviewMessage.reviewId)}
			`;
			// logger.debug('running query', query);
			const result = await mysql.query(query);
			// logger.debug('result', result);
		}
	}
};

const buildWarbandStats = async (
	bgParsedInfo: BgsPostMatchStats,
	replayInfo: ReplayInfo,
): Promise<readonly InternalWarbandStats[]> => {
	try {
		replayInfo.bgsPostMatchStats = bgParsedInfo;
		const result = bgParsedInfo.totalStatsOverTurn.map((stat) => ({
			turn: stat.turn,
			totalStats: stat.value,
		}));
		// logger.debug('built warband stats', replayInfo.reviewMessage.reviewId, result);
		return result;
	} catch (e) {
		logger.error('Exception while building warband stats', e);
		return null;
	}
};

const isBgPerfectGame = (bgParsedInfo: BgsPostMatchStats, replayInfo: ReplayInfo): boolean => {
	if (!replayInfo.reviewMessage.additionalResult || parseInt(replayInfo.reviewMessage.additionalResult) !== 1) {
		return false;
	}

	const mainPlayerId = replayInfo?.fullMetaData?.bgs?.mainPlayerId ?? replayInfo.replay?.mainPlayerId;
	const mainPlayerHpOverTurn = bgParsedInfo.hpOverTurn[mainPlayerId];
	// Let's use 8 turns as a minimum to be considered a perfect game
	if (!mainPlayerHpOverTurn?.length || mainPlayerHpOverTurn.length < 8) {
		return false;
	}

	const maxHp = Math.max(...mainPlayerHpOverTurn.map((info) => info.value));
	const startingHp = maxHp;
	const endHp = mainPlayerHpOverTurn[mainPlayerHpOverTurn.length - 1].value;
	return endHp === startingHp;
};

const normalizeHeroCardId = (heroCardId: string, allCards: AllCardsService): string => {
	if (!heroCardId) {
		return heroCardId;
	}

	// Generic handling of BG hero skins, hoping they will keep the same pattern
	const heroCard = allCards.getCard(heroCardId);
	if (heroCard?.battlegroundsHeroParentDbfId) {
		const parentCard = allCards.getCardFromDbfId(heroCard.battlegroundsHeroParentDbfId);
		if (parentCard) {
			return parentCard.id;
		}
	}

	// Fallback to regex
	const bgHeroSkinMatch = heroCardId.match(/(.*)_SKIN_.*/);
	// logger.debug('normalizing', heroCardId, bgHeroSkinMatch);
	if (bgHeroSkinMatch) {
		return bgHeroSkinMatch[1];
	}

	switch (heroCardId) {
		case 'TB_BaconShop_HERO_59t':
			return 'TB_BaconShop_HERO_59';
		default:
			return heroCardId;
	}
};

interface InternalBgsRow {
	readonly creationDate: Date;
	readonly buildNumber: number;
	readonly rating: number;
	readonly heroCardId: string;
	readonly rank: number;
	readonly reviewId: string;
	readonly tribes: string;
	readonly darkmoonPrizes: boolean;
	readonly combatWinrate: readonly {
		turn: number;
		wonPercent: number;
	}[];
	readonly warbandStats: readonly InternalWarbandStats[];
	readonly quests: boolean;
	readonly bgsHeroQuests: readonly string[];
	readonly bgsQuestsCompletedTimings: readonly number[];
	readonly bgsQuestsDifficulties: readonly number[];
	readonly bgsHeroQuestRewards: readonly string[];
	readonly bgsAnomalies: readonly string[];
	readonly bgsTrinkets: readonly string[];
	readonly bgsTrinketOptions: readonly string[];
}

interface InternalCombatWinrate {
	readonly turn: number;
	readonly winrate: number;
}

interface InternalWarbandStats {
	readonly turn: number;
	readonly totalStats: number;
}
