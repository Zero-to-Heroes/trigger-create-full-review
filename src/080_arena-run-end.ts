/* eslint-disable @typescript-eslint/no-use-before-define */
import { getConnection, logger } from '@firestone-hs/aws-lambda-utils';
import { AllCardsService } from '@firestone-hs/reference-data';
import { ServerlessMysql } from 'serverless-mysql';
import { ReplayInfo } from './create-full-review';

export const handleArenaRunEnd = async (replayInfo: ReplayInfo, allCards: AllCardsService): Promise<void> => {
	const message = replayInfo.reviewMessage;
	const runId = message.runId;
	if (!runId) {
		logger.error('runId empty', message);
		return;
	}

	const rowToInsert: ArenaHighWinRun = {
		creationDate: new Date(message.creationDate),
		runId: runId,
		playerClass: message.playerClass,
		decklist: message.playerDecklist,
		wins: parseInt(message.additionalResult.split('-')[0]) + (message.result === 'won' ? 1 : 0),
		losses: parseInt(message.additionalResult.split('-')[1]) + (message.result === 'lost' ? 1 : 0),
		buildNumber: message.buildNumber,
		allowGameShare: message.allowGameShare ?? true,
	} as ArenaHighWinRun;

	const mysql = await getConnection();
	await saveRun(mysql, rowToInsert);
	await mysql.end();
};

const saveRun = async (mysql: ServerlessMysql, run: ArenaHighWinRun) => {
	const query = `
		INSERT IGNORE INTO arena_stats_by_run
		(creationDate, runId, playerClass, decklist, wins, losses, buildNumber, allowGameShare)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`;
	const result = await mysql.query(query, [
		run.creationDate,
		run.runId,
		run.playerClass,
		run.decklist,
		run.wins,
		run.losses,
		run.buildNumber,
		run.allowGameShare,
	]);
};

interface ArenaHighWinRun {
	creationDate: Date;
	runId: string;
	playerClass: string;
	decklist: string;
	wins: number;
	losses: number;
	buildNumber: number;
	allowGameShare: boolean;
}
