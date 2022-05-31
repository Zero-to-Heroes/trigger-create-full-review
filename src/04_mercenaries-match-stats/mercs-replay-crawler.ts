/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { CardType, GameTag, PlayState, Step } from '@firestone-hs/reference-data';
import { Element } from 'elementtree';

export const crawlMercsGame = (replay: Replay, parsers: readonly Parser[]) => {
	const opponentPlayerElement = [...replay.replay.findall('.//Player[@isMainPlayer="false"]')].pop();
	const opponentPlayerEntityId = opponentPlayerElement.get('id');
	const structure: ParsingStructure = {
		entities: {},
		gameEntityId: -1,
		currentTurn: 0,
		parsers: parsers,
	};
	const parserFunctions: readonly ((element: Element) => void)[] = [
		compositionForTurnParse(structure),
		...structure.parsers.map(parser => parser.parse(structure, replay)),
	];
	const populateFunctions: readonly ((currentTurn: number) => void)[] = [
		...structure.parsers.map(parser => parser.populate(structure, replay)),
	];
	const finalizeFunctions: readonly ((currentTurn: number) => void)[] = [
		...structure.parsers.map(parser => parser.finalize(structure, replay)),
	];
	parseElement(
		replay.replay.getroot(),
		replay.mainPlayerId,
		replay.mainPlayerEntityId,
		opponentPlayerEntityId,
		null,
		{ currentTurn: 0 },
		parserFunctions,
		populateFunctions,
	);
	// Run the finalization outside of the parsing loop, so that it wraps things up even
	// if some tags are missing
	finalizeFunctions.forEach(finalizeFunction => finalizeFunction(structure.currentTurn));
};

// While we don't use the metric, the entity info that is populated is useful for other extractors
const compositionForTurnParse = (structure: ParsingStructure) => {
	return element => {
		if (element.tag === 'GameEntity') {
			structure.gameEntityId = parseInt(element.get('id'));
			structure.entities[structure.gameEntityId] = {
				entityId: structure.gameEntityId,
				controller: parseInt(element.find(`.Tag[@tag='${GameTag.CONTROLLER}']`)?.get('value') || '-1'),
				boardVisualState: parseInt(
					element.find(`.Tag[@tag='${GameTag.BOARD_VISUAL_STATE}']`)?.get('value') || '0',
				),
			} as any;
		}
		if (element.tag === 'FullEntity' || element.tag === 'ShowEntity') {
			const entityId = element.get('id') || element.get('entity');
			structure.entities[entityId] = {
				entityId: parseInt(entityId),
				cardId: element.get('cardID'),
				controller: parseInt(element.find(`.Tag[@tag='${GameTag.CONTROLLER}']`)?.get('value') || '-1'),
				lettuceController: parseInt(
					element.find(`.Tag[@tag='${GameTag.LETTUCE_CONTROLLER}']`)?.get('value') || '-1',
				),
				creatorEntityId: parseInt(element.find(`.Tag[@tag='${GameTag.CREATOR}']`)?.get('value') || '0'),
				isMerc: parseInt(element.find(`.Tag[@tag='${GameTag.LETTUCE_MERCENARY}']`)?.get('value') || '0'),
				isLettuceAbility:
					element.find(`.Tag[@tag='${GameTag.CARDTYPE}'][@value='${CardType.LETTUCE_ABILITY}']`) != null
						? 1
						: 0,
				zone: parseInt(element.find(`.Tag[@tag='${GameTag.ZONE}']`)?.get('value') || '-1'),
				zonePosition: parseInt(element.find(`.Tag[@tag='${GameTag.ZONE_POSITION}']`)?.get('value') || '-1'),
				cardType: parseInt(element.find(`.Tag[@tag='${GameTag.CARDTYPE}']`)?.get('value') || '-1'),
				tribe: parseInt(element.find(`.Tag[@tag='${GameTag.CARDRACE}']`)?.get('value') || '-1'),
				atk: parseInt(element.find(`.Tag[@tag='${GameTag.ATK}']`)?.get('value') || '0'),
				health: parseInt(element.find(`.Tag[@tag='${GameTag.HEALTH}']`)?.get('value') || '0'),
				equipmentDbfId: parseInt(
					element.find(`.Tag[@tag='${GameTag.LETTUCE_EQUIPMENT_ID}']`)?.get('value') || '0',
				),
				experience: parseInt(
					element.find(`.Tag[@tag='${GameTag.LETTUCE_MERCENARY_EXPERIENCE}']`)?.get('value') || '0',
				),
			};
			// if (structure.entities[element.get('id')].cardType === CardType.HERO) {
			// 	console.debug('hero', structure.entities[element.get('id')]);
			// }
		}
		if (structure.entities[element.get('entity')]) {
			if (parseInt(element.get('tag')) === GameTag.CONTROLLER) {
				structure.entities[element.get('entity')].controller = parseInt(element.get('value'));
			}
			if (parseInt(element.get('tag')) === GameTag.LETTUCE_CONTROLLER) {
				structure.entities[element.get('entity')].lettuceController = parseInt(element.get('value'));
			}
			if (
				parseInt(element.get('tag')) === GameTag.CARDTYPE &&
				parseInt(element.get('value')) === CardType.LETTUCE_ABILITY
			) {
				structure.entities[element.get('entity')].isLettuceAbility = 1;
			}
			if (parseInt(element.get('tag')) === GameTag.CREATOR) {
				structure.entities[element.get('entity')].creatorEntityId = parseInt(element.get('value'));
			}
			if (parseInt(element.get('tag')) === GameTag.ZONE) {
				structure.entities[element.get('entity')].zone = parseInt(element.get('value'));
			}
			if (parseInt(element.get('tag')) === GameTag.ZONE_POSITION) {
				structure.entities[element.get('entity')].zonePosition = parseInt(element.get('value'));
			}
			if (parseInt(element.get('tag')) === GameTag.ATK) {
				// ATK.log('entity', child.get('entity'), structure.entities[child.get('entity')]);
				structure.entities[element.get('entity')].atk = parseInt(element.get('value'));
			}
			if (parseInt(element.get('tag')) === GameTag.HEALTH) {
				structure.entities[element.get('entity')].health = parseInt(element.get('value'));
			}
			if (parseInt(element.get('tag')) === GameTag.LETTUCE_EQUIPMENT_ID) {
				structure.entities[element.get('entity')].equipmentDbfId = parseInt(element.get('value'));
			}
			if (parseInt(element.get('tag')) === GameTag.LETTUCE_MERCENARY_EXPERIENCE) {
				structure.entities[element.get('entity')].experience = parseInt(element.get('value'));
			}
		}
	};
};

const parseElement = (
	element: Element,
	mainPlayerId: number,
	mainPlayerEntityId: number,
	opponentPlayerEntityId: string,
	parent: Element,
	turnCountWrapper,
	parseFunctions: readonly ((element: Element) => void)[],
	populateFunctions: readonly ((currentTurn: number) => void)[],
) => {
	parseFunctions.forEach(parseFunction => parseFunction(element));
	// TODO: externalize turn change function
	if (element.tag === 'TagChange') {
		if (
			parseInt(element.get('tag')) === GameTag.NEXT_STEP &&
			parseInt(element.get('value')) === Step.MAIN_PRE_ACTION
		) {
			populateFunctions.forEach(populateFunction => populateFunction(turnCountWrapper.currentTurn));
			turnCountWrapper.currentTurn++;
		}
		if (
			parseInt(element.get('tag')) === GameTag.PLAYSTATE &&
			[PlayState.WON, PlayState.LOST, PlayState.TIED].includes(parseInt(element.get('value')))
		) {
			// The opponent player id is squeezed because of the duplicate Innkeeper entities, so we
			// have to rely on the main player
			if (+element.get('entity') === mainPlayerEntityId) {
				populateFunctions.forEach(populateFunction => populateFunction(turnCountWrapper.currentTurn));
				turnCountWrapper.currentTurn++;
			}
		}
	}

	const children = element.getchildren();
	if (children && children.length > 0) {
		for (const child of children) {
			parseElement(
				child,
				mainPlayerId,
				mainPlayerEntityId,
				opponentPlayerEntityId,
				element,
				turnCountWrapper,
				parseFunctions,
				populateFunctions,
			);
		}
	}
};

export interface ParsingStructure {
	entities: {
		[entityId: number]: ParsingEntity;
	};
	gameEntityId: number;
	currentTurn: number;
	parsers: readonly Parser[];
}

export interface ParsingEntity {
	entityId: number;
	cardId: string;
	controller: number;
	lettuceController: number;
	creatorEntityId: number;
	isMerc: number;
	isLettuceAbility: number;
	equipmentDbfId: number;
	experience: number;
	zone: number;
	zonePosition: number;
	cardType: number;
	tribe: number;
	atk: number;
	health: number;
}

export interface Parser {
	parse: (structure: ParsingStructure, replay: Replay) => (element: Element) => void;
	populate: (structure: ParsingStructure, replay: Replay) => (currentTurn: number) => void;
	finalize: (structure: ParsingStructure, replay: Replay) => (currentTurn: number) => void;
}
