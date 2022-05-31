/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Element } from 'elementtree';
import { MercenariesReferenceData } from '../../04_mercenaries-match-stats';
import { normalizeMercCardId } from '../../hs-utils';
import { Parser, ParsingStructure } from '../mercs-replay-crawler';

export class HeroesLevelParser implements Parser {
	levelMapping: { [heroCardId: string]: number } = {};

	constructor(private readonly mercenariesReferenceData: MercenariesReferenceData) {}

	parse = (structure: ParsingStructure, replay: Replay) => {
		return (element: Element) => {};
	};

	populate = (structure: ParsingStructure, replay: Replay) => {
		return (currentTurn: number) => {};
	};

	finalize = (structure: ParsingStructure, replay: Replay) => {
		return (currentTurn: number) => {
			// Get all the mercs for the main player
			Object.values(structure.entities)
				.filter(e => e.isMerc)
				.filter(e => e.lettuceController === replay.mainPlayerId)
				.forEach(merc => {
					const heroCardId = normalizeMercCardId(merc.cardId);
					const totalXp = merc.experience;
					const currentLevel = getMercLevelFromExperience(totalXp, this.mercenariesReferenceData);
					this.levelMapping[heroCardId] = currentLevel;
				});
		};
	};
}

export const getMercLevelFromExperience = (totalXp: number, referenceData: MercenariesReferenceData): number => {
	if (!referenceData?.mercenaryLevels?.length) {
		return 0;
	}

	let currentLevel = 0;
	for (const levelMapping of referenceData.mercenaryLevels) {
		if (levelMapping.xpToNext > totalXp) {
			break;
		}
		currentLevel++;
	}
	return Math.max(1, currentLevel);
};
