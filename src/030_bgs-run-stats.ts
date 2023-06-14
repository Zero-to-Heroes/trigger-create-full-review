/* eslint-disable @typescript-eslint/no-use-before-define */
import { getConnection, logger, Sns } from '@firestone-hs/aws-lambda-utils';
import { BgsPostMatchStats, parseBattlegroundsGame } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService } from '@firestone-hs/reference-data';
import { inflate } from 'pako';
import { ServerlessMysql } from 'serverless-mysql';
import SqlString from 'sqlstring';
import { nullIfEmpty } from './010_replay-summary';
import { ReplayInfo } from './create-full-review';
import { ReviewMessage } from './review-message';

export const buildBgsRunStats = async (replayInfo: ReplayInfo, allCards: AllCardsService, sns: Sns): Promise<void> => {
	const message = replayInfo.reviewMessage;
	if (message.gameMode !== 'battlegrounds' && message.gameMode !== 'battlegrounds-friendly') {
		logger.debug('not battlegrounds', message);
		return;
	}
	if (!message.additionalResult || isNaN(parseInt(message.additionalResult))) {
		logger.debug('no end position', message);
		return;
	}
	// if (!message.playerRank || isNaN(parseInt(message.playerRank))) {
	// 	logger.debug('no player rank', message);
	// 	return;
	// }
	// if (!message.availableTribes?.length) {
	// 	logger.debug('no available tribes', message);
	// 	return;
	// }

	// Handling skins
	const heroCardId = normalizeHeroCardId(message.playerCardId, allCards);

	const replayString = replayInfo.replayString;
	const bgParsedInfo = parseBattlegroundsGame(replayString, null, null, null, allCards);
	const warbandStats = await buildWarbandStats(bgParsedInfo, replayInfo);
	// Because there is a race, the combat winrate might have been populated first
	const mysql = await getConnection();
	const combatWinrate = await retrieveCombatWinrate(message, mysql);
	logger.debug('retrieved combat winrate?', combatWinrate);
	const playerRank = message.playerRank ?? message.newPlayerRank;
	const row: InternalBgsRow = {
		creationDate: new Date(message.creationDate),
		buildNumber: message.buildNumber,
		reviewId: message.reviewId,
		rank: parseInt(message.additionalResult),
		heroCardId: heroCardId,
		rating: playerRank == null ? null : parseInt(playerRank),
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
	} as InternalBgsRow;

	const insertQuery = `
		INSERT IGNORE INTO bgs_run_stats 
		(
			creationDate,
			buildNumber,
			rank,
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
			bgsHeroQuestRewards
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
			${nullIfEmpty(row.bgsHeroQuestRewards?.join(','))}
		)
	`;
	logger.debug('running query', insertQuery);
	await mysql.query(insertQuery);

	const bgPerfectGame = isBgPerfectGame(bgParsedInfo, replayInfo);
	if (bgPerfectGame) {
		sns.notify(process.env.BG_PERFECT_GAME_SNS_TOPIC, JSON.stringify(replayInfo.reviewMessage));
		const query = `
			UPDATE replay_summary
			SET bgsPerfectGame = 1
			WHERE reviewId = ${SqlString.escape(replayInfo.reviewMessage.reviewId)}
		`;
		logger.debug('running query', query);
		const result = await mysql.query(query);
		logger.debug('result', result);
	}
	await mysql.end();
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
		logger.debug('built warband stats', replayInfo.reviewMessage.reviewId, result);
		return result;
	} catch (e) {
		logger.error('Exception while building warband stats', e);
		return null;
	}
};

const retrieveCombatWinrate = async (
	message: ReviewMessage,
	mysql: ServerlessMysql,
): Promise<readonly InternalCombatWinrate[]> => {
	if (message.bgBattleOdds?.length) {
		return message.bgBattleOdds.map((odd) => ({
			turn: odd.turn,
			winrate: odd.wonPercent,
		}));
	}

	// TODO: deprecate this
	const query = `
		SELECT * FROM bgs_single_run_stats
		WHERE reviewId = '${message.reviewId}'
	`;
	logger.debug('running query', query);
	const results: any[] = await mysql.query(query);
	logger.debug('results', results);
	if (!results?.length) {
		return null;
	}
	const stats = parseStats(results[0].jsonStats);
	return stats.battleResultHistory
		.filter((result) => result?.simulationResult?.wonPercent != null)
		.map((result) => ({
			turn: result.turn,
			winrate: Math.round(10 * result.simulationResult.wonPercent) / 10,
		}));
};

const isBgPerfectGame = (bgParsedInfo: BgsPostMatchStats, replayInfo: ReplayInfo): boolean => {
	if (!replayInfo.reviewMessage.additionalResult || parseInt(replayInfo.reviewMessage.additionalResult) !== 1) {
		return false;
	}

	const mainPlayerCardId = replayInfo.replay?.mainPlayerCardId;
	const mainPlayerHpOverTurn = bgParsedInfo.hpOverTurn[mainPlayerCardId];
	// Let's use 8 turns as a minimum to be considered a perfect game
	if (!mainPlayerHpOverTurn?.length || mainPlayerHpOverTurn.length < 8) {
		return false;
	}

	const maxHp = Math.max(...mainPlayerHpOverTurn.map((info) => info.value));
	const startingHp = maxHp;
	const endHp = mainPlayerHpOverTurn[mainPlayerHpOverTurn.length - 1].value;
	return endHp === startingHp;
};

const parseStats = (inputStats: string): BgsPostMatchStats => {
	try {
		const parsed = JSON.parse(inputStats);
		return parsed;
	} catch (e) {
		try {
			const fromBase64 = Buffer.from(inputStats, 'base64').toString();
			const inflated = inflate(fromBase64, { to: 'string' });
			return JSON.parse(inflated);
		} catch (e) {
			logger.warn('Could not build full stats, ignoring review', inputStats);
		}
	}
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
	readonly combatWinrate: readonly InternalCombatWinrate[];
	readonly warbandStats: readonly InternalWarbandStats[];
	readonly quests: boolean;
	readonly bgsHeroQuests: readonly string[];
	readonly bgsQuestsCompletedTimings: readonly number[];
	readonly bgsQuestsDifficulties: readonly number[];
	readonly bgsHeroQuestRewards: readonly string[];
}

interface InternalCombatWinrate {
	readonly turn: number;
	readonly winrate: number;
}

interface InternalWarbandStats {
	readonly turn: number;
	readonly totalStats: number;
}
