/* eslint-disable @typescript-eslint/no-use-before-define */
import { logger } from '@firestone-hs/aws-lambda-utils';
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService } from '@firestone-hs/reference-data';
import { MercenariesReferenceData } from '../040_mercenaries-match-stats';
import { isMercenaries } from '../hs-utils';
import { ReviewMessage } from '../review-message';
import { crawlMercsGame } from './mercs-replay-crawler';
import { HeroesEquipmentParser } from './parsers/heroes-equipment-parser';
import { HeroesLevelParser } from './parsers/heroes-level-parser';
import { HeroesSkillsParser } from './parsers/heroes-skill-parser';
import { HeroesTimingParser } from './parsers/heroes-timing-parser';
import { OpponentHeroesTimingParser } from './parsers/opponent-heroes-timing-parser';
import { Stat } from './stat';

export const mercsHeroesInfosExtractor = (
	message: ReviewMessage,
	replay: Replay,
	replayString: string,
	allCards: AllCardsService,
	mercenariesReferenceData: MercenariesReferenceData,
): readonly Stat[] => {
	// logger.debug('will extract', isMercenaries(message.gameMode), message.gameMode);
	if (!isMercenaries(message.gameMode)) {
		return null;
	}

	logger.debug('replay mainPlayerId', replay.mainPlayerId);
	const heroesInfos = heroesInfosExtractor(replay, allCards, mercenariesReferenceData);
	// logger.debug('heroesTiming', heroesTiming);

	return [
		...Object.keys(heroesInfos.timings).map(
			heroCardId =>
				({
					statName: 'mercs-hero-timing',
					statValue: heroCardId + '|' + heroesInfos.timings[heroCardId],
				} as Stat),
		),
		...Object.keys(heroesInfos.opponentTimings).map(
			heroCardId =>
				({
					statName: 'opponent-mercs-hero-timing',
					statValue: heroCardId + '|' + heroesInfos.opponentTimings[heroCardId],
				} as Stat),
		),
		...Object.keys(heroesInfos.equipments).map(
			heroCardId =>
				({
					statName: 'mercs-hero-equipment',
					statValue: heroCardId + '|' + heroesInfos.equipments[heroCardId],
				} as Stat),
		),
		// TODO: won't work until I have a proper DB with equipment card IDs
		// ...Object.keys(heroesInfos.equipments).map(
		// 	heroCardId =>
		// 		({
		// 			statName: 'mercs-hero-equipment-level',
		// 			statValue: heroCardId + '|' + heroesInfos.equipments[heroCardId].replace(/(.*)(_\d\d)/, '$2'),
		// 		} as Stat),
		// ),
		...Object.keys(heroesInfos.levels).map(
			heroCardId =>
				({
					statName: 'mercs-hero-level',
					statValue: heroCardId + '|' + heroesInfos.levels[heroCardId],
				} as Stat),
		),
		...Object.keys(heroesInfos.skillUsages).map(
			skillCardId =>
				({
					statName: 'mercs-hero-skill-used',
					statValue: skillCardId + '|' + heroesInfos.skillUsages[skillCardId],
				} as Stat),
		),
	];
};

export const heroesInfosExtractor = (
	replay: Replay,
	allCards: AllCardsService,
	mercenariesReferenceData: MercenariesReferenceData,
): {
	timings: { [heroCardId: string]: number };
	opponentTimings: { [heroCardId: string]: number };
	equipments: { [heroCardId: string]: number | string };
	levels: { [heroCardId: string]: number };
	skillUsages: { [skillCardId: string]: number };
} => {
	const timingParser = new HeroesTimingParser();
	const opponentTimingParser = new OpponentHeroesTimingParser();
	const equipmentParser = new HeroesEquipmentParser(allCards);
	const levelParser = new HeroesLevelParser(mercenariesReferenceData);
	const skillsParser = new HeroesSkillsParser();
	crawlMercsGame(replay, [timingParser, equipmentParser, levelParser, skillsParser, opponentTimingParser]);
	return {
		timings: timingParser.heroesTiming,
		opponentTimings: opponentTimingParser.heroesTiming,
		equipments: equipmentParser.equipmentMapping,
		levels: levelParser.levelMapping,
		skillUsages: skillsParser.abilitiesPlayedThisMatch,
	};
};
