import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { BlockType } from '@firestone-hs/reference-data';
import { Element } from 'elementtree';
import { Parser, ParsingStructure } from '../mercs-replay-crawler';

export class HeroesSkillsParser implements Parser {
	abilitiesPlayedThisMatch: { [abilityCardId: string]: number } = {};

	private abilitiesPlayedThisTurn: string[] = [];

	parse = (structure: ParsingStructure, replay: Replay) => {
		return (element: Element) => {
			if (element.tag !== 'Block' || parseInt(element.get('type')) !== BlockType.PLAY) {
				return;
			}

			const entity = structure.entities[parseInt(element.get('entity'))];
			if (entity?.isLettuceAbility !== 1) {
				return;
			}
			const cardId = entity.cardId;
			if (entity.lettuceController !== replay.mainPlayerId) {
				return;
			}

			this.abilitiesPlayedThisTurn.push(cardId);
		};
	};

	populate = (structure: ParsingStructure, replay: Replay) => {
		return (currentTurn: number) => {
			// console.log('populate', this.heroesForThisTurn);
			for (const abilityCardId of this.abilitiesPlayedThisTurn) {
				this.abilitiesPlayedThisMatch[abilityCardId] = (this.abilitiesPlayedThisMatch[abilityCardId] ?? 0) + 1;
			}
			this.abilitiesPlayedThisTurn = [];
		};
	};

	finalize = (structure: ParsingStructure, replay: Replay) => {
		return (currentTurn: number) => {
			// Get all the mercs for the main player
			Object.values(structure.entities)
				.filter(e => e.isLettuceAbility)
				.filter(e => e.lettuceController === replay.mainPlayerId)
				.forEach(ability => {
					const abilityCardId = ability.cardId;
					this.abilitiesPlayedThisMatch[abilityCardId] = this.abilitiesPlayedThisMatch[abilityCardId] || 0;
				});
		};
	};
}
