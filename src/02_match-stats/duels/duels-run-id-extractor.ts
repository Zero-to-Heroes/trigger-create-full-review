/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { ReviewMessage } from '../../review-message';
import { Stat } from '../stat';

export const duelsRunIdExtractor = async (
	message: ReviewMessage,
	replay: Replay,
	replayString: string,
): Promise<readonly Stat[]> => {
	if (!message.currentDuelsRunId && !message.runId) {
		return [];
	}
	if (isBefore(message.appVersion, '6.0.24')) {
		return;
	}
	return [
		{
			statName: 'duels-run-id',
			statValue: message.runId ?? message.currentDuelsRunId,
		} as Stat,
	];
};

const isBefore = (appVersion: string, reference: string): boolean => {
	const appValue = buildAppValue(appVersion);
	const referenceValue = buildAppValue(reference);
	return appValue < referenceValue;
};

const buildAppValue = (appVersion: string): number => {
	const [major, minor, patch] = appVersion.split('.').map(info => parseInt(info));
	return 1000 * major + 100 * minor + patch;
};
