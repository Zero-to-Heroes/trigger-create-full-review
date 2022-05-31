import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { GameTag, Zone } from '@firestone-hs/reference-data';
import { Element } from 'elementtree';
import { normalizeMercCardId } from '../../hs-utils';
import { Parser, ParsingStructure } from '../mercs-replay-crawler';

export class OpponentHeroesTimingParser implements Parser {
	heroesTiming: { [heroCardId: string]: number } = {};
	heroesForThisTurn: string[] = [];

	parse = (structure: ParsingStructure, replay: Replay) => {
		return (element: Element) => {
			// ShowEntity for PvP, FullEntity for PvE
			if (element.tag !== 'ShowEntity' && element.tag !== 'FullEntity') {
				return;
			}

			const entity = structure.entities[parseInt(element.get('entity') ?? element.get('id'))];
			if (entity?.isMerc !== 1 && !element.find(`Tag[@tag="${GameTag.LETTUCE_MERCENARY}"][@value="1"]`)) {
				return;
			}
			const cardId = normalizeMercCardId(entity.cardId);
			if (entity.lettuceController !== replay.opponentPlayerId) {
				// console.debug('wrong controller', entity.lettuceController, replay.opponentPlayerId, entity, replay);
				return;
			}

			this.heroesForThisTurn.push(cardId);
		};
	};

	populate = (structure: ParsingStructure, replay: Replay) => {
		return (currentTurn: number) => {
			for (const heroCardId of this.heroesForThisTurn) {
				// Turn 0 is the same as turn 1 for us = situation at the start of the game
				this.heroesTiming[heroCardId] = this.heroesTiming[heroCardId] || currentTurn || 1;
			}
			this.heroesForThisTurn = [];
		};
	};

	finalize = (structure: ParsingStructure, replay: Replay) => {
		return (currentTurn: number) => {
			// Get all the mercs for the main player
			Object.values(structure.entities)
				.filter(e => e.isMerc)
				.filter(e => e.lettuceController === replay.opponentPlayerId)
				.forEach(merc => {
					const heroCardId = normalizeMercCardId(merc.cardId);
					this.heroesTiming[heroCardId] = this.heroesTiming[heroCardId] || -1;
				});
		};
	};
}
