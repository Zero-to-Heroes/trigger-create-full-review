/* eslint-disable @typescript-eslint/no-use-before-define */
import { getConnection, logger } from '@firestone-hs/aws-lambda-utils';
import {
	AllCardsService,
	CardClass,
	duelsHeroConfigs,
	GameFormat,
	normalizeDuelsHeroCardId,
} from '@firestone-hs/reference-data';
import { DeckDefinition, decode, encode } from 'deckstrings';
import SqlString from 'sqlstring';
import { ReplayInfo } from './create-full-review';

export const handleDuelsRunEnd = async (replayInfo: ReplayInfo, cards: AllCardsService): Promise<void> => {
	const message = replayInfo.reviewMessage;
	if (message.gameMode !== 'paid-duels') {
		logger.debug('not heroic duels', message);
		return;
	}

	const runId = message.currentDuelsRunId ?? message.runId;
	if (!runId) {
		logger.error('runId empty', message);
		return;
	}

	const lootQuery = `
		SELECT bundleType, 
		CASE  
			WHEN chosenOptionIndex = 1 THEN option1 
			WHEN chosenOptionIndex = 2 THEN option2  
			ELSE option3 END as pickedTreasure 
		FROM dungeon_run_loot_info
		WHERE runId = '${runId}'
		AND bundleType IN ('treasure', 'hero-power', 'signature-treasure') 
	`;
	const mysql = await getConnection();
	const lootResults: readonly any[] = await mysql.query(lootQuery);
	if (!lootResults?.length) {
		await mysql.end();
		return;
	}

	const query = `
		SELECT x1.creationDate, x1.playerClass, x1.playerCardId, x1.playerRank, x1.playerDecklist, x1.additionalResult
		FROM replay_summary x1 
		WHERE x1.runId = '${runId}'
		AND x1.playerDecklist IS NOT null 
	`;
	const allDecksResults: readonly any[] = await mysql.query(query);
	const decksResults = allDecksResults.filter(result => result.additionalResult === '0-0');
	if (!decksResults || decksResults.length !== 1) {
		await mysql.end();
		return;
	}

	// Discard the info if multiple classes are in the same run
	const uniqueHeroes = [...new Set(allDecksResults.map(result => result.playerCardId))];
	if (uniqueHeroes.length !== 1) {
		logger.error('corrupted run', runId, uniqueHeroes);
		await mysql.end();
		return;
	}

	const heroPowerNodes = lootResults.filter(result => result.bundleType === 'hero-power');
	if (heroPowerNodes.length !== 1) {
		await mysql.end();
		return;
	}

	const heroPowerNode = heroPowerNodes[0];
	const finalDecklist = message.playerDecklist;
	const [wins, losses] = message.additionalResult.split('-').map(info => parseInt(info));

	const firstGameInRun = decksResults[0];
	const periodDate = new Date(message.creationDate);
	const decklist = cleanDecklist(firstGameInRun.playerDecklist, firstGameInRun.playerCardId, cards);
	if (!decklist) {
		await mysql.end();
		return null;
	}

	const playerClass = findPlayerClass(firstGameInRun.playerClass, firstGameInRun.playerCardId);
	const allTreasures = findTreasuresCardIds(lootResults, heroPowerNode.runId);
	const row: InternalDuelsRow = {
		gameMode: message.gameMode,
		runStartDate: new Date(firstGameInRun.creationDate),
		runEndDate: periodDate,
		buildNumber: message.buildNumber,
		rating: firstGameInRun.playerRank,
		runId: runId,
		playerClass: playerClass,
		hero: message.playerCardId,
		heroPower: heroPowerNode.pickedTreasure,
		signatureTreasure: findSignatureTreasureCardId(lootResults, heroPowerNode.runId),
		wins: wins + (message.result === 'won' ? 1 : 0),
		losses: losses + (message.result === 'lost' ? 1 : 0),
		treasures: allTreasures
			.filter(cardId => !cards.getCard(cardId)?.mechanics?.includes('DUNGEON_PASSIVE_BUFF'))
			.join(','),
		passives: allTreasures
			.filter(cardId => cards.getCard(cardId)?.mechanics?.includes('DUNGEON_PASSIVE_BUFF'))
			.join(','),
	} as InternalDuelsRow;

	// For some reason the query is sometimes sent twice, which is why we IGNORE
	const insertQuery = `
		INSERT IGNORE INTO duels_stats_by_run 
		(
			gameMode, 
			runStartDate, 
			runEndDate, 
			buildNumber, 
			rating,
			runId,
			playerClass, 
			decklist,
			finalDecklist,
			hero,
			heroPower,
			signatureTreasure,
			treasures,
			passives,
			wins,
			losses
		)
		VALUES 
		(
			${SqlString.escape(row.gameMode)},
			${SqlString.escape(row.runStartDate)}, 
			${SqlString.escape(row.runEndDate)}, 
			${SqlString.escape(row.buildNumber)},
			${SqlString.escape(row.rating)},
			${SqlString.escape(row.runId)},
			${SqlString.escape(row.playerClass)},
			${SqlString.escape(decklist)},
			${SqlString.escape(finalDecklist)},
			${SqlString.escape(row.hero)},
			${SqlString.escape(row.heroPower)},
			${SqlString.escape(row.signatureTreasure)},
			${SqlString.escape(row.treasures)},
			${SqlString.escape(row.passives)},
			${SqlString.escape(row.wins)},
			${SqlString.escape(row.losses)}
		)
	`;
	logger.debug('running query', insertQuery);
	await mysql.query(insertQuery);
	await mysql.end();
};

const findPlayerClass = (playerClass: string, heroCardId: string): string => {
	if (!!playerClass?.length) {
		return playerClass;
	}
	if (!!heroCardId?.length) {
		const heroClasses = duelsHeroConfigs.find(c => c.hero === heroCardId)?.heroClasses;
		return heroClasses?.length ? CardClass[heroClasses[0]]?.toLowerCase() : '';
	}
	return '';
};

const cleanDecklist = (initialDecklist: string, playerCardId: string, cards: AllCardsService): string => {
	const decoded = decode(initialDecklist);
	const validCards = decoded.cards.filter(dbfCardId => cards.getCardFromDbfId(dbfCardId[0]).collectible);
	if (validCards.length !== 15) {
		logger.error('Invalid deck list', initialDecklist, decoded);
		return null;
	}
	const hero = getHero(playerCardId, cards);
	const newDeck: DeckDefinition = {
		cards: validCards,
		heroes: !hero ? decoded.heroes : [hero],
		format: GameFormat.FT_WILD,
	};
	const newDeckstring = encode(newDeck);
	return newDeckstring;
};

interface InternalDuelsRow {
	readonly gameMode: 'paid-duels';
	readonly runStartDate: Date;
	readonly runEndDate: Date;
	readonly buildNumber: number;
	readonly rating: number;
	readonly runId: string;
	readonly playerClass: string;
	readonly hero: string;
	readonly heroPower: string;
	readonly signatureTreasure: string;
	readonly wins: number;
	readonly losses: number;
	readonly treasures: string;
	readonly passives: string;
}

const findSignatureTreasureCardId = (decksResults: readonly any[], runId: string): string => {
	const sigs = decksResults
		.filter(result => result.runId === runId)
		.filter(result => result.bundleType === 'signature-treasure');
	return sigs.length === 0 ? null : sigs[0].pickedTreasure;
};

const findTreasuresCardIds = (decksResults: readonly any[], runId: string): readonly string[] => {
	return decksResults
		.filter(result => result.runId === runId)
		.filter(result => result.bundleType === 'treasure')
		.map(result => result.pickedTreasure);
};

const getHero = (playerCardId: string, cards: AllCardsService): number => {
	const normalizedCardId = normalizeDuelsHeroCardId(playerCardId);
	const normalizedCard = cards.getCard(normalizedCardId);
	return normalizedCard?.dbfId ?? 7;
};
