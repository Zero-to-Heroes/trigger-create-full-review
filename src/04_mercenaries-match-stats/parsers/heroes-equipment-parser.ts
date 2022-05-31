import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService } from '@firestone-hs/reference-data';
import { Element } from 'elementtree';
import { Parser, ParsingStructure } from '../mercs-replay-crawler';

export class HeroesEquipmentParser implements Parser {
	equipmentMapping: { [heroCardId: string]: number | string } = {};

	constructor(private readonly allCards: AllCardsService) {}

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
					const heroCardId = merc.cardId;
					const equipmentCard = this.allCards.getCardFromDbfId(merc.equipmentDbfId);
					this.equipmentMapping[heroCardId] = equipmentCard?.id ? equipmentCard.id : merc.equipmentDbfId;
				});
		};
	};
}
