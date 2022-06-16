import { BnetRegion, GameFormatString, Race } from '@firestone-hs/reference-data';

export interface ReviewMessage {
	readonly coinPlay: 'play' | 'coin';
	readonly opponentCardId: string;
	readonly opponentClass: string;
	readonly opponentName: string;
	readonly opponentRank: string;
	readonly playerCardId: string;
	readonly playerClass: string;
	readonly playerDecklist: string;
	readonly playerName: string;
	readonly playerRank: string;
	readonly newPlayerRank: string;
	readonly result: 'lost' | 'won' | 'tied';
	readonly reviewId: string;
	readonly gameMode: string;
	readonly creationDate: string;
	readonly userId: string;
	readonly userName: string;
	readonly gameFormat: GameFormatString;
	readonly uploaderToken: string;
	readonly buildNumber: number;
	readonly playerDeckName: string;
	readonly scenarioId: string;
	readonly additionalResult: string;
	readonly replayKey: string;
	readonly application: string;
	readonly availableTribes: readonly Race[];
	readonly bannedTribes: readonly Race[];
	readonly currentDuelsRunId: string;
	readonly runId: string;
	readonly appVersion: string;
	readonly appChannel: string;
	readonly normalizedXpGained: number;
	readonly bgsHasPrizes: boolean;
	readonly mercBountyId: number;
	readonly region: BnetRegion;
}
