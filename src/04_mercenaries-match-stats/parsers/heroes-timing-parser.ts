import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { GameTag, Zone } from '@firestone-hs/reference-data';
import { Element } from 'elementtree';
import { normalizeMercCardId } from '../../hs-utils';
import { Parser, ParsingStructure } from '../mercs-replay-crawler';

export class HeroesTimingParser implements Parser {
	heroesTiming: { [heroCardId: string]: number } = {};
	heroesForThisTurn: string[] = [];

	parse = (structure: ParsingStructure, replay: Replay) => {
		return (element: Element) => {
			// Now parse the proper timings
			if (
				element.tag !== 'TagChange' ||
				parseInt(element.get('tag')) !== GameTag.ZONE ||
				parseInt(element.get('value')) !== Zone.PLAY
			) {
				return;
			}

			const entity = structure.entities[parseInt(element.get('entity'))];
			if (entity?.isMerc !== 1) {
				return;
			}
			const cardId = normalizeMercCardId(entity.cardId);
			if (entity.lettuceController !== replay.mainPlayerId) {
				return;
			}

			this.heroesForThisTurn.push(cardId);
		};
	};

	populate = (structure: ParsingStructure, replay: Replay) => {
		return (currentTurn: number) => {
			// logger.log('populate', this.heroesForThisTurn);
			for (const heroCardId of this.heroesForThisTurn) {
				this.heroesTiming[heroCardId] = this.heroesTiming[heroCardId] || currentTurn;
			}
			this.heroesForThisTurn = [];
		};
	};

	finalize = (structure: ParsingStructure, replay: Replay) => {
		return (currentTurn: number) => {
			// Get all the mercs for the main player
			Object.values(structure.entities)
				.filter(e => e.isMerc)
				.filter(e => e.lettuceController === replay.mainPlayerId)
				.forEach(merc => {
					const heroCardId = normalizeMercCardId(merc.cardId);
					this.heroesTiming[heroCardId] = this.heroesTiming[heroCardId] || -1;
				});
		};
	};
}
