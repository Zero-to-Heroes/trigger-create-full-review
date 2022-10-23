import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService } from '@firestone-hs/reference-data';
import { MercenariesReferenceData } from '../040_mercenaries-match-stats';
import { ReviewMessage } from '../review-message';
import { mercsHeroesInfosExtractor } from './heroes-info-extractor';
import { Stat } from './stat';

export const extractMercsStats = (
	message: ReviewMessage,
	replay: Replay,
	replayString: string,
	mercenariesReferenceData: MercenariesReferenceData,
	allCards: AllCardsService,
): readonly Stat[] => {
	const extractors = [mercsHeroesInfosExtractor];
	const stats: readonly Stat[] = extractors
		.map(extractor => extractor(message, replay, replayString, allCards, mercenariesReferenceData))
		.reduce((a, b) => a.concat(b), [])
		.filter(stat => stat);
	return stats;
};
