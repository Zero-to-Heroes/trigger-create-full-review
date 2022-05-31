/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Stat } from './02_match-stats/stat';
import { ReplayInfo } from './create-full-review';
import { ReviewMessage } from './review-message';
import { getConnection } from './services/rds';
import SqlString from 'sqlstring';
import { bgTribesExtractor } from './02_match-stats/battlegrounds/bg-tribes-extractor';
import { bgsHeroPickExtractor } from './02_match-stats/battlegrounds/hero-pick-extractor';
import { duelsRunIdExtractor } from './02_match-stats/duels/duels-run-id-extractor';
import { gameDurationExtractor } from './02_match-stats/game-duration-extractor';
import { normalizedXpGainedExtractor } from './02_match-stats/xp-gained-extractor';

export const buildMatchStats = async (replayInfo: ReplayInfo) => {
	const message = replayInfo.reviewMessage;
	const reviewId = message.reviewId;
	const replay: Replay = replayInfo.replay;
	const statsFromGame: readonly Stat[] = await extractStats(message, replay, replayInfo.replayString);

	// Common
	const xpGained = intValue(statsFromGame.find(stat => stat.statName === 'normalized-xp-gained')?.statValue);
	const totalDurationSeconds = intValue(
		statsFromGame.find(stat => stat.statName === 'total-duration-seconds')?.statValue,
	);
	const totalDurationTurns = intValue(
		statsFromGame.find(stat => stat.statName === 'total-duration-turns')?.statValue,
	);

	// Duels
	const duelsRunId = statsFromGame.find(stat => stat.statName === 'duels-run-id')?.statValue;

	// BG
	const bgsBannedTribes = statsFromGame
		.filter(stat => stat.statName === 'bgs-banned-tribes')
		.map(stat => stat.statValue)
		.join(',');
	const bgsAvailableTribes = statsFromGame
		.filter(stat => stat.statName === 'bgs-available-tribes')
		.map(stat => stat.statValue)
		.join(',');
	const bgsHeroPickOptions = statsFromGame
		.filter(stat => stat.statName === 'bgs-hero-pick-option')
		.map(stat => stat.statValue)
		.join(',');
	const bgsHeroPickChoice = statsFromGame.find(stat => stat.statName === 'bgs-hero-pick-choice')?.statValue;

	// Mercenaries are handled into their own lambda, so they can update replay_summary
	// and the mercenaries table at the same time

	const validStats = statsFromGame.filter(stat => stat);
	// console.log('validStats', validStats);
	const mysql = await getConnection();
	if (validStats.length > 0) {
		const escape = SqlString.escape;

		// And now insert it in the new table
		const additionalQuery2 = `
			UPDATE replay_summary
			SET
				bgsAvailableTribes = ${escape(emptyAsNull(bgsAvailableTribes))},
				bgsBannedTribes = ${escape(emptyAsNull(bgsBannedTribes))},
				bgsHeroPickChoice = ${escape(emptyAsNull(bgsHeroPickChoice))},
				bgsHeroPïckOption = ${escape(emptyAsNull(bgsHeroPickOptions))},
				runId = ${escape(emptyAsNull(duelsRunId))},
				normalizedXpGain = ${escape(xpGained)},
				totalDurationSeconds = ${escape(totalDurationSeconds)},
				totalDurationTurns = ${escape(totalDurationTurns)}
			WHERE
				reviewId = ${escape(emptyAsNull(reviewId))}
		`;
		// console.log('running second query', additionalQuery2);
		await mysql.query(additionalQuery2);
	}
	await mysql.end();
};

const intValue = (value: string): number => {
	return value ? parseInt(value) : null;
};

export const extractStats = async (
	message: ReviewMessage,
	replay: Replay,
	replayString: string,
): Promise<readonly Stat[]> => {
	const extractors = [
		bgsHeroPickExtractor,
		gameDurationExtractor,
		bgTribesExtractor,
		duelsRunIdExtractor,
		normalizedXpGainedExtractor,
	];
	const stats = (await Promise.all(extractors.map(extractor => extractor(message, replay, replayString))))
		.reduce((a, b) => a.concat(b), [])
		.filter(stat => stat);
	return stats;
};

function emptyAsNull(value: string): string {
	if (value?.length === 0) {
		return null;
	}
	return value;
}
