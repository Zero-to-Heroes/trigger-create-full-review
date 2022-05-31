/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { ReviewMessage } from '../review-message';
import { Stat } from './stat';

export const normalizedXpGainedExtractor = async (
	message: ReviewMessage,
	replay: Replay,
	replayString: string,
): Promise<readonly Stat[]> => {
	if (message.normalizedXpGained == null) {
		return [];
	}
	return [
		{
			statName: 'normalized-xp-gained',
			statValue: '' + message.normalizedXpGained,
		} as Stat,
	];
};
