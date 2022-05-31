/* eslint-disable @typescript-eslint/no-use-before-define */
import { extractTotalDuration, extractTotalTurns, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { ReviewMessage } from '../review-message';
import { Stat } from './stat';

export const gameDurationExtractor = async (
	message: ReviewMessage,
	replay: Replay,
	replayString: string,
): Promise<readonly Stat[]> => {
	const totalDuration = extractTotalDuration(replay);
	const numberOfTurns = extractTotalTurns(replay);

	return [
		{
			statName: 'total-duration-seconds',
			statValue: '' + totalDuration,
		} as Stat,
		{
			statName: 'total-duration-turns',
			statValue: '' + numberOfTurns,
		} as Stat,
	];
};
