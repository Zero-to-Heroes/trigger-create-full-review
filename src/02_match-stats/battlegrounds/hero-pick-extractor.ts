import { extractBgPlayerPick, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { ReviewMessage } from '../../review-message';
import { Stat } from '../stat';

export const bgsHeroPickExtractor = async (
	message: ReviewMessage,
	replay: Replay,
	replayString: string,
): Promise<readonly Stat[]> => {
	if (message.gameMode !== 'battlegrounds') {
		return null;
	}

	const [pickOptions, pickedHeroFullEntity] = extractBgPlayerPick(replay);
	if (!pickOptions?.length || !pickedHeroFullEntity) {
		return null;
	}

	return [
		...pickOptions
			.map(option => option.get('cardID'))
			.map(
				pick =>
					({
						statName: 'bgs-hero-pick-option',
						statValue: pick,
					} as Stat),
			),
		{
			statName: 'bgs-hero-pick-choice',
			statValue: pickedHeroFullEntity.get('cardID'),
		} as Stat,
	];
};
