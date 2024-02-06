import { BgsBoard, BgsHeroQuest, BgsPostMatchStats } from '@firestone-hs/hs-replay-xml-parser';
import { BnetRegion, GameFormatString, Race } from '@firestone-hs/reference-data';

export { extractMercsStats } from './04_mercenaries-match-stats/stats-extractor';

export interface ReplayUploadMetadata {
	readonly user: {
		readonly userId: string;
		readonly userName: string;
	};
	readonly game: {
		readonly reviewId: string;
		readonly replayKey: string;
		readonly deckstring: string;
		readonly deckName: string;
		readonly scenarioId: number;
		readonly buildNumber: number;
		readonly playerRank: string;
		readonly newPlayerRank: string;
		readonly opponentRank: string;
		readonly gameMode: StatGameModeType;
		readonly gameFormat: GameFormatString;
		readonly additionalResult: string;
		readonly runId: string;

		// Coming from the replay
		readonly mainPlayerName: string;
		readonly mainPlayerCardId: string;
		readonly opponentPlayerName: string;
		readonly forceOpponentName: string;
		readonly opponentPlayerCardId: string;
		readonly result: 'won' | 'lost' | 'tied';
		readonly playCoin: 'play' | 'coin';
		readonly totalDurationSeconds: number;
		readonly totalDurationTurns: number;
		// readonly additionalResult: string;
	};
	readonly bgs?: {
		readonly hasPrizes: boolean;
		readonly hasSpells: boolean;
		readonly hasQuests: boolean;
		readonly hasAnomalies: boolean;
		readonly bannedTribes: readonly Race[];
		readonly availableTribes: readonly Race[];
		readonly anomalies: readonly string[];
		readonly mainPlayerId: number;
		readonly heroQuests: readonly BgsHeroQuest[];
		readonly finalComp: BgsBoard | null;
		readonly isPerfectGame: boolean;
		readonly battleOdds: readonly { turn: number; wonPercent: number }[] | null;
		readonly warbandStats: readonly { turn: number; totalStats: number }[] | null;
		// readonly heroOptions: readonly string[]
		readonly postMatchStats: BgsPostMatchStats;
	};
	// I'm not building stats for mercs anymore, so I can probably scrap that
	readonly mercs?: {
		readonly bountyId: number;
		readonly heroTimings: {
			[heroCardId: string]: number;
		};
		readonly opponentMercsHeroTimings: {
			[heroCardId: string]: number;
		};
		readonly heroEquipments: {
			[heroCardId: string]: string | number;
		};
		readonly heroLevels: {
			[heroCardId: string]: number;
		};
		readonly heroSkillsUsed: {
			[abilityCardId: string]: number;
		};
	};
	readonly meta: {
		readonly application: string;
		readonly appVersion: string;
		readonly appChannel: string;
		readonly region: BnetRegion;
		readonly allowGameShare: boolean;
		readonly realXpGained: number | undefined;
		readonly normalizedXpGained: number | undefined;
		readonly levelAfterMatch: string;
	};
}

export type StatGameModeType =
	| 'unknown'
	| 'arena'
	| 'arena-draft'
	| 'casual'
	| 'friendly'
	| 'practice'
	| 'ranked'
	| 'tutorial'
	| 'tavern-brawl'
	| 'battlegrounds'
	| 'battlegrounds-friendly'
	| 'duels'
	| 'mercenaries-ai-vs-ai'
	| 'mercenaries-pve'
	| 'mercenaries-pve-coop'
	| 'mercenaries-pvp'
	| 'mercenaries-friendly'
	| 'paid-duels';
export type StatGameFormatType = 'unknown' | 'all' | 'standard' | 'wild' | 'classic' | 'twist';
