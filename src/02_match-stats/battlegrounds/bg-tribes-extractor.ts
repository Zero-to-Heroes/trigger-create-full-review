/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Race } from '@firestone-hs/reference-data';
import { ReviewMessage } from '../../review-message';
import { Stat } from '../stat';

export const bgTribesExtractor = async (
	message: ReviewMessage,
	replay: Replay,
	replayString: string,
): Promise<readonly Stat[]> => {
	const bannedTribeStats = (message.bannedTribes || []).map(
		(tribe: Race) =>
			({
				statName: 'bgs-banned-tribes',
				statValue: '' + tribe,
			} as Stat),
	);
	const availableTribeStats = (message.availableTribes || []).map(
		(tribe: Race) =>
			({
				statName: 'bgs-available-tribes',
				statValue: '' + tribe,
			} as Stat),
	);
	return [...bannedTribeStats, ...availableTribeStats];
};
