/* eslint-disable @typescript-eslint/no-use-before-define */
import { logger } from '@firestone-hs/aws-lambda-utils';
import { AllCardsService, ScenarioId } from '@firestone-hs/reference-data';
import SqlString from 'sqlstring';
import { Stat } from './04_mercenaries-match-stats/stat';
import { ReplayInfo } from './create-full-review';
import { getCardLevel, normalizeMercCardId } from './hs-utils';
import { ReviewMessage } from './review-message';

// let mercenariesReferenceData: MercenariesReferenceData = null;

export const buildMercenariesMatchStats = async (replayInfo: ReplayInfo, allCards: AllCardsService): Promise<void> => {
	return;
};

export const buildInsertQuery = (
	message: ReviewMessage,
	statsFromGame: readonly Stat[],
	allCards: AllCardsService,
	mercenariesReferenceData: MercenariesReferenceData,
): string => {
	const escape = SqlString.escape;
	const scenarioId = +message.scenarioId;

	// And now populate the second table
	const uniqueHeroIds = statsFromGame
		.filter((stat) => stat.statName === 'mercs-hero-timing')
		.map((stat) => stat.statValue)
		.filter((value) => value)
		.map((value) => value.split('|')[0]);
	if (!uniqueHeroIds?.length) {
		return null;
	}
	const values = uniqueHeroIds
		.map((heroCardId) => {
			const rawTiming = statsFromGame
				.filter((stat) => stat.statName === 'mercs-hero-timing')
				.map((stat) => stat.statValue)
				.find((value) => value.startsWith(heroCardId));
			const heroTiming = rawTiming ? parseInt(rawTiming.split('|')[1]) : null;
			// Find the only equipment that could fit the hero
			const allEquipmentCardIds = statsFromGame
				.filter((stat) => stat.statName === 'mercs-hero-equipment')
				.map((stat) => stat.statValue?.split('|')[1])
				.filter((value) => !!value);
			// logger.debug(
			// 	'allEquipmentCardIds',
			// 	allEquipmentCardIds,
			// 	statsFromGame.filter(stat => stat.statName === 'mercs-hero-equipment'),
			// );
			const equipmentCardId = findEquipmentForHero(
				allEquipmentCardIds,
				normalizeMercCardId(heroCardId),
				allCards,
				mercenariesReferenceData,
			);
			const normalizedEquipmentCardId = normalizeMercCardId(equipmentCardId);
			// logger.debug('equipmentCardId', normalizedEquipmentCardId);
			// logger.debug(
			// 	'spellsFromStats',
			// 	statsFromGame.filter(stat => stat.statName === 'mercs-hero-skill-used'),
			// );
			const spellsForHero = getSpellsForHero(
				statsFromGame.filter((stat) => stat.statName === 'mercs-hero-skill-used'),
				heroCardId,
				allCards,
				mercenariesReferenceData,
			);
			// logger.debug('spellsForHero', spellsForHero);
			const rawLevel = statsFromGame
				.filter((stat) => stat.statName === 'mercs-hero-level')
				.map((stat) => stat.statValue)
				.find((level) => level.startsWith(heroCardId));
			const heroLevel = rawLevel ? parseInt(rawLevel.split('|')[1]) : null;
			return `(
				${escape(message.creationDate)},
				${escape(message.reviewId)},
				${escape(scenarioId)},
				${escape(isNaN(parseInt(message.mercBountyId as any)) ? null : message.mercBountyId)},
				${escape(message.result)},
				${escape(
					scenarioId === ScenarioId.LETTUCE_PVP || scenarioId === ScenarioId.LETTUCE_PVP_VS_AI
						? parseInt(message.playerRank)
						: null,
				)},
				${escape(['normal', 'heroic', 'legendary'].includes(message.playerRank) ? message.playerRank : null)},
				${escape(+message.buildNumber)},
				${escape(heroCardId)},
				${escape(heroTiming)},
				${escape(normalizedEquipmentCardId)},
				${escape(heroLevel)},
				${escape(getCardLevel(equipmentCardId))},
				${escape(spellsForHero.length > 0 ? spellsForHero[0].spellCardId : null)},
				${escape(spellsForHero.length > 0 ? spellsForHero[0].level : null)},
				${escape(spellsForHero.length > 0 ? spellsForHero[0].numberOfTimesUsed : null)},
				${escape(spellsForHero.length > 1 ? spellsForHero[1].spellCardId : null)},
				${escape(spellsForHero.length > 1 ? spellsForHero[1].level : null)},
				${escape(spellsForHero.length > 1 ? spellsForHero[1].numberOfTimesUsed : null)},
				${escape(spellsForHero.length > 2 ? spellsForHero[2].spellCardId : null)},
				${escape(spellsForHero.length > 2 ? spellsForHero[2].level : null)},
				${escape(spellsForHero.length > 2 ? spellsForHero[2].numberOfTimesUsed : null)}
			)`;
		})
		.join(',\n');

	const statsQuery = `
		INSERT INTO mercenaries_match_stats
		(
			startDate,
			reviewId,
			scenarioId,
			bountyId,
			result,
			rating,
			difficulty,
			buildNumber,
			heroCardId,
			battleEnterTiming,
			equipmentCardId,
			heroLevel,
			equipmentLevel,
			firstSkillCardId,
			firstSkillLevel,
			firstSkillNumberOfTimesUsed,
			secondSkillCardId,
			secondSkillLevel,
			secondSkillNumberOfTimesUsed,
			thirdSkillCardId,
			thirdSkillLevel,
			thirdSkillNumberOfTimesUsed
		)
		VALUES 
		${values}
	`;
	return statsQuery;
};

const findEquipmentForHero = (
	allEquipmentCardIds: string[],
	heroCardId: string,
	allCards: AllCardsService,
	mercenariesReferenceData: MercenariesReferenceData,
): string => {
	const refMerc = mercenariesReferenceData.mercenaries.find(
		(merc) => normalizeMercCardId(allCards.getCardFromDbfId(merc.cardDbfId).id) === normalizeMercCardId(heroCardId),
	);
	// Can happen when facing summoned minions
	if (!refMerc) {
		return null;
	}
	// logger.debug('refMerc', refMerc, heroCardId);
	const refMercEquipmentTiers = refMerc?.equipments.map((eq) => eq.tiers).reduce((a, b) => a.concat(b), []);
	// logger.debug('refMercEquipmentTiers', refMercEquipmentTiers);
	const heroEquipmentCardIds =
		refMercEquipmentTiers.map((eq) => eq.cardDbfId).map((eqDbfId) => allCards.getCardFromDbfId(eqDbfId).id) ?? [];
	const candidates: readonly string[] = heroEquipmentCardIds.filter((e) => allEquipmentCardIds.includes(e));
	// logger.debug('candidates', heroCardId, candidates);
	if (candidates.length === 0) {
		return null;
	}

	if (candidates.length > 1) {
		logger.error('could not get correct equipment for hero', heroCardId, heroEquipmentCardIds, candidates);
	}

	return candidates[0];
};

const getSpellsForHero = (
	stats: Stat[],
	heroCardId: string,
	allCards: AllCardsService,
	mercenariesReferenceData: MercenariesReferenceData,
): { spellCardId: string; numberOfTimesUsed: number; level: number }[] => {
	const heroAbilityCardIds =
		mercenariesReferenceData.mercenaries
			.find(
				(merc) =>
					normalizeMercCardId(allCards.getCardFromDbfId(merc.cardDbfId).id) ===
					normalizeMercCardId(heroCardId),
			)
			?.abilities.map((ability) => ability.tiers)
			.reduce((a, b) => a.concat(b), [])
			.map((ability) => ability.cardDbfId)
			.map((abilityDbfId) => allCards.getCardFromDbfId(abilityDbfId).id) ?? [];
	// logger.debug('heroAbilityCardIds', heroAbilityCardIds);
	const allSpellCardIds = stats.map((stat) => stat.statValue.split('|')[0]);
	// logger.debug('allSpellCardIds', allSpellCardIds);
	const heroSpellCardIds = allSpellCardIds.filter((s) => heroAbilityCardIds.includes(s));
	// logger.debug('heroSpellCardIds', heroSpellCardIds);
	return heroSpellCardIds.sort().map((spellCardId) => ({
		spellCardId: normalizeMercCardId(spellCardId),
		numberOfTimesUsed: parseInt(
			stats.find((stat) => stat.statValue.startsWith(spellCardId)).statValue.split('|')[1],
		),
		level: getCardLevel(spellCardId),
	}));
};

export interface MercenariesReferenceData {
	readonly mercenaries: readonly {
		readonly id: number;
		readonly cardDbfId: number;
		readonly name: string;
		readonly specializationId: number;
		readonly specializationName: string;
		readonly abilities: readonly {
			readonly abilityId: number;
			readonly cardDbfId: number;
			readonly mercenaryRequiredLevel: number;
			readonly tiers: readonly {
				readonly tier: number;
				readonly cardDbfId: number;
				readonly coinCraftCost: number;
			}[];
		}[];
		readonly equipments: readonly {
			readonly equipmentId: number;
			readonly cardDbfId: number;
			readonly tiers: readonly {
				readonly tier: number;
				readonly cardDbfId: number;
				readonly coinCraftCost: number;
				readonly attackModifier: number;
				readonly healthModifier: number;
			}[];
		}[];
	}[];
	readonly mercenaryLevels: readonly {
		readonly currentLevel: number;
		readonly xpToNext: number;
	}[];
	readonly bountySets: readonly {
		readonly id: number;
		readonly name: string;
		readonly descriptionNormal: string;
		readonly descriptionHeroic: string;
		readonly descriptionLegendary: string;
		readonly sortOrder: number;
		readonly bounties: readonly {
			readonly id: number;
			readonly name: string;
			readonly level: number;
			readonly enabled: number;
			readonly difficultyMode: number;
			readonly heroic: number;
			readonly finalBossCardId: number;
			readonly sortOrder: number;
			readonly requiredCompletedBountyId: number;
			readonly rewardMercenaryIds: readonly number[];
		}[];
	}[];
}
